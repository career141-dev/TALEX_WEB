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
    const message = err.message || 'Internal Server Error';

    console.error(`[ERROR] ${statusCode} - ${message}`);
    if (config.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    res.status(statusCode).json({
        status: 'error',
        message,
        ...(config.NODE_ENV === 'development' && { stack: err.stack }),
    });
};
