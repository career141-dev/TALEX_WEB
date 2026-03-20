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
        let retries = 3;
        while (retries > 0) {
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
                return; // Success, exit loop
            } catch (error) {
                retries--;
                if (retries === 0) {
                    console.error('❌ Failed to create audit log after 3 attempts:', error);
                } else {
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, 500 * (4 - retries)));
                }
            }
        }
    }
}

export const auditService = new AuditService();
