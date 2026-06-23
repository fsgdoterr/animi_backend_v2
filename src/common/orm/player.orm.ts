import { Prisma } from "../../generated/prisma/client";

export const PlayerSelect = {
    id: true,
    title: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.PlayerSelect;