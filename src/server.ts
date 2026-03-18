import app from './app';
import { config } from './config/env';
import { connectDB } from './config/db';
import prisma from './lib/prisma';

const startServer = async () => {
    try {
        await connectDB();

        app.listen(config.PORT, () => {
            console.log(`🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received — shutting down`);
    await prisma.$disconnect();
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
