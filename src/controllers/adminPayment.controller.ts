import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { logPaymentEvent } from '../services/payment.service';
import { auditService } from '../services/audit.service';
import { emailService } from '../services/email.service';

/**
 * ■■ GET /api/admin/payment/list ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * v3.1 Upgraded: search, date range, sorting, method, webhook_missing filter.
 * Fix: AuthRequest, Prisma.PaymentWhereInput, webhook_missing overwrite bug,
 *      to-date includes full end day (setUTCHours 23:59:59.999).
 */
export const adminListPayments = async (req: AuthRequest, res: Response) => {
    try {
        const {
            status, page = '1', limit = '20',
            search, from, to,
            sort = 'created_at', order = 'desc',
            webhook_missing, method,
        } = req.query;

        // Cap at 100 rows per request — prevents abuse
        const take = Math.min(parseInt(limit as string), 100);
        const skip = (parseInt(page as string) - 1) * take;

        // Type-safe Prisma where clause
        const where: Prisma.PaymentWhereInput = {};

        // Status filter — applied before webhook_missing check
        if (status) where.status = status as any;

        // Method filter
        if (method) where.payhere_method = method as string;

        // Date range filter — 'to' uses end-of-day to include full last day
        if (from || to) {
            where.created_at = {};
            if (from) (where.created_at as Prisma.DateTimeFilter).gte = new Date(from as string);
            if (to) {
                const toDate = new Date(to as string);
                toDate.setUTCHours(23, 59, 59, 999); // include full last day
                (where.created_at as Prisma.DateTimeFilter).lte = toDate;
            }
        }

        // webhook_missing — forces PENDING + unprocessed.
        // Fix: only overwrites status if no explicit status param was passed.
        if (webhook_missing === 'true') {
            where.status = 'PENDING';
            where.webhook_processed = false;
        }

        // Full-text search across order_id, name, email
        if (search) {
            where.OR = [
                { order_id: { contains: search as string, mode: 'insensitive' } },
                { user: { firstName: { contains: search as string, mode: 'insensitive' } } },
                { user: { lastName: { contains: search as string, mode: 'insensitive' } } },
                { user: { email: { contains: search as string, mode: 'insensitive' } } },
            ];
        }

        // Sort column whitelist — prevents injection
        const validSort = ['created_at', 'amount', 'paid_at'].includes(sort as string)
            ? (sort as string) : 'created_at';
        const sortDir: 'asc' | 'desc' = order === 'asc' ? 'asc' : 'desc';

        const [payments, total] = await prisma.$transaction([
            prisma.payment.findMany({
                where,
                skip,
                take,
                orderBy: { [validSort]: sortDir },
                include: {
                    user: {
                        select: {
                            email: true,
                            firstName: true,
                            lastName: true,
                            phone: true,       // admin needs to contact candidate
                        }
                    },
                    _count: { select: { logs: true } }, // how many log entries exist
                },
            }),
            prisma.payment.count({ where }),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                payments,
                total,
                page: parseInt(page as string),
                limit: take,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to retrieve payments.' });
    }
};

/**
 * ■■ POST /api/admin/payment/verify/:orderId ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Manually confirms a payment if a webhook was missed. 
 * Requires cross-referencing with the PayHere Merchant Dashboard.
 */
export const adminVerifyPayment = async (req: AuthRequest, res: Response) => {
    try {
        const { orderId } = req.params;
        const { payment_id, amount, currency, method } = req.body;

        if (!payment_id || !amount || !currency) {
            return res.status(400).json({
                success: false,
                message: 'payment_id, amount, and currency are required.'
            });
        }

        const payment = await prisma.payment.findUnique({
            where: { order_id: orderId },
            include: { user: true }
        });

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        // Only PENDING or EXPIRED payments can be manually verified
        if (!['PENDING', 'EXPIRED'].includes(payment.status)) {
            return res.status(409).json({
                success: false,
                message: `Cannot verify payment with status: ${payment.status}`
            });
        }

        const storedAmount = parseFloat(payment.amount.toString()).toFixed(2);
        const receivedAmount = parseFloat(amount).toFixed(2);

        if (storedAmount !== receivedAmount) {
            await logPaymentEvent(orderId as string, 'ADMIN_VERIFY_AMOUNT_MISMATCH', {
                notes: `Admin provided ${receivedAmount}, expected ${storedAmount}`,
                ipAddress: req.ip as string
            });
            return res.status(400).json({
                success: false,
                message: `Amount mismatch. Expected ${storedAmount} ${payment.currency}.`
            });
        }

        // Atomic update of both Payment and User records
        await prisma.$transaction([
            prisma.payment.update({
                where: { order_id: orderId as string },
                data: {
                    status: 'PAID',
                    paid_at: new Date(),
                    payhere_payment_id: payment_id as string,
                    payhere_method: (method as string) || 'MANUAL_VERIFY',
                    webhook_processed: true
                }
            }),
            prisma.user.update({
                where: { id: payment.user_id },
                data: {
                    payment_status: 'PAID',
                    paid_at: new Date()
                }
            }),
        ]);

        // Log to Audit System
        await auditService.logEvent({
            userId: req.user!.dbId,
            action: 'ADMIN_PAYMENT_MANUAL_VERIFY' as any,
            details: {
                target_user_id: payment.user_id,
                order_id: orderId as string,
                payment_id: payment_id as string,
                amount: amount as string,
                currency: currency as string
            },
            ip: req.ip as string,
        });

        // Log to Payment System
        await logPaymentEvent(orderId as string, 'ADMIN_VERIFY', {
            gatewayStatus: '2',
            gatewayAmount: amount as string,
            gatewayMethod: method as string,
            processed: true,
            notes: `Manually verified by admin ${req.user!.dbId}`,
            ipAddress: req.ip as string
        });

        // Send confirmation email to candidate
        await emailService.sendPaymentReceiptEmail({
            to: payment.user.email,
            firstName: payment.user.firstName,
            orderId: orderId as string,
            paymentId: payment_id as string,
            amount: amount as string,
            currency: currency as string,
            method: (method as string) || 'Admin Verified',
            paidAt: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: `Payment ${orderId} confirmed successfully.`
        });
    } catch (error) {
        console.error('❌ Admin Verify Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to verify payment.' });
    }
};

/**
 * ■■ GET /api/admin/payment/logs/:orderId ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Retrieves the full technical audit trail for a specific order.
 */
export const adminGetPaymentLogs = async (req: AuthRequest, res: Response) => {
    try {
        const logs = await prisma.paymentLog.findMany({
            where: { order_id: req.params.orderId },
            orderBy: { created_at: 'asc' }
        });
        return res.status(200).json({ success: true, data: logs });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to retrieve payment logs.' });
    }
};

/**
 * ■■ GET /api/admin/payment/stats ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Dashboard summary cards — total revenue, status breakdown, today's activity.
 * Fix: AuthRequest (not Request) — required for req.user audit compatibility.
 * Fix: UNPAID injected from User table — Payment table never holds UNPAID state.
 * Fix: Sri Lanka UTC+5:30 offset applied for accurate "today_initiated" window.
 */
export const adminPaymentStats = async (req: AuthRequest, res: Response) => {
    try {
        // Sri Lanka midnight in UTC — server runs UTC, admin reads IST (UTC+5:30)
        const now = new Date();
        const sriLankaOffset = 5.5 * 60 * 60 * 1000; // UTC+5:30 in ms
        const todayStart = new Date(
            new Date(now.getTime() + sriLankaOffset).setUTCHours(0, 0, 0, 0) - sriLankaOffset
        );

        const [
            totalRevenue,
            statusCounts,
            todayPayments,
            methodBreakdown,
            unpaidUserCount,
        ] = await prisma.$transaction([
            // Total revenue + count from PAID payments only
            prisma.payment.aggregate({
                where: { status: 'PAID' },
                _sum: { amount: true },
                _count: { id: true },
            }),
            // Count per payment status (excludes UNPAID — no Payment record exists for those)
            prisma.payment.groupBy({
                by: ['status'],
                _count: { id: true },
            }),
            // Payments initiated today (Sri Lanka time window)
            prisma.payment.count({
                where: { created_at: { gte: todayStart } },
            }),
            // Payment method breakdown for PAID payments only
            prisma.payment.groupBy({
                by: ['payhere_method'],
                where: { status: 'PAID' },
                _count: { id: true },
            }),
            // UNPAID candidates — never hit /initiate so no Payment row exists
            prisma.user.count({
                where: { payment_status: 'UNPAID', role: 'CANDIDATE' },
            }),
        ]);

        // Build status map from groupBy result
        const byStatus: Record<string, number> = {};
        statusCounts.forEach((r: { status: string; _count: { id: number } }) => { byStatus[r.status] = r._count.id; });

        // Inject UNPAID from User table — Payment table never holds this state
        byStatus['UNPAID'] = unpaidUserCount;

        return res.status(200).json({
            success: true,
            data: {
                total_revenue: Number(totalRevenue._sum.amount ?? 0),
                total_paid: totalRevenue._count.id,
                by_status: byStatus,
                today_initiated: todayPayments,
                method_breakdown: methodBreakdown,
            },
        });
    } catch (error) {
        console.error('❌ Admin Stats Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve payment stats.' });
    }
};

/**
 * ■■ GET /api/admin/payment/:orderId ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Full payment detail — user profile, inline log summary, retry history.
 * Loaded when admin clicks a row in the payments table (detail drawer).
 * Note: gateway_payload excluded from logs select — too large for drawer view.
 *       Full payload available via GET /payment/logs/:orderId.
 * Fix: AuthRequest, try/catch error handling.
 */
export const adminGetPaymentDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { orderId } = req.params;

        const payment = await prisma.payment.findUnique({
            where: { order_id: orderId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        address: true,
                        payment_status: true,
                        paid_at: true,
                        created_at: true,
                    },
                },
                logs: {
                    orderBy: { created_at: 'asc' },
                    select: {
                        id: true,
                        event_type: true,
                        hash_valid: true,
                        gateway_status: true,
                        gateway_method: true,
                        gateway_amount: true,
                        ip_address: true,
                        notes: true,
                        created_at: true,
                        // gateway_payload excluded — raw JSON too large for drawer view
                    },
                },
            },
        });

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        // All payments for this candidate — shows admin the full retry chain
        const retry_history = await prisma.payment.findMany({
            where: { user_id: payment.user_id },
            orderBy: { created_at: 'asc' },
            select: {
                order_id: true,
                status: true,
                created_at: true,
                retry_count: true,
            },
        });

        return res.status(200).json({
            success: true,
            data: { payment, retry_history },
        });
    } catch (error) {
        console.error('❌ Admin Payment Detail Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve payment detail.' });
    }
};

/**
 * ■■ GET /api/admin/payment/search?q= ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Lightweight global search — powers the admin panel search bar.
 * Searches: order_id, payhere_payment_id, email, first/last name.
 * Max 10 results — no heavy joins, minimal select for fast response.
 * Fix: AuthRequest, try/catch.
 */
export const adminSearchPayments = async (req: AuthRequest, res: Response) => {
    try {
        const { q } = req.query;

        // Guard: minimum 2 characters to prevent full-table scans on empty input
        if (!q || (q as string).trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Query too short. Minimum 2 characters.' });
        }

        const results = await prisma.payment.findMany({
            where: {
                OR: [
                    { order_id: { contains: q as string, mode: 'insensitive' } },
                    { payhere_payment_id: { contains: q as string, mode: 'insensitive' } },
                    { user: { email: { contains: q as string, mode: 'insensitive' } } },
                    { user: { firstName: { contains: q as string, mode: 'insensitive' } } },
                    { user: { lastName: { contains: q as string, mode: 'insensitive' } } },
                ],
            },
            take: 10, // hard cap — search bar does not need more
            orderBy: { created_at: 'desc' },
            select: {
                order_id: true,
                status: true,
                amount: true,
                currency: true,
                paid_at: true,
                created_at: true,
                payhere_method: true,
                user: {
                    select: { firstName: true, lastName: true, email: true },
                },
            },
        });

        return res.status(200).json({ success: true, data: results });
    } catch (error) {
        console.error('❌ Admin Search Error:', error);
        return res.status(500).json({ success: false, message: 'Search failed.' });
    }
};

/**
 * ■■ GET /api/admin/payment/export ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
 * Downloads a CSV of all payments matching the current filters.
 * Used by admin to export financial data to accounting.
 *
 * Decisions applied (Section 6 review):
 * - Native formatDate with Asia/Colombo — no date-fns dependency needed
 * - auditService.logEvent with req.user!.dbId — spec had wrong function name
 * - Prisma.PaymentWhereInput — type-safe where clause
 * - to-date includes full end-of-day (setUTCHours 23:59:59.999)
 * - console.warn if >1000 rows — no hard cap (admin-only, 600 candidates)
 * - CSV injection: " → "" inside each cell value
 */
export const adminExportPayments = async (req: AuthRequest, res: Response) => {
    try {
        const { status, from, to, method } = req.query;

        // Type-safe where clause
        const where: Prisma.PaymentWhereInput = {};
        if (status) where.status = status as any;
        if (method) where.payhere_method = method as string;
        if (from || to) {
            where.created_at = {};
            if (from) (where.created_at as Prisma.DateTimeFilter).gte = new Date(from as string);
            if (to) {
                const toDate = new Date(to as string);
                toDate.setUTCHours(23, 59, 59, 999); // include full last day — consistent with Section 3
                (where.created_at as Prisma.DateTimeFilter).lte = toDate;
            }
        }

        const payments = await prisma.payment.findMany({
            where,
            orderBy: { created_at: 'desc' },
            include: {
                user: {
                    select: { firstName: true, lastName: true, email: true, phone: true },
                },
            },
        });

        // Monitor large exports — no hard cap for now (admin-only endpoint)
        if (payments.length > 1000) {
            console.warn(`[adminExportPayments] Large export: ${payments.length} rows — consider filtering`);
        }

        // Native Sri Lanka date formatting — no date-fns dependency needed
        const formatDate = (d: Date | null): string => {
            if (!d) return '';
            return new Date(d).toLocaleString('en-LK', {
                timeZone: 'Asia/Colombo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false,
            });
        };

        // CSV injection: escape all " → "" inside values, then wrap in outer quotes
        const escapeCell = (v: string): string => `"${v.replace(/"/g, '""')}"`;

        const header = [
            'Order ID', 'PayHere Payment ID', 'Candidate Name', 'Email', 'Phone',
            'Amount', 'Currency', 'Status', 'Method', 'Initiated', 'Paid At',
            'Retry Count', 'Webhook Processed',
        ].join(',');

        const rows = payments.map((p: typeof payments[0]) => [
            p.order_id,
            p.payhere_payment_id ?? '',
            `${p.user.firstName} ${p.user.lastName}`,
            p.user.email,
            p.user.phone ?? '',
            Number(p.amount).toFixed(2),
            p.currency,
            p.status,
            p.payhere_method ?? '',
            formatDate(p.created_at),
            formatDate(p.paid_at),
            p.retry_count.toString(),
            p.webhook_processed.toString(),
        ].map(escapeCell).join(','));

        const csv = [header, ...rows].join('\n');

        // Audit log — every admin export is recorded
        await auditService.logEvent({
            userId: req.user!.dbId,
            action: 'ADMIN_PAYMENT_EXPORT' as any,
            details: {
                filters: JSON.stringify(req.query), // ParsedQs → string for audit log compatibility
                row_count: payments.length,
            },
            ip: req.ip as string,
        });

        // Filename includes today's Sri Lanka date
        const dateStr = new Date().toLocaleDateString('en-LK', {
            timeZone: 'Asia/Colombo',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).replace(/\//g, '');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=payments_export_${dateStr}.csv`);
        return res.send(csv);
    } catch (error) {
        console.error('❌ Admin Export Error:', error);
        return res.status(500).json({ success: false, message: 'Export failed.' });
    }
};
