import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const envSchema = z.object({
    PORT: z.coerce.number().default(5000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    FRONTEND_URL: z.string().url(),
    BACKEND_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string(),
    SUPABASE_SERVICE_KEY: z.string(),

    // Core Email Config: Required for OTP flow
    BREVO_API_KEY: z.string().min(1, 'BREVO_API_KEY is required for verification emails'),
    FROM_EMAIL: z.string().email(),
    FROM_NAME: z.string().default('Talex Awards'),

    // Auth Config: Supabase handles tokens currently, these are reserved for future custom JWT use
    JWT_SECRET: z.string().min(32).optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(parsedEnv.error.format(), null, 2));
    throw new Error('Environment validation failed');
}

export const config = parsedEnv.data;
