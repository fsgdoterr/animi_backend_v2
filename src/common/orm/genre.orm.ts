import { Prisma } from "../../generated/prisma/client";
import { ImageSelect } from "./image.orm";

export const GenreSelect = {
    id: true,
    slug: true,
    title: true,
    poster: {
        select: ImageSelect
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.GenreSelect;