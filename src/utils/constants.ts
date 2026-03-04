export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  REFRESH_TOKEN_COOKIE_NAME: 'refreshToken',
};

export const SECURITY_CONFIG = {
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  ACCOUNT_LOCK_DURATION: 15 * 60 * 1000, // 15 minutes
  OTP_EXPIRY_HOURS: 24,
  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: 1,
};

export const ROLES = {
  ADMIN: 'ADMIN',
  JUDGE: 'JUDGE',
  CANDIDATE: 'CANDIDATE',
} as const;

export type RoleValue = typeof ROLES[keyof typeof ROLES];
