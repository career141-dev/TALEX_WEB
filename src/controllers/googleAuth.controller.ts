import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { supabase } from '../config/supabase';
import { getStorage, saveStorage } from '../config/supabase';
import { auditService } from '../services/audit.service';
import { ROLES, AUDIT_ACTIONS, JWT_CONFIG } from '../utils/constants';
import { config } from '../config/env';

// PKCE helpers
function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generates a Google OAuth URL with PKCE manually (SDK version workaround).
 */
export const googleSignIn = async (req: Request, res: Response) => {
    try {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);

        // Store under the exact key the Supabase SDK looks for in exchangeCodeForSession
        const PKCE_STORAGE_KEY = `sb-${config.SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token-code-verifier`;
        const storage = getStorage();
        storage[PKCE_STORAGE_KEY] = codeVerifier;
        saveStorage(storage);

        const params = new URLSearchParams({
            provider: 'google',
            redirect_to: `${config.BACKEND_URL}/api/auth/google/callback`,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'consent',
        });

        const url = `${config.SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
        return res.status(200).json({ success: true, url });
    } catch (error: any) {
        console.error('[googleSignIn] Error:', error.message);
        return res.status(500).json({ success: false, message: 'Unexpected error initiating Google login' });
    }
};

/**
 * Handles the OAuth callback from Google via Supabase.
 * Exchanges the auth code for a session and syncs the user to Prisma.
 */
export const googleCallback = async (req: Request, res: Response) => {
    const { code, error: errorType, error_description } = req.query;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Missing authorization code from Google.',
        });
    }

    try {
        // 1. Exchange code for Supabase session
        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (sessionError || !sessionData?.user || !sessionData.session) {
            console.error('[googleCallback] Session exchange error:', sessionError?.message);
            return res.status(401).json({
                success: false,
                message: 'Google authentication failed. Code exchange failed.',
            });
        }

        const sbUser = sessionData.user;
        const email = sbUser.email!;

        // 2. Extract metadata safely
        const firstName = sbUser.user_metadata?.given_name
            || sbUser.user_metadata?.full_name?.split(' ')[0]
            || 'Unknown';
        const lastName = sbUser.user_metadata?.family_name
            || sbUser.user_metadata?.full_name?.split(' ').slice(1).join(' ')
            || '';
        const profileImage = sbUser.user_metadata?.avatar_url || null;

        // 3. Sync with Prisma
        let dbUser = await prisma.user.findUnique({ where: { email } });

        if (!dbUser) {
            // New Social Signup
            dbUser = await prisma.user.create({
                data: {
                    supabase_uid: sbUser.id,
                    email,
                    firstName,
                    lastName,
                    password_hash: '', // No local password for social users
                    company: 'Incomplete', // Requires profile update
                    designation: 'Candidate',
                    profileImage,
                    role: ROLES.CANDIDATE,
                    is_verified: true, // Google identity is pre-verified
                    is_active: true,
                }
            });

            await auditService.logEvent({
                userId: dbUser.id,
                action: AUDIT_ACTIONS.GOOGLE_SIGNUP,
                details: { provider: 'google', email },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });
        } else {
            // Returning Social User
            // Update Supabase UID link if they previously used email auth or had a ghost record
            if (!dbUser.supabase_uid) {
                dbUser = await prisma.user.update({
                    where: { id: dbUser.id },
                    data: {
                        supabase_uid: sbUser.id,
                        is_verified: true,
                        profileImage: dbUser.profileImage || profileImage
                    }
                });
            }

            await auditService.logEvent({
                userId: dbUser.id,
                action: AUDIT_ACTIONS.GOOGLE_LOGIN,
                details: { provider: 'google', email },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });
        }

        // 4. Verification Check
        if (!dbUser.is_active || dbUser.is_locked) {
            return res.status(403).json({
                success: false,
                message: 'Your account is currently disabled. Please contact support.',
            });
        }

        // 5. Update last login
        await prisma.user.update({
            where: { id: dbUser.id },
            data: { last_login_at: new Date() }
        });

        // 6. Set Refresh Token in httpOnly cookie (Standardized with auth.controller)
        res.cookie(JWT_CONFIG.REFRESH_TOKEN_COOKIE_NAME, sessionData.session.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api/auth/refresh',
        });

        // 7. Success Response
        return res.status(200).json({
            success: true,
            message: 'Google login successful.',
            data: {
                accessToken: sessionData.session.access_token,
                user: {
                    id: dbUser.id,
                    email: dbUser.email,
                    firstName: dbUser.firstName,
                    lastName: dbUser.lastName,
                    role: dbUser.role,
                    profileImage: dbUser.profileImage,
                    is_verified: dbUser.is_verified,
                },
            },
        });

    } catch (error: any) {
        console.error('[googleCallback] Unexpected Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred during Google synchronization.',
        });
    }
};
