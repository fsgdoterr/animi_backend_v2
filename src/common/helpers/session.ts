import { randomBytes, createHash } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;

export const sessionTtlMs = (days: number): number => {
    return days * 24 * 60 * 60 * 1000;
};

export const hashSessionToken = (token: string): string => {
    return createHash('sha256').update(token).digest('hex');
};

export const generateSessionToken = (userId: number) => {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + sessionTtlMs(7));

    return { token: tokenHash, expiresAt };
};
