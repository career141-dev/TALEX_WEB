import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { config } from '../config/env';
import * as paymentService from '../services/payment.service';
import { auditService } from '../services/audit.service';
import { emailService } from '../services/email.service';

/*
 * POST /api/payment/initiate 
 * v3.0: initiatePayment now calls buildCheckoutParams(userId, orderId) — async, 
 * reads real phone/address from DB. Returns checkout params for use with 
 * payhere.startPayment() on the frontend.
 */
export const initiatePayment = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.dbId;
        const { orderId } = await paymentService.createPendingPayment(userId, req.ip || '');
        const checkoutParams = await paymentService.buildCheckoutParams(userId, orderId);

        // Note: checkoutUrl not needed — frontend uses payhere.startPayment() popup
        await auditService.logEvent({
            userId,
            action: 'PAYMENT_INITIATED' as any,
            details: {
                orderId,
                amount: config.PAYMENT_AMOUNT,
                currency: config.PAYMENT_CURRENCY
            },
            ip: req.ip,
        });

        return res.status(200).json({ success: true, checkoutParams });
    } catch (err: any) {
        const errorMap: Record<string, [number, string]> = {
            'ALREADY_PAID': [409, 'You have already paid successfully.'],
            'PHONE_REQUIRED': [422, 'Phone number required. Please update your profile before paying.'],
            'USER_NOT_FOUND': [404, 'User not found.'],
        };
        const [status, message] = errorMap[err.message] || [500, 'Failed to initiate payment.'];
        return res.status(status).json({ success: false, message });
    }
};

/**
 * GET /api/payment/status
 * Authoritative source of truth for the candidate's payment status.
 */
export const getPaymentStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.dbId;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { payment_status: true, paid_at: true },
        });

        const payment = await prisma.payment.findFirst({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            select: {
                order_id: true,
                status: true,
                amount: true,
                currency: true,
                paid_at: true,
                payhere_method: true,
                created_at: true,
                retry_count: true,
                parent_order_id: true
            },
        });

        return res.status(200).json({
            success: true,
            data: {
                payment_status: user?.payment_status,
                paid_at: user?.paid_at,
                latest_payment: payment
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to retrieve payment status.' });
    }
};

/**
 * ■■ GET /api/payment/return ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Browser redirect only — NOT authoritative. 
 * JS SDK: popup closes instead, but we keep this for legacy/redirect backup.
 */
export const paymentReturn = async (req: AuthRequest, res: Response) => {
    const { order_id } = req.query;
    return res.status(200).json({
        success: true,
        message: 'Payment submitted. Status being verified.',
        order_id,
        note: 'Verification in progress — frontend polls /status to confirm.',
    });
};

/**
 * ■■ GET /api/payment/cancel ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Browser redirect only — NOT authoritative.
 */
export const paymentCancel = async (req: AuthRequest, res: Response) => {
    return res.status(200).json({
        success: false,
        message: 'Payment cancelled. You can retry from your dashboard.',
        retry_url: '/api/payment/retry',
    });
};

/**
 * ■■ POST /api/payment/webhook ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * SECURITY CRITICAL: Server-to-server confirmation from PayHere.
 * Note: Uses standard Request (not AuthRequest) as caller is PayHere.
 */
export const paymentWebhook = async (req: Request, res: Response) => {
    // Step 1: Respond 200 immediately to PayHere
    res.status(200).send('OK');

    const payload: paymentService.WebhookPayload = {
        merchant_id: req.body.merchant_id || '',
        order_id: req.body.order_id || '',
        payment_id: req.body.payment_id || '',
        payhere_amount: req.body.payhere_amount || '',
        payhere_currency: req.body.payhere_currency || '',
        status_code: req.body.status_code || '',
        md5sig: req.body.md5sig || '',
        method: req.body.method || '',
        status_message: req.body.status_message || '',
    };

    // Step 2: Validate required fields
    const required = ['merchant_id', 'order_id', 'payment_id', 'payhere_amount', 'payhere_currency', 'status_code', 'md5sig'];
    if (required.some(f => !payload[f as keyof typeof payload])) {
        console.error('[webhook] Missing required fields');
        return;
    }

    // Step 3: Verify merchant_id
    if (payload.merchant_id !== config.PAYHERE_MERCHANT_ID) {
        console.error('[webhook] MERCHANT_ID MISMATCH — possible attack');
        await auditService.logEvent({
            userId: undefined,
            action: 'AUTH_VERIFICATION_FAILED' as any, // Mapped to existing security action
            details: {
                event: 'WEBHOOK_MERCHANT_MISMATCH',
                received: payload.merchant_id,
                order_id: payload.order_id
            },
            ip: req.ip,
        });
        return;
    }

    // Step 4: HMAC hash verification
    const isValidHash = paymentService.verifyWebhookHash(payload);

    if (!isValidHash) {
        console.error('[webhook] HASH FAILED — rejecting');
        await paymentService.logPaymentEvent(payload.order_id, 'WEBHOOK_REJECTED', {
            gatewayPayload: req.body,
            hashValid: false,
            ipAddress: req.ip,
            notes: 'HMAC hash verification failed',
        });
        await auditService.logEvent({
            userId: undefined,
            action: 'AUTH_VERIFICATION_FAILED' as any,
            details: {
                event: 'WEBHOOK_HASH_FAILED',
                received_hash: payload.md5sig,
                order_id: payload.order_id
            },
            ip: req.ip,
        });
        return;
    }

    // Step 5: Log successful verification
    await paymentService.logPaymentEvent(payload.order_id, 'WEBHOOK_VERIFIED', {
        gatewayPayload: req.body,
        gatewayStatus: payload.status_code,
        gatewayMethod: payload.method,
        gatewayAmount: payload.payhere_amount,
        hashValid: true,
        ipAddress: req.ip,
        processed: true,
    });

    // Step 6: Process with full status mapping + amount validation
    try {
        await paymentService.processWebhookPayment(payload);

        const statusCode = parseInt(payload.status_code);
        const isPaid = statusCode === 2;
        const statusName = paymentService.PAYHERE_STATUS_MAP[statusCode] || 'UNKNOWN';

        const payment = await prisma.payment.findUnique({
            where: { order_id: payload.order_id },
            include: { user: true }
        });

        await auditService.logEvent({
            userId: payment?.user_id || undefined,
            action: (isPaid ? 'PAYMENT_SUCCESS' : `PAYMENT_${statusName}`) as any,
            details: {
                order_id: payload.order_id,
                payment_id: payload.payment_id,
                status_code: statusCode,
                method: payload.method,
                amount: payload.payhere_amount
            },
            ip: req.ip,
        });

        // Step 7: Send receipt email if paid
        if (isPaid && payment?.user) {
            await emailService.sendPaymentReceiptEmail({
                to: payment.user.email,
                firstName: payment.user.firstName,
                orderId: payload.order_id,
                paymentId: payload.payment_id,
                amount: payload.payhere_amount,
                currency: payload.payhere_currency,
                method: payload.method,
                paidAt: new Date().toISOString(),
            });
        }

        console.log(`[webhook] ${statusName} — order ${payload.order_id}`);
    } catch (err: any) {
        console.error('[webhook] Error:', err.message);
    }
};

/**
 * ■■ POST /api/payment/retry
 * v3.0: re-initiates payment if the previous attempt failed, cancelled or expired.
 */
export const retryPaymentController = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.dbId;
        const { orderId } = await paymentService.retryPayment(userId, req.ip || '');
        const checkoutParams = await paymentService.buildCheckoutParams(userId, orderId);

        await auditService.logEvent({
            userId,
            action: 'PAYMENT_RETRY_INITIATED' as any,
            details: { orderId },
            ip: req.ip,
        });

        return res.status(200).json({
            success: true,
            message: 'New payment session created. Complete payment in the popup.',
            checkoutParams,
        });
    } catch (err: any) {
        const errorMap: Record<string, [number, string]> = {
            'ALREADY_PAID': [409, 'You have already paid successfully.'],
            'NO_PREVIOUS_PAYMENT': [404, 'No payment found. Initiate payment first.'],
            'MAX_RETRIES_EXCEEDED': [429, 'Maximum 3 attempts reached. Contact support.'],
            'PHONE_REQUIRED': [422, 'Phone number required. Update your profile.'],
            'CANNOT_RETRY:PENDING': [409, 'Payment still being processed. Please wait.'],
            'CANNOT_RETRY:PAID': [409, 'You have already paid successfully.'],
            'CANNOT_RETRY:REFUNDED': [409, 'Payment refunded. Contact support.'],
        };
        const [status, message] = errorMap[err.message] || [500, 'Retry failed.'];
        return res.status(status).json({ success: false, message });
    }
};
