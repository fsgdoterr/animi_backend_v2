import { Prisma } from '../../generated/prisma/client';
import { ImageSelect } from './image.orm';

export const AnimeCodeSelect = {
    id: true,
    animeId: true,
    code: true,
    anime: {
        select: {
            id: true,
            slug: true,
            title: true,
            originalTitle: true,
            engTitle: true,
            type: true,
            status: true,
            poster: { select: ImageSelect },
        },
    },
    _count: {
        select: {
            views: true,
        },
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.AnimeCodeSelect;
