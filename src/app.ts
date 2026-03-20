import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Support BigInt serialization in JSON (Prisma uses BigInt for file sizes)
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { config } from './config/env';
import { errorHandler } from './middleware/error';

import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import paymentRoutes from './routes/payment.routes';
import applicationRoutes from './routes/application.routes';
import adminApplicationRoutes from './routes/adminApplication.routes';
import adminAiRoutes from './routes/adminAi.routes';
import { globalRateLimiter } from './middleware/rate-limiter';

import cron from 'node-cron';
import { expireStalePayments } from './jobs/expirePayments.job';
import prisma from './lib/prisma';
import redis from './config/redis';

const app = express();

import { v4 as uuidv4 } from 'uuid';
app.use((req: any, res: any, next: any) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
});

// Trust proxy for production
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
    }
}));
app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
}));
app.use(globalRateLimiter); // Apply global rate limiter early

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin/applications', adminApplicationRoutes);
app.use('/api/admin/ai', adminAiRoutes);

// Scheduled Jobs
// Run payment expiry check every hour at the start of the hour
cron.schedule('0 * * * *', async () => {
    await expireStalePayments();
});

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok', db: 'ok', redis: 'ok' });
  } catch (error: any) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

// Error Handling
app.use(errorHandler);

export default app;
