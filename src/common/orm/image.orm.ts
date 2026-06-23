import { Prisma } from "../../generated/prisma/client";

export const ImageSelect = {
    id: true,
    path: true,
    sourceUrl: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ImageSelect;