import { Prisma } from '../../generated/prisma/client';
import { GenreSelect } from './genre.orm';
import { ImageSelect } from './image.orm';

const RelatedAnimeSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    engTitle: true,
    type: true,
    status: true,
    poster: { select: ImageSelect },
} satisfies Prisma.AnimeSelect;

export const AnimeSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    engTitle: true,
    poster: {
        select: ImageSelect,
    },
    additionalImages: {
        select: ImageSelect,
    },
    rating: true,
    description: true,
    country: true,
    genres: {
        select: GenreSelect,
    },
    relation: {
        select: {
            animes: {
                orderBy: [{ title: 'asc' }],
                select: RelatedAnimeSelect,
            },
        },
    },
    releaseDate: true,
    endDate: true,
    episodesTotal: true,
    seasonNumber: true,
    partNumber: true,
    duration: true,
    type: true,
    status: true,
    studio: true,
    mal: true,
    al: true,
    _count: {
        select: {
            episodes: true,
            reviews: true,
            views: true,
        },
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.AnimeSelect;

export const AnimeListSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    engTitle: true,
    poster: {
        select: ImageSelect,
    },
    genres: {
        select: GenreSelect,
    },
    rating: true,
    releaseDate: true,
    type: true,
    status: true,
    _count: {
        select: {
            episodes: true,
            reviews: true,
            views: true,
        },
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.AnimeSelect;
