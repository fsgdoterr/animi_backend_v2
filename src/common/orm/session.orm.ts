import { Prisma } from "../../generated/prisma/client";

export const SessionSelect = {
    id: true,
    userId: true,
    hash: true,
    ip: true,
    userAgent: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.SessionSelect;