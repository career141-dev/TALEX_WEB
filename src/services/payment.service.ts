import crypto from 'crypto';
import prisma from '../lib/prisma';
import { config } from '../config/env';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for PayHere Webhook Payload
 * Based on PayHere documentation for MD5 Signature verification
 */
export interface WebhookPayload {
    merchant_id: string;
    order_id: string;
    payhere_amount: string;
    payhere_currency: string;
    status_code: string;
    md5sig: string;
    payment_id: string;
    status_message: string;
    method: string;
    card_holder_name?: string;
    card_number?: string;
    card_expiry?: string;
}

// ■■ Status mapping — ALL PayHere status codes ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const PAYHERE_STATUS_MAP: Record<number, string> = {
    [2]: 'PAID',
    [0]: 'PENDING',
    [-1]: 'CANCELLED',
    [-2]: 'FAILED',
    [-3]: 'REFUNDED',
};

// ■■ Generate HMAC hash for PayHere checkout ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const generatePayHereHash = (
    orderId: string,
    amount: string,
    currency: string
): string => {
    const hashedSecret = crypto.createHash('md5')
        .update(config.PAYHERE_MERCHANT_SECRET).digest('hex').toUpperCase();

    const hashStr = `${config.PAYHERE_MERCHANT_ID}${orderId}${amount}${currency}${hashedSecret}`;
    return crypto.createHash('md5').update(hashStr).digest('hex').toUpperCase();
};

// ■■ Verify webhook HMAC — CRITICAL security check ■■■■■■■■■■■■■■■■■■■■■■■■■
export const verifyWebhookHash = (payload: WebhookPayload): boolean => {
    const hashedSecret = crypto.createHash('md5')
        .update(config.PAYHERE_MERCHANT_SECRET).digest('hex').toUpperCase();

    const hashStr = `${config.PAYHERE_MERCHANT_ID}${payload.order_id}` +
        `${payload.payhere_amount}${payload.payhere_currency}` +
        `${payload.status_code}${hashedSecret}`;

    const expected = crypto.createHash('md5').update(hashStr).digest('hex').toUpperCase();

    const expBuf = Buffer.from(expected);
    const recBuf = Buffer.from(payload.md5sig.toUpperCase());

    if (expBuf.length !== recBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, recBuf); // timing-safe comparison
};

// ■■ Log payment event to PaymentLog table ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const logPaymentEvent = async (
    orderId: string,
    eventType: string,
    opts: {
        gatewayPayload?: any;
        gatewayStatus?: string;
        gatewayMethod?: string;
        gatewayAmount?: string;
        ipAddress?: string;
        hashValid?: boolean;
        processed?: boolean;
        notes?: string;
    } = {}
): Promise<void> => {
    const payment = await prisma.payment.findUnique(
        { where: { order_id: orderId }, select: { id: true } }
    ).catch(() => null);

    await prisma.paymentLog.create({
        data: {
            order_id: orderId,
            payment_id: payment?.id || null,
            event_type: eventType,
            gateway_payload: opts.gatewayPayload || null,
            gateway_status: opts.gatewayStatus || null,
            gateway_method: opts.gatewayMethod || null,
            gateway_amount: opts.gatewayAmount || null,
            ip_address: opts.ipAddress || null,
            hash_valid: opts.hashValid ?? null,
            processed: opts.processed ?? false,
            notes: opts.notes || null,
        }
    });
};

// ■■ Create pending payment record ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const createPendingPayment = async (userId: string, ipAddress: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { payment_status: true, phone: true },
    });

    if (user?.payment_status === 'PAID') throw new Error('ALREADY_PAID');
    if (!user?.phone) throw new Error('PHONE_REQUIRED');

    const orderId = `TALEX-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;

    const payment = await prisma.payment.create({
        data: {
            user_id: userId,
            order_id: orderId,
            amount: config.PAYMENT_AMOUNT,
            currency: config.PAYMENT_CURRENCY,
            status: 'PENDING',
            ip_address: ipAddress,
        }
    });

    await logPaymentEvent(orderId, 'INITIATE', {
        ipAddress,
        notes: 'Payment session created'
    });

    return { orderId, payment };
};

// ■■ Build PayHere checkout params — v3.0: real phone + address ■■■■■■■■■■■
export const buildCheckoutParams = async (userId: string, orderId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true
        },
    });

    if (!user) throw new Error('USER_NOT_FOUND');
    if (!user.phone) throw new Error('PHONE_REQUIRED');

    const amount = config.PAYMENT_AMOUNT.toFixed(2);
    const currency = config.PAYMENT_CURRENCY;

    return {
        sandbox: config.PAYHERE_SANDBOX,
        merchant_id: config.PAYHERE_MERCHANT_ID,
        return_url: config.PAYHERE_RETURN_URL,
        cancel_url: config.PAYHERE_CANCEL_URL,
        notify_url: config.PAYHERE_NOTIFY_URL,
        order_id: orderId,
        items: 'TALEX Awards Registration Fee',
        amount,
        currency,
        hash: generatePayHereHash(orderId, amount, currency),
        first_name: user.firstName,
        last_name: user.lastName,
        email: user.email,
        phone: user.phone, // real phone — required
        address: user.address || 'Not provided', // real address
        city: 'Colombo',
        country: 'Sri Lanka',
    };
};

// ■■ Confirm/Fail payment from webhook ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const processWebhookPayment = async (payload: WebhookPayload): Promise<void> => {
    const existing = await prisma.payment.findUnique({
        where: { order_id: payload.order_id }
    });

    if (!existing) throw new Error('PAYMENT_NOT_FOUND');
    if (existing.webhook_processed) return; // idempotency — already done

    const statusCode = parseInt(payload.status_code);
    const newStatus = PAYHERE_STATUS_MAP[statusCode];

    if (!newStatus || newStatus === 'PENDING') return;

    // Validate amount matches what we stored
    const storedAmount = parseFloat(existing.amount.toString()).toFixed(2);
    const receivedAmount = parseFloat(payload.payhere_amount).toFixed(2);

    if (storedAmount !== receivedAmount) {
        await logPaymentEvent(payload.order_id, 'AMOUNT_MISMATCH', {
            gatewayAmount: payload.payhere_amount,
            notes: `Expected ${storedAmount}`,
        });
        throw new Error('AMOUNT_MISMATCH');
    }

    const isPaid = newStatus === 'PAID';

    await prisma.$transaction([
        prisma.payment.update({
            where: { order_id: payload.order_id },
            data: {
                payhere_payment_id: payload.payment_id,
                payhere_status_code: statusCode,
                payhere_status_message: payload.status_message,
                payhere_method: payload.method,
                payhere_hash: payload.md5sig,
                status: newStatus as any,
                paid_at: isPaid ? new Date() : null,
                webhook_received_at: new Date(),
                webhook_processed: true,
            }
        }),
        ...(isPaid ? [
            prisma.user.update({
                where: { id: existing.user_id },
                data: {
                    payment_status: 'PAID',
                    paid_at: new Date(),
                }
            })
        ] : []),
    ]);
};

// ■■ Retry payment ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export const retryPayment = async (userId: string, ipAddress: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { payment_status: true, phone: true },
    });

    if (user?.payment_status === 'PAID') throw new Error('ALREADY_PAID');
    if (!user?.phone) throw new Error('PHONE_REQUIRED');

    const lastPayment = await prisma.payment.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
    });

    if (!lastPayment) throw new Error('NO_PREVIOUS_PAYMENT');

    const retryableStates = ['FAILED', 'CANCELLED', 'EXPIRED'];
    if (!retryableStates.includes(lastPayment.status)) {
        throw new Error(`CANNOT_RETRY:${lastPayment.status}`);
    }

    const totalAttempts = await prisma.payment.count({
        where: { user_id: userId }
    });

    if (totalAttempts >= 3) throw new Error('MAX_RETRIES_EXCEEDED');

    const originalOrderId = lastPayment.parent_order_id || lastPayment.order_id;
    const newOrderId = `TALEX-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;

    const newPayment = await prisma.payment.create({
        data: {
            user_id: userId,
            order_id: newOrderId,
            amount: config.PAYMENT_AMOUNT,
            currency: config.PAYMENT_CURRENCY,
            status: 'PENDING',
            ip_address: ipAddress,
            parent_order_id: originalOrderId,
            retry_count: totalAttempts,
        }
    });

    await logPaymentEvent(newOrderId, 'RETRY', {
        ipAddress,
        notes: `Retry attempt ${totalAttempts + 1} of 3`,
    });

    return { orderId: newOrderId, payment: newPayment };
};
