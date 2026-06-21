export default () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3001),
    apiPrefix: process.env.API_PREFIX ?? 'api',

    databaseUrl: process.env.DATABASE_URL,

    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:3000',

    auth: {
        sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 7),
    },

    throttle: {
        ttl: Number(process.env.THROTTLE_TTL ?? 60),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
    },
});
