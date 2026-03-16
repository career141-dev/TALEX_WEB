import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { supabase, supabaseAdmin } from '../config/supabase';
import { emailService } from '../services/email.service';
import { auditService } from '../services/audit.service';
import { SECURITY_CONFIG, ROLES, AUDIT_ACTIONS } from '../utils/constants';
import { AuthRequest } from '../middleware/auth.middleware';
import { acceptInviteSchema } from '../utils/validation';

class AuthController {
    // 1. Register — Ghost-Account-Safe with Anti-Enumeration
    async register(req: Request, res: Response): Promise<void> {
        const { email, password, firstName, lastName, company, designation, phone, address } = req.body;

        // Anti-enumeration: same response whether email exists or not
        const NEUTRAL_RESPONSE = {
            success: true,
            message: 'If this email is new, a verification code has been sent.',
        };

        let supabaseUserId: string | null = null;

        try {
            // Silently check for existing user — do NOT reveal if email exists
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                res.status(201).json(NEUTRAL_RESPONSE);
                return;
            }

            // Step 1: Create in Supabase Auth via admin (skips Supabase's own email confirmation)
            const { data: sbData, error: sbError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true, // We handle verification ourselves via OTP
                // user_metadata is user-editable — keep display fields here only
                user_metadata: { first_name: firstName, last_name: lastName },
                // app_metadata is service-role-only — role MUST go here, never user_metadata
                app_metadata: { role: ROLES.CANDIDATE },
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
                    address,
                    supabase_uid: supabaseUserId,
                    role: 'CANDIDATE',
                    is_verified: false,
                    is_active: true,
                },
            });

            // Step 4: Generate cryptographically secure 6-digit OTP
            const otp = crypto.randomInt(100000, 999999).toString();
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

            // Step 5: Send OTP via Brevo — fail gracefully (user is created; flag for retry if email fails)
            emailService.sendVerificationEmail(email, `${firstName} ${lastName}`, otp).catch((err) => {
                console.error('⚠️ Verification email failed to send (user still created):', err.message);
                // TODO: push to a retry queue (e.g. a pending_emails table) so the user can request resend
            });

            // Step 6: Audit log — non-critical, must not fail the registration response
            auditService.logEvent({
                userId: user.id,
                action: 'USER_REGISTERED',
                details: { email },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            }).catch((err) => {
                console.error('⚠️ Audit log failed for USER_REGISTERED:', err.message);
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

    // 1.1 Resend Verification OTP
    async resendOtp(req: Request, res: Response): Promise<void> {
        const { email } = req.body;

        // Anti-enumeration: same response whether user exists/needs verification or not
        const SUCCESS_RESPONSE = {
            success: true,
            message: 'If this email requires verification, a new code has been sent.',
        };

        try {
            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, firstName: true, lastName: true, is_verified: true, supabase_uid: true },
            });

            // If user doesn't exist or is already verified, return success silently
            if (!user || user.is_verified) {
                res.status(200).json(SUCCESS_RESPONSE);
                return;
            }

            // Invalidate any previous unused verification tokens
            await prisma.emailToken.updateMany({
                where: { user_id: user.id, type: 'EMAIL_VERIFY', used_at: null },
                data: { used_at: new Date() },
            });

            // Generate new 6-digit OTP
            const otp = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + SECURITY_CONFIG.OTP_EXPIRY_HOURS * 60 * 60 * 1000);

            await prisma.emailToken.create({
                data: {
                    user_id: user.id,
                    type: 'EMAIL_VERIFY',
                    token: otp,
                    expires_at: expiresAt,
                },
            });

            // Send email (fire-and-forget)
            emailService.sendVerificationEmail(email, `${user.firstName} ${user.lastName}`, otp).catch((err) => {
                console.error('⚠️ Resend verification email failed:', err.message);
            });

            auditService.logEvent({
                userId: user.id,
                action: 'OTP_RESENT',
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            }).catch((err) => {
                console.error('⚠️ Audit log failed for OTP_RESENT:', err.message);
            });

            res.status(200).json(SUCCESS_RESPONSE);

        } catch (error: any) {
            console.error('Resend OTP Error:', error.message);
            res.status(500).json({ success: false, error: 'Failed to resend verification code' });
        }
    }

    // 2. Verify OTP
    async verifyOtp(req: Request, res: Response): Promise<void> {
        const { email, otp } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                // Anti-enumeration: don't reveal whether the email exists
                res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
                return;
            }

            // Find the token by user + type first (not by OTP value) to track attempts
            const emailToken = await prisma.emailToken.findFirst({
                where: {
                    user_id: user.id,
                    type: 'EMAIL_VERIFY',
                    used_at: null,
                    expires_at: { gt: new Date() },
                },
                orderBy: { created_at: 'desc' },
            });

            if (!emailToken) {
                res.status(400).json({ success: false, error: 'No active verification code found. Please register again.' });
                return;
            }

            // Check attempt limit (max 5 guesses per OTP)
            const MAX_OTP_ATTEMPTS = SECURITY_CONFIG.MAX_OTP_ATTEMPTS;
            if (emailToken.attempts >= MAX_OTP_ATTEMPTS) {
                await auditService.logEvent({
                    userId: user.id,
                    action: 'SUSPICIOUS_OTP_EXHAUSTED',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    details: { type: 'EMAIL_VERIFY', attempts: emailToken.attempts }
                });
                res.status(400).json({ success: false, error: 'Too many incorrect attempts. Please request a new verification code.' });
                return;
            }

            // Wrong OTP — increment attempt counter
            if (emailToken.token !== otp) {
                await prisma.emailToken.update({
                    where: { id: emailToken.id },
                    data: { attempts: { increment: 1 } },
                });

                await auditService.logEvent({
                    userId: user.id,
                    action: 'AUTH_VERIFICATION_FAILED',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    details: { currentAttempts: emailToken.attempts + 1 }
                });

                const remaining = MAX_OTP_ATTEMPTS - (emailToken.attempts + 1);
                res.status(400).json({ success: false, error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
                return;
            }

            // Correct OTP — verify user and mark token as used
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

            // Check account lock — auto-reset if lockout period has expired
            if (user.is_locked && user.locked_until) {
                if (user.locked_until > new Date()) {
                    // Still locked
                    res.status(403).json({ success: false, error: 'Account is temporarily locked. Try again later.' });
                    return;
                }
                // Lockout expired — reset in DB and sync local object to avoid stale reads downstream
                await prisma.user.update({
                    where: { id: user.id },
                    data: { is_locked: false, login_attempts: 0, locked_until: null },
                });

                await auditService.logEvent({
                    userId: user.id,
                    action: 'ACCOUNT_AUTO_UNLOCKED',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                });

                user.is_locked = false;
                user.login_attempts = 0;
                user.locked_until = null;
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

                if (isLockingNow) {
                    await auditService.logEvent({
                        userId: user.id,
                        action: 'ACCOUNT_LOCKED',
                        ip: req.ip,
                        userAgent: req.headers['user-agent'],
                        details: { attempts }
                    });
                }

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

            // Log session refresh
            if (data.session.user.id) {
                const dbUser = await prisma.user.findUnique({
                    where: { supabase_uid: data.session.user.id },
                    select: { id: true }
                });

                if (dbUser) {
                    await auditService.logEvent({
                        userId: dbUser.id,
                        action: 'SESSION_REFRESHED',
                        ip: req.ip,
                        userAgent: req.headers['user-agent'],
                    });
                }
            }

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
            // scope: 'local' = logs out this device only (clears the current session token)
            // scope: 'global' = invalidates ALL sessions across all devices — use for security events like password change
            await supabase.auth.signOut({ scope: 'local' });
            res.clearCookie('refreshToken', { path: '/api/auth/refresh' });

            if (req.user) {
                await auditService.logEvent({
                    userId: req.user.dbId,
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
        if (!req.user) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }

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

    // 7. Forgot Password — request OTP
    async forgotPassword(req: Request, res: Response): Promise<void> {
        const { email } = req.body;

        // Always return the same message — prevents email enumeration
        const GENERIC = 'If an account exists for this email, a reset code has been sent.';

        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                res.status(200).json({ success: true, message: GENERIC });
                return;
            }

            // Invalidate any previous unused PASSWORD_RESET tokens for this user
            await prisma.emailToken.updateMany({
                where: { user_id: user.id, type: 'PASSWORD_RESET', used_at: null },
                data: { used_at: new Date() },
            });

            // Generate cryptographically secure 6-digit OTP
            const otp = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + SECURITY_CONFIG.OTP_RESET_EXPIRY_MINUTES * 60 * 1000);

            await prisma.emailToken.create({
                data: {
                    user_id: user.id,
                    token: otp,
                    type: 'PASSWORD_RESET',
                    expires_at: expiresAt,
                },
            });

            await emailService.sendPasswordResetOtp(email, `${user.firstName} ${user.lastName}`, otp);

            await auditService.logEvent({
                userId: user.id,
                action: 'PASSWORD_RESET_REQUESTED',
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            res.status(200).json({ success: true, message: GENERIC });
        } catch (error: any) {
            console.error('Forgot Password Error:', error.message);
            res.status(500).json({ success: false, error: 'Failed to process request. Please try again.' });
        }
    }

    // 8. Reset Password — verify OTP + set new password
    async resetPassword(req: Request, res: Response): Promise<void> {
        const { email, otp, newPassword } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                res.status(400).json({ success: false, error: 'Invalid request' });
                return;
            }


            // Find the latest valid, unused PASSWORD_RESET OTP
            const record = await prisma.emailToken.findFirst({
                where: {
                    user_id: user.id,
                    type: 'PASSWORD_RESET',
                    used_at: null,
                    expires_at: { gt: new Date() },
                },
                orderBy: { created_at: 'desc' },
            });

            if (!record) {
                res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
                return;
            }

            // Check attempt limit (max 5 guesses per OTP)
            const MAX_OTP_ATTEMPTS = 5;
            if (record.attempts >= MAX_OTP_ATTEMPTS) {
                await auditService.logEvent({
                    userId: user.id,
                    action: 'SUSPICIOUS_OTP_EXHAUSTED',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    details: { type: 'PASSWORD_RESET', attempts: record.attempts }
                });
                res.status(400).json({ success: false, error: 'Too many incorrect attempts. Please request a new reset code.' });
                return;
            }

            // Wrong OTP — increment attempt counter
            if (record.token !== otp) {
                await prisma.emailToken.update({
                    where: { id: record.id },
                    data: { attempts: { increment: 1 } },
                });

                await auditService.logEvent({
                    userId: user.id,
                    action: 'PASSWORD_RESET_FAILED',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    details: { currentAttempts: record.attempts + 1 }
                });

                const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
                res.status(400).json({ success: false, error: `Invalid reset code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
                return;
            }

            // Hash new password and update in Prisma + Supabase
            const password_hash = await bcrypt.hash(newPassword, SECURITY_CONFIG.BCRYPT_ROUNDS);

            await prisma.$transaction([
                prisma.user.update({
                    where: { id: user.id },
                    data: { password_hash, password_changed_at: new Date() },
                }),
                prisma.emailToken.update({
                    where: { id: record.id },
                    data: { used_at: new Date() },
                }),
            ]);

            // SECURITY NOTE: Supabase Admin API requires plaintext password — this is a
            // server-to-server HTTPS call only (never exposed to client). It is required
            // because our login() uses supabase.auth.signInWithPassword(), which validates
            // the password on Supabase's side to issue a session token.
            // Future refactor: move to pure bcrypt+JWT login to remove this dependency.
            if (user.supabase_uid) {
                // Update password in Supabase
                await supabaseAdmin.auth.admin.updateUserById(user.supabase_uid, {
                    password: newPassword,
                });

                // SECURITY BOOST: After password reset, invalidate ALL active sessions 
                // on all devices. This forces the user (and any potential attacker) 
                // to log in again with the new credentials.
                await supabaseAdmin.auth.admin.signOut(user.supabase_uid, 'global');
            }

            await auditService.logEvent({
                userId: user.id,
                action: 'PASSWORD_RESET_COMPLETED',
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            res.status(200).json({ success: true, message: 'Password updated. You can now log in.' });
        } catch (error: any) {
            console.error('Reset Password Error:', error.message);
            res.status(500).json({ success: false, error: 'Failed to reset password. Please try again.' });
        }
    }

    // ── 7. Accept Invite — Account Activation ──────────────────────────────
    async acceptInvite(req: Request, res: Response): Promise<void> {
        // 1. Validate request body
        const validated = acceptInviteSchema.safeParse(req.body);
        if (!validated.success) {
            res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validated.error.flatten().fieldErrors,
            });
            return;
        }

        const { token, password } = validated.data;

        // 2. Find and validate the INVITE token
        const tokenRecord = await prisma.emailToken.findFirst({
            where: { token, type: 'INVITE' },
            include: { user: true },
        });

        if (!tokenRecord) {
            res.status(404).json({ success: false, message: 'Invalid invitation link.' });
            return;
        }

        // 3. Expiry and Usage Checks
        if (new Date() > tokenRecord.expires_at) {
            res.status(410).json({
                success: false,
                message: 'This invitation link has expired. Please ask your administrator to resend it.',
            });
            return;
        }

        if (tokenRecord.used_at) {
            res.status(409).json({
                success: false,
                message: 'This invitation link has already been used. Please log in.',
            });
            return;
        }

        const user = tokenRecord.user;

        try {
            // 4. Hash the new password
            const password_hash = await bcrypt.hash(password, SECURITY_CONFIG.BCRYPT_ROUNDS);

            // 5. Atomic Update: User activation + Token usage
            await prisma.$transaction([
                // Update User
                prisma.user.update({
                    where: { id: user.id },
                    data: {
                        password_hash,
                        is_verified: true,
                        password_changed_at: new Date(),
                    },
                }),
                // Mark Token as used
                prisma.emailToken.update({
                    where: { id: tokenRecord.id },
                    data: { used_at: new Date() },
                }),
            ]);

            // 6. Synchronize with Supabase Auth
            if (user.supabase_uid) {
                await supabaseAdmin.auth.admin.updateUserById(
                    user.supabase_uid,
                    { password },
                );

                // Security Boost: Wipe any partial sessions
                await supabaseAdmin.auth.admin.signOut(user.supabase_uid, 'global');
            }

            // 7. Audit Log
            await auditService.logEvent({
                userId: user.id,
                action: AUDIT_ACTIONS.STAFF_ACCOUNT_ACTIVATED,
                details: { role: user.role },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });

            res.status(200).json({
                success: true,
                message: 'Account activated successfully. You can now log in.',
            });

        } catch (error: any) {
            console.error('[acceptInvite] Error:', error.message);
            res.status(500).json({
                success: false,
                message: 'Account activation failed. Please try again.',
            });
        }
    }
}

export const authController = new AuthController();
