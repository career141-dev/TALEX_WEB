import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validate = (schema: z.ZodTypeAny) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // parseAsync handles async Zod refinements; also strips unknown fields via Zod's default behaviour
            req.body = await schema.parseAsync(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    // Strip field-level details in production — prevents schema enumeration by attackers
                    ...(process.env.NODE_ENV !== 'production' && {
                        details: error.issues.map((i) => ({
                            path: i.path.join('.'),
                            message: i.message,
                        })),
                    }),
                });
                return;
            }
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    };
};
