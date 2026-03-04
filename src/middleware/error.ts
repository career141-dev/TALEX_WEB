/**
 * Global error handling middleware for the Express application.
 */
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

export interface AppError extends Error {
    statusCode?: number;
}

export const errorHandler = (
    err: AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const statusCode = err.statusCode || 500;

    // Sanitize in production: mask 500 messages, allow 4xx messages
    const message = config.NODE_ENV === 'production'
        ? (statusCode < 500 ? err.message : 'Internal Server Error')
        : err.message || 'Internal Server Error';

    // Log the request context for easier debugging
    console.error(`[ERROR] ${statusCode} - ${req.method} ${req.path} - ${message}`);

    if (config.NODE_ENV === 'development' && err.stack) {
        console.error(err.stack);
    }

    // Response shape matches the rest of the API
    res.status(statusCode).json({
        success: false,
        error: message,
        ...(config.NODE_ENV === 'development' && { stack: err.stack }),
    });
};
