export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  REFRESH_TOKEN_COOKIE_NAME: 'refreshToken',
};

export const SECURITY_CONFIG = {
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  MAX_OTP_ATTEMPTS: 5,                     // Max wrong guesses before OTP is locked
  ACCOUNT_LOCK_DURATION: 15 * 60 * 1000,  // 15 minutes in ms
  OTP_EXPIRY_HOURS: 24,                    // Email verification OTP: 24 hours
  OTP_RESET_EXPIRY_MINUTES: 15,            // Password reset OTP: 15 minutes (tighter window)
  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: 1,
};

export const ROLES = {
  ADMIN: 'ADMIN',
  JUDGE: 'JUDGE',
  CANDIDATE: 'CANDIDATE',
} as const;

export type RoleValue = typeof ROLES[keyof typeof ROLES];
