import { Request, Response, NextFunction } from 'express';
import { z, ZodObject, ZodError } from 'zod';

export const validate = (schema: ZodObject<any, any>) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: error.issues.map((i) => ({
                        path: i.path.join('.'),
                        message: i.message,
                    })),
                });
                return;
            }
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    };
};
