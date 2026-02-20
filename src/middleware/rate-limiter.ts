import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import redis from '../config/redis';

/**
 * Global Rate Limiter
 * 100 requests per 15 minutes per IP
 */
export const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        status: 'error',
        message: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        // @ts-expect-error - Redis client type mismatch
        sendCommand: (...args: string[]) => redis.call(...args),
        prefix: 'rl:global:',
    }),
});

/**
 * Auth Rate Limiter
 * 10 requests per 15 minutes per IP for authentication routes
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: {
        status: 'error',
        message: 'Too many login attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        // @ts-expect-error - Redis client type mismatch
        sendCommand: (...args: string[]) => redis.call(...args),
        prefix: 'rl:auth:',
    }),
});
