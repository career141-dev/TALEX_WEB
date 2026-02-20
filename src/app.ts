import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './middleware/error';

const app = express();

// Trust proxy for production
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet());
app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Error Handling
app.use(errorHandler);

export default app;
