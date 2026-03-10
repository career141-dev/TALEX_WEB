import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { errorHandler } from './middleware/error';

import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import { globalRateLimiter } from './middleware/rate-limiter';

const app = express();

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

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Error Handling
app.use(errorHandler);

export default app;
