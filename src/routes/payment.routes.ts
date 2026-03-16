import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { paymentRetryLimiter } from '../middleware/rate-limiter';
import {
    initiatePayment,
    getPaymentStatus,
    paymentWebhook,
    paymentReturn,
    paymentCancel,
    retryPaymentController,
} from '../controllers/payment.controller';

const router = Router();

// Candidate-protected routes (Auth required + Must be a candidate)
const candGuard = [requireAuth, requireRole('CANDIDATE')];

router.post('/initiate', ...candGuard, initiatePayment);
router.post('/retry', ...candGuard, paymentRetryLimiter, retryPaymentController);
router.get('/status', ...candGuard, getPaymentStatus);

// Public — PayHere server callback + browser redirects (NO auth middleware needed)
router.post('/webhook', paymentWebhook);
router.get('/return', paymentReturn);
router.get('/cancel', paymentCancel);

export default router;
