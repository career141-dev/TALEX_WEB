import { Request, Response, NextFunction } from 'express';

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    // TODO: Implement JWT verification logic
    next();
};
