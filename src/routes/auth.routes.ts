import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimiter, passwordResetRateLimiter, otpRateLimiter, globalRateLimiter } from '../middleware/rate-limiter';
import { registerSchema, loginSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema, resendOtpSchema } from '../utils/validation';

const router = Router();

// Public routes
router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/verify-otp', otpRateLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post('/resend-otp', otpRateLimiter, validate(resendOtpSchema), authController.resendOtp);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);

// Password recovery
router.post('/forgot-password', passwordResetRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', otpRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

// Session management — cookie is the credential, no Bearer token needed
router.post('/refresh', authRateLimiter, authController.refreshToken);

// Protected routes
router.post('/logout', globalRateLimiter, requireAuth, authController.logout);
router.get('/me', globalRateLimiter, requireAuth, authController.me);

export default router;
