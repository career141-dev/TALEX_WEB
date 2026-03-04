import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { JWT_CONFIG } from '../utils/constants';

class TokenService {
    generateAccessToken(payload: object): string {
        return jwt.sign(payload, config.JWT_SECRET, {
            expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
        });
    }

    generateRefreshToken(payload: object): string {
        return jwt.sign(payload, config.JWT_REFRESH_SECRET || config.JWT_SECRET, {
            expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
        });
    }

    verifyAccessToken(token: string): any {
        try {
            return jwt.verify(token, config.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    verifyRefreshToken(token: string): any {
        try {
            return jwt.verify(token, config.JWT_REFRESH_SECRET || config.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }
}

export const tokenService = new TokenService();
