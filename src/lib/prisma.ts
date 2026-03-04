import { PrismaClient } from '@prisma/client';

// Singleton pattern — prevents connection pool exhaustion under load.
// In development, hot-reload creates new module instances each time,
// so we store the client on `global` to reuse it across reloads.
// In production, the module is loaded once, so a simple const is enough.
const prisma = (global as any).prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    (global as any).prisma = prisma;
}

export default prisma;
