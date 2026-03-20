import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { supabaseAdmin } from '../config/supabase';
import { emailService } from '../services/email.service';
import { auditService } from '../services/audit.service';
import { inviteUserSchema } from '../utils/validation';
import { AUDIT_ACTIONS } from '../utils/constants';

/**
 * Invites a new Admin or Judge to the platform.
 * Protected by requireAuth and requireRole(ADMIN).
 */
export const inviteUser = async (req: AuthRequest, res: Response): Promise<void> => {
    // 1. Validate request body
    const validated = inviteUserSchema.safeParse(req.body);
    if (!validated.success) {
        res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validated.error.flatten().fieldErrors,
        });
        return;
    }

    const { email, firstName, lastName, role } = validated.data;

    // 2. Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        res.status(409).json({
            success: false,
            message: 'A user with this email already exists.',
        });
        return;
    }

    let supabaseUserId: string | null = null;

    try {
        // 3. Create Supabase account (no password yet)
        const { data: sbData, error: sbError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { firstName, lastName, role },
            app_metadata: { role } // Store in app_metadata for JWT claims
        });

        if (sbError || !sbData?.user) {
            throw new Error(sbError?.message || 'Supabase account creation failed');
        }

        supabaseUserId = sbData.user.id;

        // 4. Create user record in Prisma
        // Using a transaction to ensure both User and Invite Token are created together
        const { newUser, tokenValue } = await prisma.$transaction(async (tx: any) => {
            const user = await tx.user.create({
                data: {
                    supabase_uid: supabaseUserId,
                    firstName,
                    lastName,
                    email,
                    password_hash: '', // Will be set during password activation
                    company: process.env.FROM_NAME || 'Talex Awards',
                    designation: role === 'ADMIN' ? 'Administrator' : 'Judge',
                    role,
                    is_verified: false, // Activated after password setup
                    invited_by: req.user?.dbId,
                    invited_at: new Date(),
                },
            });

            const token = uuidv4();
            const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

            await tx.emailToken.create({
                data: {
                    user_id: user.id,
                    token,
                    type: 'INVITE',
                    expires_at: expiresAt,
                },
            });

            return { newUser: user, tokenValue: token };
        });

        // 5. Send invitation email via Brevo
        const inviteLink = `${process.env.FRONTEND_URL}/auth/accept-invite?token=${tokenValue}`;

        await emailService.sendInviteEmail({
            to: email,
            name: `${firstName} ${lastName}`,
            role,
            inviteLink,
            expiresIn: '48 hours'
        });

        // 6. Log the security event
        await auditService.logEvent({
            userId: req.user!.dbId,
            action: AUDIT_ACTIONS.STAFF_INVITED,
            details: {
                invitedEmail: email,
                role,
                entityId: newUser.id,
                entityType: 'User'
            },
            ip: req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        res.status(201).json({
            success: true,
            message: `Invitation sent to ${email}. Link expires in 48 hours.`,
        });

    } catch (error: any) {
        // Rollback: delete Supabase account if Prisma or Email failed
        if (supabaseUserId) {
            console.log(`[inviteUser] Rolling back Supabase user: ${supabaseUserId}`);
            await supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
        }

        console.error('[inviteUser] Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to process invitation. Please try again.',
        });
    }
};
