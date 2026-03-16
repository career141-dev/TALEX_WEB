import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../lib/prisma';

/**
 * Payment Gate Middleware
 * Blocks access to protected routes (like the application form) 
 * unless the user's payment_status is 'PAID'.
 * 
 * Usage: [requireAuth, requirePayment]
 */
export const requirePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.dbId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated.'
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { payment_status: true, role: true },
        });

        // Admins and Judges bypass the payment gate
        if (user?.role === 'ADMIN' || user?.role === 'JUDGE') {
            return next();
        }

        // Only allow access if payment is confirmed
        if (user?.payment_status !== 'PAID') {
            return res.status(402).json({
                success: false,
                message: 'Payment required. Complete payment to access the application form.',
                code: 'PAYMENT_REQUIRED',
                retry_url: '/api/payment/retry',
                status: user?.payment_status || 'UNPAID',
            });
        }

        next();
    } catch (error) {
        console.error('❌ Payment Gate Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error checking payment status.'
        });
    }
};
