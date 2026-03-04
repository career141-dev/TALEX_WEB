import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class AuditService {
    async logEvent({
        userId,
        action,
        details,
        ip,
        userAgent,
    }: {
        userId: string;
        action: string;
        details?: any;
        ip?: string;
        userAgent?: string;
    }) {
        try {
            await prisma.auditLog.create({
                data: {
                    user_id: userId,
                    action,
                    metadata: details || null,
                    ip_address: ip,
                    user_agent: userAgent,
                },
            });
        } catch (error) {
            console.error('❌ Failed to create audit log:', error);
            // We don't throw here to prevent blocking main flows if logging fails
        }
    }
}

export const auditService = new AuditService();
