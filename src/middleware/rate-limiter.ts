import { Ratelimit } from '@upstash/ratelimit';
import redis from '../config/redis';
import { Request, Response, NextFunction } from 'express';

// Global: 100 requests per 15 minutes per IP
const globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '15 m'),
    prefix: 'rl:global',
});

// Auth: 5 attempts per 15 minutes per IP (only failed requests matter)
const authLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    prefix: 'rl:auth',
});

// Password reset: 3 requests per hour per IP
const passwordResetLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, '1 h'),
    prefix: 'rl:reset',
});

// OTP verify: 10 attempts per hour per IP (brute-force protection)
const otpVerifyLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'rl:otp',
});

function createMiddleware(limiter: Ratelimit, errorMessage: string) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
        const { success } = await limiter.limit(ip);
        if (!success) {
            res.status(429).json({ success: false, error: errorMessage });
            return;
        }
        next();
    };
}

export const globalRateLimiter = createMiddleware(
    globalLimiter,
    'Too many requests. Please try again later.'
);

export const authRateLimiter = createMiddleware(
    authLimiter,
    'Too many login attempts. Please try again after 15 minutes.'
);

export const passwordResetRateLimiter = createMiddleware(
    passwordResetLimiter,
    'Too many password reset requests. Please try again after an hour.'
);

export const otpRateLimiter = createMiddleware(
    otpVerifyLimiter,
    'Too many OTP attempts. Please try again after an hour.'
);
