import { Prisma } from '../../generated/prisma/client';

export const ImageSelect = {
    id: true,
    path: true,
    sourceUrl: true,
    isAvatarAllowed: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ImageSelect;

export const ImageAdminSelect = {
    ...ImageSelect,
    _count: {
        select: {
            avatars: true,
            genres: true,
            animes: true,
            animeAdditionalImages: true,
        },
    },
    avatars: {
        take: 4,
        orderBy: [{ id: 'asc' as const }],
        select: {
            id: true,
            username: true,
            displayName: true,
        },
    },
    genres: {
        take: 4,
        orderBy: [{ title: 'asc' as const }],
        select: {
            id: true,
            title: true,
        },
    },
    animes: {
        take: 4,
        orderBy: [{ title: 'asc' as const }],
        select: {
            id: true,
            title: true,
        },
    },
    animeAdditionalImages: {
        take: 4,
        orderBy: [{ title: 'asc' as const }],
        select: {
            id: true,
            title: true,
        },
    },
} satisfies Prisma.ImageSelect;
