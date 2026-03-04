import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { JWT_CONFIG } from '../utils/constants';

class TokenService {
    private getAccessSecret(): string {
        if (!config.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured. Custom token generation is currently disabled.');
        }
        return config.JWT_SECRET;
    }

    private getRefreshSecret(): string {
        const secret = config.JWT_REFRESH_SECRET || config.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_REFRESH_SECRET or JWT_SECRET is not configured. Custom token generation is currently disabled.');
        }
        return secret;
    }

    generateAccessToken(payload: object): string {
        return jwt.sign(payload, this.getAccessSecret(), {
            expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
        });
    }

    generateRefreshToken(payload: object): string {
        return jwt.sign(payload, this.getRefreshSecret(), {
            expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
        });
    }

    verifyAccessToken(token: string): any {
        try {
            return jwt.verify(token, this.getAccessSecret());
        } catch (error) {
            return null;
        }
    }

    verifyRefreshToken(token: string): any {
        try {
            return jwt.verify(token, this.getRefreshSecret());
        } catch (error) {
            return null;
        }
    }
}

export const tokenService = new TokenService();
