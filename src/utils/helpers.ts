// src/utils/helpers.ts
export const formatResponse = (status: string, message: string, data?: any) => {
    return { status, message, data };
};

// src/utils/constants.ts
export const JWT_EXPIRY = '24h';
