import { Request, Response, NextFunction } from 'express';
import { User } from '@supabase/supabase-js';
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
        // Live server-side verification — not just JWT decode
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
            return;
        }

        // Fetch role and status from our DB — the only source of truth
        // This also catches disabled accounts on every request (not just at login)
        const dbUser = await prisma.user.findUnique({
            where: { supabase_uid: user.id },
            select: { id: true, role: true, is_active: true, is_verified: true },
        });

        if (!dbUser) {
            res.status(401).json({ success: false, error: 'Unauthorized: User not found' });
            return;
        }

        if (!dbUser.is_active) {
            res.status(403).json({ success: false, error: 'Account is disabled. Contact support.' });
            return;
        }

        if (!dbUser.is_verified) {
            res.status(403).json({ success: false, error: 'Please verify your email before accessing this resource.' });
            return;
        }

        // Attach Supabase user + DB fields — role comes from Prisma, never Supabase metadata
        req.user = { ...user, dbId: dbUser.id, dbRole: dbUser.role };
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Unauthorized: Token verification failed' });
    }
};

// requireRole must be used AFTER requireAuth on the same route
export const requireRole = (...roles: Role[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        // Guard: requireRole should always follow requireAuth
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
