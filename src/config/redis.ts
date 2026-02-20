import Redis from 'ioredis';
import { config } from './env';

const redisUrl = config?.REDIS_URL;

if (!redisUrl) {
    console.warn('⚠️ REDIS_URL not found in config. Redis client will not be initialized.');
}

const redis = new Redis(redisUrl || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true, // Don't connect immediately
});

redis.on('connect', () => {
    console.log('✅ Connected to Redis');
});

redis.on('error', (err: Error) => {
    console.error('❌ Redis connection error:', err.message);
});

export default redis;
