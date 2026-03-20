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

    // PayHere Payment Gateway Config ★ v3.0
    PAYHERE_MERCHANT_ID: z.string().min(1),
    PAYHERE_MERCHANT_SECRET: z.string().min(1),
    PAYHERE_SANDBOX: z.string().transform((v) => v === 'true'),
    PAYHERE_NOTIFY_URL: z.string().url(),
    PAYHERE_RETURN_URL: z.string().url(),
    PAYHERE_CANCEL_URL: z.string().url(),
    PAYMENT_AMOUNT: z.string().transform(Number),
    PAYMENT_CURRENCY: z.string().default('LKR'),

    SUPABASE_STORAGE_BUCKET: z.string().default('talex-applications'),
    SIGNED_URL_EXPIRY: z.coerce.number().default(3600),

    // ■■ Phase 4: AI Scoring ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o'),
    OPENAI_MINI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_MAX_TOKENS: z.coerce.number().default(1500),
    BULLMQ_REDIS_URL: z.string().url('BULLMQ_REDIS_URL must be a valid URL').refine(val => val.startsWith('rediss://') || val.startsWith('redis://'), { message: 'BULLMQ_REDIS_URL must start with rediss:// or redis://' }),
    AI_SCORE_VERSION: z.string().default('v1.0'),
    AI_QUEUE_NAME: z.string().default('talex-score-queue'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(parsedEnv.error.format(), null, 2));
    throw new Error('Environment validation failed');
}

export const config = parsedEnv.data;

