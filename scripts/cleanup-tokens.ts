import { PrismaClient } from '@prisma/client';
import process from 'process';

const prisma = new PrismaClient();

/**
 * Maintenance script to clean up the email_tokens table.
 * Recommended to run via cron (e.g., daily at midnight).
 */
async function cleanupTokens() {
    console.log('🧹 Starting email_tokens cleanup...');

    try {
        const now = new Date();

        // Delete expired OR used tokens efficiently as an atomic operation
        // PR COMMENT: used_at is null if unused, expires_at is checked vs current time
        const result = await prisma.emailToken.deleteMany({
            where: {
                OR: [
                    { expires_at: { lt: now } },
                    { used_at: { not: null } }
                ]
            }
        });

        console.log(`✅ Cleanup complete: Deleted ${result.count} stale/used tokens.`);

    } catch (error) {
        console.error('❌ Token cleanup failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

cleanupTokens();
