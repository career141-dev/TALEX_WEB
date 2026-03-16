import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { inviteUser } from '../controllers/admin.controller';
import {
    adminListPayments,
    adminVerifyPayment,
    adminGetPaymentLogs,
    adminPaymentStats,
    adminGetPaymentDetail,
    adminSearchPayments,
    adminExportPayments,
} from '../controllers/adminPayment.controller';
import { ROLES } from '../utils/constants';

const router = Router();

/**
 * Admin Routes
 * All routes here require a valid session and ADMIN privileges.
 */
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN));

// User Management
router.post('/invite', inviteUser);

// Payment Management — CRITICAL: specific static paths BEFORE parameterised /:orderId
// Section 21.2 order: stats → search → export → list → logs/:id → verify/:id → /:id
router.get('/payment/stats',           adminPaymentStats);    // static
router.get('/payment/search',          adminSearchPayments);  // static
router.get('/payment/export',          adminExportPayments);  // static
router.get('/payment/list',            adminListPayments);    // static
router.get('/payment/logs/:orderId',   adminGetPaymentLogs);  // parameterised
router.post('/payment/verify/:orderId',adminVerifyPayment);   // parameterised (POST — no GET conflict)
router.get('/payment/:orderId',        adminGetPaymentDetail);// wildcard — must be last

export default router;
