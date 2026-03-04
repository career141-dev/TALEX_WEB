import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimiter, passwordResetRateLimiter, otpRateLimiter } from '../middleware/rate-limiter';
import { registerSchema, loginSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema } from '../utils/validation';

const router = Router();

// Public routes
router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/verify-otp', otpRateLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);

// Password recovery
router.post('/forgot-password', passwordResetRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', otpRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

// Session management — cookie is the credential, no Bearer token needed
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

export default router;
