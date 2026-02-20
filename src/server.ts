import app from './app';
import { config } from './config/env';
import { connectDB } from './config/db';

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

startServer();
