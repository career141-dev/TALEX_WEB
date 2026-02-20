import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    FRONTEND_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:', parsedEnv.error.format());
    process.exit(1);
}

export const config = parsedEnv.data;
