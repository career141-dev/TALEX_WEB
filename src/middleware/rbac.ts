import { Request, Response, NextFunction } from 'express';

export const authorize = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // TODO: Implement role check logic
        next();
    };
};
