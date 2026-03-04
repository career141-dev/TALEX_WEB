import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { supabase, supabaseAdmin } from '../config/supabase';
import { emailService } from '../services/email.service';
import { tokenService } from '../services/token.service';
import { auditService } from '../services/audit.service';
import { SECURITY_CONFIG, ROLES } from '../utils/constants';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();

class AuthController {
    // 1. Register — Ghost-Account-Safe with Anti-Enumeration
    async register(req: Request, res: Response): Promise<void> {
        const { email, password, firstName, lastName, company, designation, phone } = req.body;

        // Anti-enumeration: same response whether email exists or not
        const NEUTRAL_RESPONSE = {
            success: true,
            message: 'If this email is new, a verification code has been sent.',
        };

        // Silently check for existing user — do NOT reveal if email exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            res.status(201).json(NEUTRAL_RESPONSE);
            return;
        }

        let supabaseUserId: string | null = null;

        try {
            // Step 1: Create in Supabase Auth via admin (skips Supabase's own email confirmation)
            const { data: sbData, error: sbError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true, // We handle verification ourselves via OTP
                user_metadata: { first_name: firstName, last_name: lastName, role: ROLES.CANDIDATE },
            });

            if (sbError) {
                res.status(400).json({ success: false, error: sbError.message });
                return;
            }

            supabaseUserId = sbData.user.id;

            // Step 2: Hash password locally
            const password_hash = await bcrypt.hash(password, SECURITY_CONFIG.BCRYPT_ROUNDS);

            // Step 3: Create user in Prisma DB
            const user = await prisma.user.create({
                data: {
                    email,
                    password_hash,
                    firstName,
                    lastName,
                    company,
                    designation,
                    phone,
                    supabase_uid: supabaseUserId,
                    role: 'CANDIDATE',
                    is_verified: false,
                    is_active: true,
                },
            });

            // Step 4: Generate 6-digit OTP and store it
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + SECURITY_CONFIG.OTP_EXPIRY_HOURS);

            await prisma.emailToken.create({
                data: {
                    user_id: user.id,
                    token: otp,
                    type: 'EMAIL_VERIFY',
                    expires_at: expiresAt,
                },
            });

            // Step 5: Send OTP via Brevo
            await emailService.sendVerificationEmail(email, firstName, otp);

            // Step 6: Audit log
            await auditService.logEvent({
                userId: user.id,
                action: 'USER_REGISTERED',
                details: { email },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            res.status(201).json(NEUTRAL_RESPONSE);

        } catch (error: any) {
            // ROLLBACK: if Prisma failed after Supabase succeeded, delete Supabase user
            if (supabaseUserId) {
                await supabaseAdmin.auth.admin.deleteUser(supabaseUserId).catch(() => {
                    // Log for manual cleanup — do not throw, rollback is best-effort
                    console.error('⚠️ Rollback failed — ghost account may exist:', supabaseUserId);
                });
            }
            console.error('Registration Error:', error.message);
            res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
        }
    }

    // 2. Verify OTP
    async verifyOtp(req: Request, res: Response): Promise<void> {
        const { email, otp } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                res.status(404).json({ success: false, error: 'User not found' });
                return;
            }

            const emailToken = await prisma.emailToken.findFirst({
                where: {
                    user_id: user.id,
                    token: otp,
                    type: 'EMAIL_VERIFY',
                    used_at: null,
                    expires_at: { gt: new Date() },
                },
            });

            if (!emailToken) {
                res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
                return;
            }

            // Update user and token in transaction
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: user.id },
                    data: { is_verified: true },
                }),
                prisma.emailToken.update({
                    where: { id: emailToken.id },
                    data: { used_at: new Date() },
                }),
            ]);

            await auditService.logEvent({
                userId: user.id,
                action: 'EMAIL_VERIFIED',
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            res.status(200).json({ success: true, message: 'Email verified successfully. You can now log in.' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: 'Internal server error during verification' });
        }
    }

    // 3. Login
    async login(req: Request, res: Response): Promise<void> {
        const { email, password } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { email } });

            if (!user) {
                res.status(401).json({ success: false, error: 'Invalid email or password' });
                return;
            }

            // Check account lock
            if (user.is_locked && user.locked_until && user.locked_until > new Date()) {
                res.status(403).json({ success: false, error: 'Account is temporarily locked. Try again later.' });
                return;
            }

            const isPasswordValid = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordValid) {
                const attempts = user.login_attempts + 1;
                const isLockingNow = attempts >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS;

                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        login_attempts: attempts,
                        is_locked: isLockingNow,
                        locked_until: isLockingNow ? new Date(Date.now() + SECURITY_CONFIG.ACCOUNT_LOCK_DURATION) : null,
                    }
                });

                res.status(401).json({ success: false, error: 'Invalid email or password' });
                return;
            }

            if (!user.is_verified) {
                res.status(403).json({ success: false, error: 'Please verify your email before logging in.' });
                return;
            }

            // Supabase Login
            const { data: sbData, error: sbError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (sbError) {
                res.status(401).json({ success: false, error: sbError.message });
                return;
            }

            // Reset attempts and update last login
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    login_attempts: 0,
                    is_locked: false,
                    locked_until: null,
                    last_login_at: new Date(),
                }
            });

            await auditService.logEvent({
                userId: user.id,
                action: 'USER_LOGIN',
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            // Set refresh token in httpOnly cookie — cannot be read by JavaScript (XSS-safe)
            res.cookie('refreshToken', sbData.session?.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/api/auth/refresh', // Only sent to this specific endpoint
            });

            res.status(200).json({
                success: true,
                data: {
                    accessToken: sbData.session?.access_token,
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        role: user.role,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: 'Internal server error during login' });
        }
    }

    // 4. Refresh Token — silently exchange cookie for a new access token
    async refreshToken(req: Request, res: Response): Promise<void> {
        const token = req.cookies?.refreshToken;

        if (!token) {
            res.status(401).json({ success: false, error: 'No refresh token provided' });
            return;
        }

        try {
            const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });

            if (error || !data.session) {
                res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
                res.status(401).json({ success: false, error: 'Refresh token expired. Please log in again.' });
                return;
            }

            // Rotate refresh token — set the new one in the cookie
            res.cookie('refreshToken', data.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/api/auth/refresh',
            });

            res.status(200).json({
                success: true,
                data: { accessToken: data.session.access_token },
            });
        } catch (error) {
            res.status(401).json({ success: false, error: 'Session refresh failed' });
        }
    }

    // 5. Logout
    async logout(req: AuthRequest, res: Response): Promise<void> {
        try {
            await supabase.auth.signOut();
            res.clearCookie('refreshToken', { path: '/api/auth/refresh' });

            if (req.user) {
                await auditService.logEvent({
                    userId: (req.user as any).id,
                    action: 'USER_LOGOUT',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                });
            }

            res.status(200).json({ success: true, message: 'Logged out successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Logout failed' });
        }
    }

    // 6. Get Profile
    async me(req: AuthRequest, res: Response): Promise<void> {
        try {
            const user = await prisma.user.findUnique({
                where: { supabase_uid: req.user.id },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    company: true,
                    designation: true,
                    phone: true,
                    role: true,
                    is_verified: true,
                    last_login_at: true,
                    created_at: true,
                }
            });

            if (!user) {
                res.status(404).json({ success: false, error: 'Profile not found' });
                return;
            }

            res.status(200).json({ success: true, data: user });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch profile' });
        }
    }
}

export const authController = new AuthController();
