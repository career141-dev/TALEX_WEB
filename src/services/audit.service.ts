import prisma from '../lib/prisma';
import { AuditAction } from '../utils/constants';

class AuditService {
    /**
     * Log a security event to the audit_logs table.
     * Fails open (logs error to console) to prevent blocking main flows.
     */
    async logEvent({
        userId,
        action,
        details,
        ip,
        userAgent,
    }: {
        userId?: string;
        action: AuditAction;
        details?: any;
        ip?: string;
        userAgent?: string;
    }) {
        try {
            // Normalise IP to remove IPv6 prefix if present
            const normalizedIp = ip?.startsWith('::ffff:') ? ip.slice(7) : ip;

            await prisma.auditLog.create({
                data: {
                    user_id: userId || null,
                    action,
                    metadata: details || null,
                    ip_address: normalizedIp,
                    user_agent: userAgent,
                },
            });
        } catch (error) {
            console.error('❌ Failed to create audit log:', error);
            // Non-critical failure: we don't throw to avoid crashing the request
        }
    }
}

export const auditService = new AuditService();
