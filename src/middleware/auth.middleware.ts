import { Request, Response, NextFunction } from 'express';
import { User } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import prisma from '../lib/prisma';
import { Role } from '@prisma/client';

// Extend AuthRequest to carry both the Supabase user and DB-sourced fields
// so downstream controllers never touch Supabase metadata for role/status checks
export interface AuthRequest extends Request {
    user?: User & {
        dbId: string;        // Prisma user.id (UUID)
        dbRole: Role;        // Role from our DB — never user_metadata (user-writable)
    };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Live server-side verification via Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
            return;
        }

        // 2. Decode JWT to get 'iat' (Issued At) for revocation check
        const payload = jwt.decode(token) as { iat: number } | null;

        // 3. Fetch user state from our DB — the only source of truth
        const dbUser = await prisma.user.findUnique({
            where: { supabase_uid: user.id },
            select: {
                id: true,
                role: true,
                is_active: true,
                is_verified: true,
                password_changed_at: true
            },
        });

        if (!dbUser) {
            res.status(401).json({ success: false, error: 'Unauthorized: User not found' });
            return;
        }

        // 4. JWT Revocation Check: Ensure token was issued AFTER last password change
        if (payload && payload.iat && dbUser.password_changed_at) {
            const tokenIssuedAt = payload.iat * 1000; // Convert to ms
            const passwordChangedAt = dbUser.password_changed_at.getTime();

            // If profile/password was updated after the token was issued, reject it.
            // We add a 1000ms buffer to account for minor clock drift between servers.
            if (passwordChangedAt > (tokenIssuedAt + 1000)) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized: Password recently changed. Please log in again.'
                });
                return;
            }
        }

        // 5. Status Checks
        if (!dbUser.is_active) {
            res.status(403).json({ success: false, error: 'Account is disabled. Contact support.' });
            return;
        }

        if (!dbUser.is_verified) {
            res.status(403).json({ success: false, error: 'Please verify your email before accessing this resource.' });
            return;
        }

        // Attach Supabase user + DB fields
        req.user = { ...user, dbId: dbUser.id, dbRole: dbUser.role };
        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.status(401).json({ success: false, error: 'Unauthorized: Token verification failed' });
    }
};

// requireRole must be used AFTER requireAuth on the same route
export const requireRole = (...roles: Role[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }

        if (!roles.includes(req.user.dbRole)) {
            res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions' });
            return;
        }

        next();
    };
};
