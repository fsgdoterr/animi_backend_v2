import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { ImageSelect } from '../../../common/orm/image.orm';
import { paginateById } from '../../../common/pagination';
import { Prisma } from '../../../generated/prisma/client';
import {
    AnimeRating,
    AnimeStatus,
    AnimeType,
    CommentReactionType,
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
    seasonNumber: true,
    partNumber: true,
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
    relationId: true,
    episodes: {
        where: { variants: { some: { isActive: true } } },
        orderBy: [{ number: 'asc' as const }],
        select: {
            id: true,
            number: true,
            title: true,
            variants: {
                where: { isActive: true },
                orderBy: [{ dubType: 'asc' as const }, { id: 'asc' as const }],
                select: {
                    id: true,
                    sourceType: true,
                    endpoint: true,
                    dubType: true,
                    dubTeam: { select: { id: true, title: true } },
                    player: { select: { id: true, title: true } },
                },
            },
        },
    },
    endDate: true,
    seasonNumber: true,
    partNumber: true,
    duration: true,
    mal: true,
    al: true,
} satisfies Prisma.AnimeSelect;

const PublicCommentUserSelect = {
    id: true,
    username: true,
    displayName: true,
    role: true,
    avatar: { select: ImageSelect },
} satisfies Prisma.UserSelect;

const PublicCommentSelect = {
    id: true,
    animeId: true,
    parentId: true,
    text: true,
    createdAt: true,
    updatedAt: true,
    user: { select: PublicCommentUserSelect },
    commentReactions: { select: { type: true } },
} satisfies Prisma.CommentSelect;

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

        const [reviewStats, episodeStats, relatedAnimes] = await Promise.all([
            this.prisma.review.aggregate({
                where: { animeId: anime.id },
                _avg: { rating: true },
            }),
            getPublicEpisodeStats(this.prisma, [anime.id]),
            this.getRelatedAnime(anime.id, anime.relationId),
        ]);
        const recommendations = await this.getRecommendations(
            anime,
            new Set(relatedAnimes.map((item) => item.id)),
            12,
        );

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
            episodes: anime.episodes,
            relatedAnimes,
            recommendations,
            averageReviewRating: reviewStats._avg.rating,
        };
    }

    async comments(slug: string, page = 1, limit = 20, sort: 'new' | 'old' | 'top' = 'new') {
        const animeId = await this.getPublicAnimeId(slug);
        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
        const orderBy: Prisma.CommentOrderByWithRelationInput[] =
            sort === 'old'
                ? [{ createdAt: 'asc' }, { id: 'asc' }]
                : sort === 'top'
                  ? [{ commentReactions: { _count: 'desc' } }, { createdAt: 'desc' }]
                  : [{ createdAt: 'desc' }, { id: 'desc' }];

        const where = { animeId, parentId: null };
        const [items, totalCount] = await Promise.all([
            this.prisma.comment.findMany({
                where,
                orderBy,
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
                select: PublicCommentSelect,
            }),
            this.prisma.comment.count({ where }),
        ]);

        const repliesByRoot = await this.getRepliesByRoot(animeId, items);

        return {
            items: items.map((comment) =>
                this.toPublicComment(comment, null, repliesByRoot.get(comment.id) ?? []),
            ),
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        };
    }

    async createComment(slug: string, userId: number, text: string, parentId?: number) {
        const animeId = await this.getPublicAnimeId(slug);
        const normalized = text.trim();
        if (!normalized) throw new BadRequestException('Коментар не може бути порожнім.');

        const replyTo = parentId
            ? await this.prisma.comment.findFirst({
                  where: { id: parentId, animeId },
                  select: PublicCommentSelect,
              })
            : null;
        if (parentId && !replyTo) {
            throw new BadRequestException('Коментар, на який ви відповідаєте, не знайдено.');
        }

        const comment = await this.prisma.comment.create({
            data: { animeId, userId, parentId: parentId ?? null, text: normalized },
            select: PublicCommentSelect,
        });
        return this.toPublicComment(comment, replyTo ? this.toReplyTarget(replyTo) : null);
    }

    async getMyReview(slug: string, userId: number) {
        const animeId = await this.getPublicAnimeId(slug);
        const review = await this.prisma.review.findUnique({
            where: { userId_animeId: { userId, animeId } },
            select: { rating: true },
        });
        return { rating: review?.rating ?? null };
    }

    async rate(slug: string, userId: number, rating: number) {
        const animeId = await this.getPublicAnimeId(slug);
        await this.prisma.review.upsert({
            where: { userId_animeId: { userId, animeId } },
            create: { userId, animeId, rating },
            update: { rating },
        });
        const aggregate = await this.prisma.review.aggregate({
            where: { animeId },
            _avg: { rating: true },
            _count: { rating: true },
        });
        return {
            rating,
            averageReviewRating: aggregate._avg.rating,
            reviewsCount: aggregate._count.rating,
        };
    }

    async reactToComment(slug: string, commentId: number, userId: number, type: CommentReactionType) {
        const animeId = await this.getPublicAnimeId(slug);
        const comment = await this.prisma.comment.findFirst({
            where: { id: commentId, animeId },
            select: { id: true },
        });
        if (!comment) throw new NotFoundException('Коментар не знайдено.');

        const existing = await this.prisma.commentReaction.findUnique({
            where: { userId_commentId: { userId, commentId } },
            select: { id: true, type: true },
        });

        if (existing?.type === type) {
            await this.prisma.commentReaction.delete({ where: { id: existing.id } });
        } else if (existing) {
            await this.prisma.commentReaction.update({ where: { id: existing.id }, data: { type } });
        } else {
            await this.prisma.commentReaction.create({ data: { userId, commentId, type } });
        }

        const reactions = await this.prisma.commentReaction.groupBy({
            by: ['type'],
            where: { commentId },
            _count: { type: true },
        });
        const count = (reactionType: CommentReactionType) =>
            reactions.find((item) => item.type === reactionType)?._count.type ?? 0;

        return {
            likes: count(CommentReactionType.LIKE),
            dislikes: count(CommentReactionType.DISLIKE),
            reaction: existing?.type === type ? null : type,
        };
    }

    private async getPublicAnimeId(slug: string) {
        const anime = await this.prisma.anime.findFirst({
            where: { slug, status: { not: AnimeStatus.DRAFT } },
            select: { id: true },
        });
        if (!anime) throw new NotFoundException('Аніме не знайдено.');
        return anime.id;
    }

    private async getRelatedAnime(animeId: number, relationId: number | null) {
        if (!relationId) return [];
        const items = await this.prisma.anime.findMany({
            where: {
                relationId,
                id: { not: animeId },
                status: { not: AnimeStatus.DRAFT },
            },
            orderBy: [{ releaseDate: 'asc' }, { id: 'asc' }],
            select: PublicAnimeCardSelect,
        });
        return this.hydrateCards(items);
    }

    private async getRecommendations(anime: any, relatedIds: Set<number>, limit: number) {
        const excludedIds = [anime.id, ...relatedIds];
        const genreIds = anime.genres.map((item: { id: number }) => item.id);
        const producerIds = anime.producers.map((item: { id: number }) => item.id);
        const similarityCriteria: Prisma.AnimeWhereInput[] = [
            ...(genreIds.length ? [{ genres: { some: { id: { in: genreIds } } } }] : []),
            ...(producerIds.length ? [{ producers: { some: { id: { in: producerIds } } } }] : []),
            ...(anime.studio ? [{ studio: anime.studio }] : []),
            ...(anime.country ? [{ country: anime.country }] : []),
        ];
        if (!similarityCriteria.length) similarityCriteria.push({ type: anime.type });

        const candidates = await this.prisma.anime.findMany({
            where: {
                id: { notIn: excludedIds },
                status: { not: AnimeStatus.DRAFT },
                OR: similarityCriteria,
            },
            orderBy: [{ views: { _count: 'desc' } }, { createdAt: 'desc' }],
            take: 80,
            select: PublicAnimeCardSelect,
        });

        const viewsByAnime = new Map<number, number>(
            candidates.map((candidate) => [candidate.id, candidate._count.views ?? 0]),
        );
        const hydrated = await this.hydrateCards(candidates);
        const genreSet = new Set<number>(genreIds);
        const producerSet = new Set<number>(producerIds);
        const ranked = hydrated
            .map((candidate) => {
                const sharedGenres = candidate.genres.filter((genre) => genreSet.has(genre.id)).length;
                const sharedProducers = candidate.producers.filter((producer) => producerSet.has(producer.id)).length;
                const score =
                    sharedGenres * 5 +
                    sharedProducers * 3 +
                    (candidate.type === anime.type ? 2 : 0) +
                    (anime.studio && candidate.studio === anime.studio ? 2.5 : 0) +
                    (anime.country && candidate.country === anime.country ? 1 : 0) +
                    (anime.rating && candidate.rating === anime.rating ? 0.75 : 0) +
                    Math.min(2, Math.log10((viewsByAnime.get(candidate.id) ?? 0) + 1) / 2) +
                    ((candidate.averageReviewRating ?? 0) / 5) * 0.75;
                return { candidate, score };
            })
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    (viewsByAnime.get(b.candidate.id) ?? 0) -
                        (viewsByAnime.get(a.candidate.id) ?? 0),
            )
            .slice(0, limit)
            .map(({ candidate }) => candidate);

        if (ranked.length >= limit) return ranked;

        const fallback = await this.prisma.anime.findMany({
            where: {
                id: { notIn: [...excludedIds, ...ranked.map((item) => item.id)] },
                status: { not: AnimeStatus.DRAFT },
            },
            orderBy: [{ views: { _count: 'desc' } }, { createdAt: 'desc' }],
            take: limit - ranked.length,
            select: PublicAnimeCardSelect,
        });
        return [...ranked, ...(await this.hydrateCards(fallback))];
    }

    private async hydrateCards(items: any[]) {
        if (!items.length) return [];
        const ids = items.map((item) => item.id);
        const [episodeStats, reviewStats] = await Promise.all([
            getPublicEpisodeStats(this.prisma, ids),
            this.prisma.review.groupBy({
                by: ['animeId'],
                where: { animeId: { in: ids } },
                _avg: { rating: true },
            }),
        ]);
        const averageByAnime = new Map(reviewStats.map((item) => [item.animeId, item._avg.rating ?? null]));
        return items.map((item) =>
            this.toCard(item, episodeStats.get(item.id), averageByAnime.get(item.id) ?? null),
        );
    }

    private async getRepliesByRoot(animeId: number, roots: any[]) {
        const rootIds = roots.map((comment) => comment.id as number);
        const result = new Map<number, any[]>();
        rootIds.forEach((id) => result.set(id, []));
        if (!rootIds.length) return result;

        const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
            WITH RECURSIVE descendants AS (
                SELECT c."id", c."parentId"
                FROM "Comment" c
                WHERE c."animeId" = ${animeId}
                  AND c."parentId" IN (${Prisma.join(rootIds)})

                UNION ALL

                SELECT c."id", c."parentId"
                FROM "Comment" c
                INNER JOIN descendants d ON c."parentId" = d."id"
                WHERE c."animeId" = ${animeId}
            )
            SELECT "id" FROM descendants
        `);
        const descendantIds = rows.map((row) => row.id);
        if (!descendantIds.length) return result;

        const descendants = await this.prisma.comment.findMany({
            where: { animeId, id: { in: descendantIds } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: PublicCommentSelect,
        });
        const allComments = new Map<number, any>([
            ...roots.map((comment) => [comment.id as number, comment] as const),
            ...descendants.map((comment) => [comment.id as number, comment] as const),
        ]);
        const rootIdSet = new Set(rootIds);
        const rootMemo = new Map<number, number | null>();

        const resolveRootId = (comment: any) => {
            if (rootMemo.has(comment.id)) return rootMemo.get(comment.id) ?? null;
            let parentId = comment.parentId as number | null;
            const visited = new Set<number>([comment.id]);

            while (parentId) {
                if (rootIdSet.has(parentId)) {
                    rootMemo.set(comment.id, parentId);
                    return parentId;
                }
                if (visited.has(parentId)) break;
                visited.add(parentId);
                parentId = (allComments.get(parentId)?.parentId as number | null | undefined) ?? null;
            }

            rootMemo.set(comment.id, null);
            return null;
        };

        for (const comment of descendants) {
            const rootId = resolveRootId(comment);
            if (!rootId) continue;
            const replyTo = comment.parentId ? allComments.get(comment.parentId) : null;
            result.get(rootId)?.push(
                this.toPublicComment(comment, replyTo ? this.toReplyTarget(replyTo) : null),
            );
        }

        return result;
    }

    private toReplyTarget(comment: any) {
        return {
            id: comment.id,
            text: comment.text,
            user: comment.user,
        };
    }

    private toPublicComment(comment: any, replyTo: any = null, replies: any[] = []): any {
        const reactions = comment.commentReactions ?? [];
        return {
            id: comment.id,
            parentId: comment.parentId,
            text: comment.text,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
            user: comment.user,
            likes: reactions.filter((item: { type: CommentReactionType }) => item.type === CommentReactionType.LIKE).length,
            dislikes: reactions.filter((item: { type: CommentReactionType }) => item.type === CommentReactionType.DISLIKE).length,
            replyTo,
            replies,
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
        const latestEpisode = anime.episodes?.reduce(
            (latest: any, episode: any) => (!latest || episode.number > latest.number ? episode : latest),
            null,
        );
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
            seasonNumber: anime.seasonNumber,
            partNumber: anime.partNumber,
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
            _count: {
                episodes: anime._count?.episodes ?? 0,
                reviews: anime._count?.reviews ?? 0,
            },
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
            case 'popular':
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
