import { Prisma } from "../../generated/prisma/client";

export const PlayerSelect = {
    id: true,
    title: true,
    _count: {
        select: {
            episodeVariants: true,
        },
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.PlayerSelect;
