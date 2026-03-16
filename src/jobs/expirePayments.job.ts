import prisma from '../lib/prisma';
import { logPaymentEvent } from '../services/payment.service';

/**
 * Scheduled job to mark stale PENDING payments as EXPIRED after 24 hours.
 * This prevents users from being stuck with unusable order IDs and keeps
 * the database clean from ghost orders.
 */
export const expireStalePayments = async (): Promise<void> => {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

        const stale = await prisma.payment.findMany({
            where: {
                status: 'PENDING',
                created_at: { lt: cutoff }
            },
            select: { id: true, order_id: true, user_id: true },
        });

        if (stale.length === 0) return;

        // Perform bulk update of statuses to EXPIRED
        await prisma.payment.updateMany({
            where: {
                status: 'PENDING',
                created_at: { lt: cutoff }
            },
            data: {
                status: 'EXPIRED',
                expired_at: new Date()
            },
        });

        // Log the event for each expired payment in the technical logs
        for (const payment of stale) {
            await logPaymentEvent(payment.order_id, 'EXPIRED', {
                notes: 'No webhook received within 24 hours — marked EXPIRED by scheduled job',
            });
        }

        console.log(`[expirePayments] Successfully marked ${stale.length} payments as EXPIRED`);
    } catch (error) {
        console.error('❌ Error executing expireStalePayments job:', error);
    }
};
