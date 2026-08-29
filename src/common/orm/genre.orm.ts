import { Prisma } from "../../generated/prisma/client";
import { ImageSelect } from "./image.orm";

export const GenreSelect = {
    id: true,
    slug: true,
    title: true,
    poster: {
        select: ImageSelect
    },
    _count: {
        select: {
            animes: true,
        },
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.GenreSelect;