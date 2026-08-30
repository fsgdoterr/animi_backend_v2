import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { ImageSelect } from '../../../common/orm/image.orm';
import { paginateById } from '../../../common/pagination';
import { Prisma } from '../../../generated/prisma/client';
import {
    AnimeRating,
    AnimeStatus,
    AnimeType,
    DubType,
} from '../../../generated/prisma/enums';
import {
    getPublicEpisodeStats,
    type PublicEpisodeStats,
} from '../common/public-episode-stats';
import {
    PublicAnimeFiltersDto,
    type PublicAnimeSort,
} from './dto/public-anime-filters.dto';

const PublicAnimeCardSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    engTitle: true,
    poster: { select: ImageSelect },
    rating: true,
    description: true,
    country: true,
    studio: true,
    producers: {
        select: { id: true, title: true },
        orderBy: [{ title: 'asc' as const }],
    },
    genres: {
        select: {
            id: true,
            slug: true,
            title: true,
            poster: { select: ImageSelect },
        },
    },
    releaseDate: true,
    episodesTotal: true,
    type: true,
    status: true,
    episodes: {
        where: { variants: { some: { isActive: true } } },
        orderBy: [{ number: 'desc' as const }],
        take: 1,
        select: {
            number: true,
            variants: {
                where: { isActive: true },
                select: { dubType: true },
            },
        },
    },
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

const PublicAnimeDetailsSelect = {
    ...PublicAnimeCardSelect,
    additionalImages: { select: ImageSelect },
    endDate: true,
    seasonNumber: true,
    partNumber: true,
    duration: true,
    mal: true,
    al: true,
} satisfies Prisma.AnimeSelect;

type SliderRow = {
    id: number;
    animeId: number;
    imageId: number | null;
    order: number;
    imagePath: string | null;
    imageAvatarAllowed: boolean | null;
};

type LatestVariantRow = {
    animeId: number;
    episodeNumber: number;
    variantCreatedAt: Date;
};

@Injectable()
export class PublicAnimeService {
    constructor(private readonly prisma: PrismaService) {}

    async home() {
        const [slider, latestAnime, latestEpisodes] = await Promise.all([
            this.getSlider(),
            this.getLatestAnime(18),
            this.getLatestEpisodes(18),
        ]);

        return { slider, latestAnime, latestEpisodes };
    }

    async meta() {
        const publicAnime = { status: { not: AnimeStatus.DRAFT } } as const;

        const [genres, producers, dubTeams, animeMeta, studioRows] = await Promise.all([
            this.prisma.genre.findMany({
                select: { id: true, slug: true, title: true },
                orderBy: { title: 'asc' },
            }),
            this.prisma.producer.findMany({
                where: {
                    animes: {
                        some: { status: { not: AnimeStatus.DRAFT } },
                    },
                },
                select: { id: true, title: true },
                orderBy: { title: 'asc' },
            }),
            this.prisma.dubTeam.findMany({
                select: { id: true, title: true },
                orderBy: { title: 'asc' },
            }),
            this.prisma.anime.findMany({
                where: publicAnime,
                select: {
                    country: true,
                    releaseDate: true,
                },
            }),
            this.prisma.anime.findMany({
                where: {
                    status: { not: AnimeStatus.DRAFT },
                    studio: { not: null },
                },
                distinct: ['studio'],
                select: { studio: true },
            }),
        ]);

        const countries = [
            ...new Set(
                animeMeta.flatMap(({ country }) =>
                    country?.trim() ? [country.trim()] : [],
                ),
            ),
        ].sort((a, b) => a.localeCompare(b));

        const studios = studioRows
            .flatMap(({ studio }) => (studio?.trim() ? [studio.trim()] : []))
            .sort((a, b) => a.localeCompare(b));

        const releaseYears = [
            ...new Set(
                animeMeta.flatMap(({ releaseDate }) =>
                    releaseDate ? [releaseDate.getUTCFullYear()] : [],
                ),
            ),
        ].sort((a, b) => b - a);

        return {
            genres,
            producers,
            dubTeams,
            countries,
            studios,
            releaseYears,
        };
    }

    async findAll(filters: PublicAnimeFiltersDto) {
        const where = this.publicWhere(filters);

        const result = await paginateById<any>({
            model: this.prisma.anime,
            pagination: {
                ...filters,
                page: filters.page ?? 1,
                limit: filters.limit ?? 24,
            },
            where,
            orderBy: this.getOrderBy(filters.sort),
            select: PublicAnimeCardSelect,
        });

        const ids = result.items.map((anime) => anime.id);
        const [episodeStats, reviewStats] = await Promise.all([
            getPublicEpisodeStats(this.prisma, ids),
            ids.length
                ? this.prisma.review.groupBy({
                      by: ['animeId'],
                      where: { animeId: { in: ids } },
                      _avg: { rating: true },
                  })
                : [],
        ]);
        const averageByAnime = new Map<number, number | null>(
            reviewStats.map(
                (stat): [number, number | null] => [
                    stat.animeId,
                    stat._avg.rating ?? null,
                ],
            ),
        );

        return {
            ...result,
            items: result.items.map((anime) =>
                this.toCard(
                    anime,
                    episodeStats.get(anime.id),
                    averageByAnime.get(anime.id) ?? null,
                ),
            ),
        };
    }

    async random() {
        const where: Prisma.AnimeWhereInput = {
            status: { not: AnimeStatus.DRAFT },
        };
        const count = await this.prisma.anime.count({ where });
        if (!count) throw new NotFoundException('Немає доступних аніме.');

        const skip = Math.floor(Math.random() * count);
        const anime = await this.prisma.anime.findFirst({
            where,
            orderBy: { id: 'asc' },
            skip,
            select: { id: true, slug: true, title: true },
        });
        if (!anime) throw new NotFoundException('Немає доступних аніме.');
        return anime;
    }

    async findOne(slug: string) {
        const anime = await this.prisma.anime.findFirst({
            where: {
                slug,
                status: { not: AnimeStatus.DRAFT },
            },
            select: PublicAnimeDetailsSelect,
        });
        if (!anime) throw new NotFoundException('Аніме не знайдено.');

        const [reviewStats, episodeStats] = await Promise.all([
            this.prisma.review.aggregate({
                where: { animeId: anime.id },
                _avg: { rating: true },
            }),
            getPublicEpisodeStats(this.prisma, [anime.id]),
        ]);

        return {
            ...this.toCard(anime, episodeStats.get(anime.id)),
            additionalImages: anime.additionalImages,
            country: anime.country,
            endDate: anime.endDate,
            seasonNumber: anime.seasonNumber,
            partNumber: anime.partNumber,
            duration: anime.duration,
            studio: anime.studio,
            mal: anime.mal,
            al: anime.al,
            producers: anime.producers,
            averageReviewRating: reviewStats._avg.rating,
        };
    }

    private async getSlider() {
        const rows = await this.prisma.$queryRaw<SliderRow[]>(Prisma.sql`
            SELECT
                h."id",
                h."animeId",
                h."imageId",
                h."order",
                i."path" AS "imagePath",
                i."isAvatarAllowed" AS "imageAvatarAllowed"
            FROM "HomeSliderItem" h
            LEFT JOIN "Image" i ON i."id" = h."imageId"
            ORDER BY h."order" ASC, h."id" ASC
        `);
        if (!rows.length) return [];

        const animes = await this.prisma.anime.findMany({
            where: {
                id: { in: rows.map((row) => row.animeId) },
                status: { not: AnimeStatus.DRAFT },
            },
            select: PublicAnimeCardSelect,
        });
        const byId = new Map(animes.map((anime) => [anime.id, anime]));
        const episodeStats = await getPublicEpisodeStats(
            this.prisma,
            animes.map((anime) => anime.id),
        );

        return rows.flatMap((row) => {
            const anime = byId.get(row.animeId);
            if (!anime) return [];
            return [
                {
                    id: row.id,
                    order: row.order,
                    anime: this.toCard(anime, episodeStats.get(anime.id)),
                    image:
                        row.imageId && row.imagePath
                            ? {
                                  id: row.imageId,
                                  path: row.imagePath,
                                  isAvatarAllowed: row.imageAvatarAllowed ?? false,
                              }
                            : null,
                },
            ];
        });
    }

    private async getLatestAnime(limit: number) {
        const items = await this.prisma.anime.findMany({
            where: { status: { not: AnimeStatus.DRAFT } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            select: PublicAnimeCardSelect,
        });
        const episodeStats = await getPublicEpisodeStats(
            this.prisma,
            items.map((anime) => anime.id),
        );
        return items.map((anime) => this.toCard(anime, episodeStats.get(anime.id)));
    }

    private async getLatestEpisodes(limit: number) {
        // DISTINCT ON guarantees one newest active variant per anime before the
        // final ordering, so one title cannot flood the home carousel.
        const rows = await this.prisma.$queryRaw<LatestVariantRow[]>(Prisma.sql`
            SELECT latest."animeId", latest."episodeNumber", latest."variantCreatedAt"
            FROM (
                SELECT DISTINCT ON (e."animeId")
                    e."animeId" AS "animeId",
                    e."number" AS "episodeNumber",
                    ev."createdAt" AS "variantCreatedAt"
                FROM "EpisodeVariant" ev
                INNER JOIN "Episode" e ON e."id" = ev."episodeId"
                INNER JOIN "Anime" a ON a."id" = e."animeId"
                WHERE ev."isActive" = true AND a."status" <> ${AnimeStatus.DRAFT}::"AnimeStatus"
                ORDER BY e."animeId", ev."createdAt" DESC, ev."id" DESC
            ) latest
            ORDER BY latest."variantCreatedAt" DESC
            LIMIT ${limit}
        `);
        if (!rows.length) return [];

        const animes = await this.prisma.anime.findMany({
            where: { id: { in: rows.map((row) => row.animeId) } },
            select: PublicAnimeCardSelect,
        });
        const byId = new Map(animes.map((anime) => [anime.id, anime]));
        const episodeStats = await getPublicEpisodeStats(
            this.prisma,
            animes.map((anime) => anime.id),
        );

        return rows.flatMap((row) => {
            const anime = byId.get(row.animeId);
            if (!anime) return [];
            return [
                {
                    ...this.toCard(anime, episodeStats.get(anime.id)),
                    latestEpisodeNumber: row.episodeNumber,
                    latestVariantAt: row.variantCreatedAt,
                },
            ];
        });
    }

    private publicWhere(filters: PublicAnimeFiltersDto): Prisma.AnimeWhereInput {
        const where: Prisma.AnimeWhereInput = {
            status: { not: AnimeStatus.DRAFT },
        };
        const and: Prisma.AnimeWhereInput[] = [];

        const search = filters.search?.trim();
        if (search) {
            and.push({
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { originalTitle: { contains: search, mode: 'insensitive' } },
                    { engTitle: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ],
            });
        }

        const statuses = this.enumCsv(filters.status, AnimeStatus).filter(
            (status) => status !== AnimeStatus.DRAFT,
        );
        const types = this.enumCsv(filters.type, AnimeType);
        const ratings = this.enumCsv(filters.ratings, AnimeRating);
        const dubTypes = this.enumCsv(filters.dubTypes, DubType);
        const genreIds = this.intCsv(filters.genres);
        const excludeGenreIds = this.intCsv(filters.excludeGenres);
        const countries = this.csv(filters.countries);
        const studios = this.csv(filters.studios);
        const producerIds = this.intCsv(filters.producers);
        const dubTeamIds = this.intCsv(filters.dubTeams);

        if (statuses.length) where.status = { in: statuses };
        if (types.length) where.type = { in: types };
        if (ratings.length) where.rating = { in: ratings };
        if (countries.length) where.country = { in: countries };
        if (studios.length) where.studio = { in: studios };

        const releaseFrom = this.releaseBoundary(filters.releaseFrom, false);
        const releaseTo = this.releaseBoundary(filters.releaseTo, true);

        if (releaseFrom || releaseTo) {
            where.releaseDate = {
                ...(releaseFrom ? { gte: releaseFrom } : {}),
                ...(releaseTo ? { lt: releaseTo } : {}),
            };
        }

        if (genreIds.length) {
            and.push({
                genres: {
                    some: { id: { in: genreIds } },
                },
            });
        }
        if (excludeGenreIds.length) {
            and.push({
                genres: {
                    none: { id: { in: excludeGenreIds } },
                },
            });
        }
        if (producerIds.length) {
            and.push({
                producers: {
                    some: { id: { in: producerIds } },
                },
            });
        }
        if (dubTeamIds.length || dubTypes.length) {
            and.push({
                episodes: {
                    some: {
                        variants: {
                            some: {
                                isActive: true,
                                ...(dubTypes.length
                                    ? { dubType: { in: dubTypes } }
                                    : {}),
                                ...(dubTeamIds.length
                                    ? { dubTeamId: { in: dubTeamIds } }
                                    : {}),
                            },
                        },
                    },
                },
            });
        }

        if (and.length) where.AND = and;
        return where;
    }

    private toCard(
        anime: any,
        episodeStats?: PublicEpisodeStats,
        averageReviewRating: number | null = null,
    ) {
        const latestEpisode = anime.episodes?.[0];
        return {
            id: anime.id,
            slug: anime.slug,
            title: anime.title,
            originalTitle: anime.originalTitle,
            engTitle: anime.engTitle,
            poster: anime.poster,
            rating: anime.rating,
            description: anime.description,
            country: anime.country,
            studio: anime.studio,
            producers: anime.producers ?? [],
            genres: anime.genres,
            releaseDate: anime.releaseDate,
            episodesTotal: anime.episodesTotal,
            type: anime.type,
            status: anime.status,
            latestEpisodeNumber: latestEpisode?.number ?? null,
            dubEpisodesCount: episodeStats?.dubEpisodesCount ?? 0,
            subEpisodesCount: episodeStats?.subEpisodesCount ?? 0,
            availableDubTypes: [
                ...new Set(
                    (latestEpisode?.variants ?? []).map(
                        (variant: { dubType: string }) => variant.dubType,
                    ),
                ),
            ],
            averageReviewRating,
            _count: anime._count,
            createdAt: anime.createdAt,
            updatedAt: anime.updatedAt,
        };
    }

    private getOrderBy(sort?: PublicAnimeSort): Prisma.AnimeOrderByWithRelationInput[] {
        switch (sort) {
            case 'old':
                return [{ createdAt: 'asc' }, { id: 'asc' }];
            case 'title':
                return [{ title: 'asc' }, { id: 'asc' }];
            case 'release':
                return [{ releaseDate: 'desc' }, { id: 'desc' }];
            case 'views':
                return [{ views: { _count: 'desc' } }, { id: 'desc' }];
            default:
                return [{ createdAt: 'desc' }, { id: 'desc' }];
        }
    }

    private releaseBoundary(value: string | undefined, isUpperBoundary: boolean) {
        if (!value) return null;

        if (/^\d{4}$/.test(value)) {
            const year = Number(value);
            return new Date(Date.UTC(year + (isUpperBoundary ? 1 : 0), 0, 1));
        }

        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    private csv(value?: string) {
        if (!value) return [];

        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed: unknown = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed
                        .filter(
                            (item): item is string => typeof item === 'string',
                        )
                        .map((item) => item.trim())
                        .filter(Boolean);
                }
            } catch {
                // Keep backwards compatibility with the existing CSV query format.
            }
        }

        return trimmed
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    private intCsv(value?: string) {
        return this.csv(value)
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0);
    }

    private enumCsv<T extends Record<string, string>>(
        value: string | undefined,
        source: T,
    ) {
        const allowed = new Set(Object.values(source));
        return this.csv(value).filter((item) => allowed.has(item)) as T[keyof T][];
    }
}
