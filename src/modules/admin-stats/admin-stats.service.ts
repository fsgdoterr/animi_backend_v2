import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { AnimeStatus } from '../../generated/prisma/enums';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminStatsService {
    constructor(private readonly prisma: PrismaService) {}

    async getDashboard() {
        const now = new Date();
        const since7 = new Date(now.getTime() - 7 * DAY);
        const since30 = new Date(now.getTime() - 30 * DAY);
        const since14 = new Date(now.getTime() - 13 * DAY);
        since14.setUTCHours(0, 0, 0, 0);

        const [
            animeTotal,
            userTotal,
            viewTotal,
            reviewTotal,
            subscriptionTotal,
            commentTotal,
            episodeTotal,
            activeVariantTotal,
            codeTotal,
            newUsers7,
            newUsers30,
            newAnime7,
            newAnime30,
            views7,
            views30,
            reviews30,
            subscriptions30,
            draftAnime,
            announcedAnime,
            ongoingAnime,
            completedAnime,
            canceledAnime,
            missingPoster,
            missingDescription,
            withoutEpisodes,
            episodesWithoutActiveVariant,
            ratingAggregate,
            topAnimeRaw,
            topCodes,
            recentUsers,
            recentAnime,
            viewRows,
            userRows,
        ] = await Promise.all([
            this.prisma.anime.count(),
            this.prisma.user.count(),
            this.prisma.view.count(),
            this.prisma.review.count(),
            this.prisma.subscription.count(),
            this.prisma.comment.count(),
            this.prisma.episode.count(),
            this.prisma.episodeVariant.count({ where: { isActive: true } }),
            this.prisma.animeCode.count(),
            this.prisma.user.count({ where: { createdAt: { gte: since7 } } }),
            this.prisma.user.count({ where: { createdAt: { gte: since30 } } }),
            this.prisma.anime.count({ where: { createdAt: { gte: since7 } } }),
            this.prisma.anime.count({ where: { createdAt: { gte: since30 } } }),
            this.prisma.view.count({ where: { createdAt: { gte: since7 } } }),
            this.prisma.view.count({ where: { createdAt: { gte: since30 } } }),
            this.prisma.review.count({ where: { createdAt: { gte: since30 } } }),
            this.prisma.subscription.count({ where: { createdAt: { gte: since30 } } }),
            this.prisma.anime.count({ where: { status: AnimeStatus.DRAFT } }),
            this.prisma.anime.count({ where: { status: AnimeStatus.ANNOUNCED } }),
            this.prisma.anime.count({ where: { status: AnimeStatus.ONGOING } }),
            this.prisma.anime.count({ where: { status: AnimeStatus.COMPLETED } }),
            this.prisma.anime.count({ where: { status: AnimeStatus.CANCELED } }),
            this.prisma.anime.count({ where: { posterId: null } }),
            this.prisma.anime.count({
                where: { OR: [{ description: null }, { description: '' }] },
            }),
            this.prisma.anime.count({ where: { episodes: { none: {} } } }),
            this.prisma.episode.count({
                where: { variants: { none: { isActive: true } } },
            }),
            this.prisma.review.aggregate({ _avg: { rating: true } }),
            this.prisma.anime.findMany({
                take: 6,
                where: { views: { some: {} } },
                orderBy: [{ views: { _count: 'desc' } }, { id: 'desc' }],
                select: {
                    id: true,
                    title: true,
                    status: true,
                    _count: {
                        select: {
                            views: true,
                            reviews: true,
                            subscriptions: true,
                        },
                    },
                },
            }),
            this.prisma.animeCode.findMany({
                take: 5,
                where: { views: { some: {} } },
                orderBy: [{ views: { _count: 'desc' } }, { id: 'desc' }],
                select: {
                    id: true,
                    code: true,
                    anime: { select: { id: true, title: true } },
                    _count: { select: { views: true } },
                },
            }),
            this.prisma.user.findMany({
                take: 5,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                    id: true,
                    username: true,
                    displayName: true,
                    role: true,
                    createdAt: true,
                },
            }),
            this.prisma.anime.findMany({
                take: 5,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                    id: true,
                    title: true,
                    status: true,
                    createdAt: true,
                },
            }),
            this.prisma.$queryRaw<Array<{ date: string; count: number }>>`
                SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
                FROM "View"
                WHERE "createdAt" >= ${since14}
                GROUP BY 1
                ORDER BY 1
            `,
            this.prisma.$queryRaw<Array<{ date: string; count: number }>>`
                SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
                FROM "User"
                WHERE "createdAt" >= ${since14}
                GROUP BY 1
                ORDER BY 1
            `,
        ]);

        const topAnimeRating = topAnimeRaw.length
            ? await this.prisma.review.groupBy({
                  by: ['animeId'],
                  where: { animeId: { in: topAnimeRaw.map((anime) => anime.id) } },
                  _avg: { rating: true },
              })
            : [];
        const ratingByAnime = new Map(
            topAnimeRating.map((item) => [item.animeId, item._avg.rating]),
        );

        return {
            overview: {
                anime: animeTotal,
                users: userTotal,
                views: viewTotal,
                reviews: reviewTotal,
                subscriptions: subscriptionTotal,
                comments: commentTotal,
                episodes: episodeTotal,
                activeVariants: activeVariantTotal,
                codes: codeTotal,
            },
            recent: {
                views7,
                views30,
                newUsers7,
                newUsers30,
                newAnime7,
                newAnime30,
                reviews30,
                subscriptions30,
            },
            contentHealth: {
                missingPoster,
                missingDescription,
                withoutEpisodes,
                episodesWithoutActiveVariant,
            },
            status: {
                DRAFT: draftAnime,
                ANNOUNCED: announcedAnime,
                ONGOING: ongoingAnime,
                COMPLETED: completedAnime,
                CANCELED: canceledAnime,
            },
            engagement: {
                averageRating: ratingAggregate._avg.rating,
            },
            activity: this.buildActivitySeries(since14, viewRows, userRows),
            topAnime: topAnimeRaw.map((anime) => ({
                id: anime.id,
                title: anime.title,
                status: anime.status,
                views: anime._count.views,
                reviews: anime._count.reviews,
                subscriptions: anime._count.subscriptions,
                averageRating: ratingByAnime.get(anime.id) ?? null,
            })),
            topCodes: topCodes.map((code) => ({
                id: code.id,
                code: code.code,
                anime: code.anime,
                views: code._count.views,
            })),
            recentUsers,
            recentAnime,
        };
    }

    async getAnimeStats(id: number) {
        const anime = await this.prisma.anime.findUnique({
            where: { id },
            select: {
                id: true,
                _count: {
                    select: {
                        episodes: true,
                        reviews: true,
                        subscriptions: true,
                        comments: true,
                        views: true,
                        playlistItems: true,
                        animeCodes: true,
                    },
                },
            },
        });
        if (!anime) throw new NotFoundException('Не існує аніме з таким айді.');

        const since7 = this.daysAgo(7);
        const since30 = this.daysAgo(30);
        const [views7, views30, reviewAggregate, variants, activeVariants] =
            await Promise.all([
                this.prisma.view.count({
                    where: {
                        createdAt: { gte: since7 },
                        animeView: { is: { animeId: id } },
                    },
                }),
                this.prisma.view.count({
                    where: {
                        createdAt: { gte: since30 },
                        animeView: { is: { animeId: id } },
                    },
                }),
                this.prisma.review.aggregate({
                    where: { animeId: id },
                    _avg: { rating: true },
                }),
                this.prisma.episodeVariant.count({
                    where: { episode: { animeId: id } },
                }),
                this.prisma.episodeVariant.count({
                    where: { episode: { animeId: id }, isActive: true },
                }),
            ]);

        return {
            views: anime._count.views,
            views7,
            views30,
            reviews: anime._count.reviews,
            averageRating: reviewAggregate._avg.rating,
            subscriptions: anime._count.subscriptions,
            comments: anime._count.comments,
            playlistAdds: anime._count.playlistItems,
            codes: anime._count.animeCodes,
            episodes: anime._count.episodes,
            variants,
            activeVariants,
        };
    }

    async getUserStats(id: number) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                _count: {
                    select: {
                        reviews: true,
                        subscriptions: true,
                        comments: true,
                        views: true,
                        playlists: true,
                        createdAnimes: true,
                        sessions: true,
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('Не існує користувача з таким айді.');

        const now = new Date();
        const since30 = this.daysAgo(30);
        const [views30, activeSessions, lastView, reviewAggregate] = await Promise.all([
            this.prisma.view.count({ where: { userId: id, createdAt: { gte: since30 } } }),
            this.prisma.session.count({ where: { userId: id, expiresAt: { gt: now } } }),
            this.prisma.view.findFirst({
                where: { userId: id },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }),
            this.prisma.review.aggregate({
                where: { userId: id },
                _avg: { rating: true },
            }),
        ]);

        return {
            views: user._count.views,
            views30,
            reviews: user._count.reviews,
            averageRating: reviewAggregate._avg.rating,
            subscriptions: user._count.subscriptions,
            comments: user._count.comments,
            playlists: user._count.playlists,
            createdAnime: user._count.createdAnimes,
            sessions: user._count.sessions,
            activeSessions,
            lastViewAt: lastView?.createdAt ?? null,
        };
    }

    async getGenreStats(id: number) {
        const genre = await this.prisma.genre.findUnique({
            where: { id },
            select: { id: true, _count: { select: { animes: true } } },
        });
        if (!genre) throw new NotFoundException('Не існує жанру з таким айді.');

        const [views, reviews, rating, ongoing, completed, announced] = await Promise.all([
            this.prisma.view.count({
                where: {
                    animeView: {
                        is: { anime: { genres: { some: { id } } } },
                    },
                },
            }),
            this.prisma.review.count({ where: { anime: { genres: { some: { id } } } } }),
            this.prisma.review.aggregate({
                where: { anime: { genres: { some: { id } } } },
                _avg: { rating: true },
            }),
            this.prisma.anime.count({
                where: { status: AnimeStatus.ONGOING, genres: { some: { id } } },
            }),
            this.prisma.anime.count({
                where: { status: AnimeStatus.COMPLETED, genres: { some: { id } } },
            }),
            this.prisma.anime.count({
                where: { status: AnimeStatus.ANNOUNCED, genres: { some: { id } } },
            }),
        ]);

        return {
            anime: genre._count.animes,
            views,
            reviews,
            averageRating: rating._avg.rating,
            ongoing,
            completed,
            announced,
        };
    }

    async getPlayerStats(id: number) {
        const exists = await this.prisma.player.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Не існує плеєра з таким айді.');

        const [variants, activeVariants, episodes, anime, dubTeams] = await Promise.all([
            this.prisma.episodeVariant.count({ where: { playerId: id } }),
            this.prisma.episodeVariant.count({ where: { playerId: id, isActive: true } }),
            this.prisma.episode.count({ where: { variants: { some: { playerId: id } } } }),
            this.prisma.anime.count({
                where: { episodes: { some: { variants: { some: { playerId: id } } } } },
            }),
            this.prisma.dubTeam.count({
                where: { episodeVariants: { some: { playerId: id } } },
            }),
        ]);
        return { variants, activeVariants, episodes, anime, dubTeams };
    }

    async getDubTeamStats(id: number) {
        const exists = await this.prisma.dubTeam.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Не існує команди озвучки з таким айді.');

        const [variants, activeVariants, episodes, anime, players] = await Promise.all([
            this.prisma.episodeVariant.count({ where: { dubTeamId: id } }),
            this.prisma.episodeVariant.count({ where: { dubTeamId: id, isActive: true } }),
            this.prisma.episode.count({ where: { variants: { some: { dubTeamId: id } } } }),
            this.prisma.anime.count({
                where: { episodes: { some: { variants: { some: { dubTeamId: id } } } } },
            }),
            this.prisma.player.count({
                where: { episodeVariants: { some: { dubTeamId: id } } },
            }),
        ]);
        return { variants, activeVariants, episodes, anime, players };
    }

    async getCodeStats(id: number) {
        const code = await this.prisma.animeCode.findUnique({
            where: { id },
            select: { id: true, _count: { select: { views: true } } },
        });
        if (!code) throw new NotFoundException('Не існує коду з таким айді.');

        const since7 = this.daysAgo(7);
        const since30 = this.daysAgo(30);
        const [views7, views30, authorizedViews, lastView] = await Promise.all([
            this.prisma.view.count({
                where: { createdAt: { gte: since7 }, animeCodeView: { is: { animeCodeId: id } } },
            }),
            this.prisma.view.count({
                where: { createdAt: { gte: since30 }, animeCodeView: { is: { animeCodeId: id } } },
            }),
            this.prisma.view.count({
                where: { userId: { not: null }, animeCodeView: { is: { animeCodeId: id } } },
            }),
            this.prisma.view.findFirst({
                where: { animeCodeView: { is: { animeCodeId: id } } },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }),
        ]);

        return {
            views: code._count.views,
            views7,
            views30,
            authorizedViews,
            lastViewedAt: lastView?.createdAt ?? null,
        };
    }

    private daysAgo(days: number) {
        return new Date(Date.now() - days * DAY);
    }

    private buildActivitySeries(
        start: Date,
        views: { date: string; count: number }[],
        users: { date: string; count: number }[],
    ) {
        const viewMap = new Map(views.map((row) => [row.date, row.count]));
        const userMap = new Map(users.map((row) => [row.date, row.count]));
        const result: { date: string; views: number; users: number }[] = [];

        for (let index = 0; index < 14; index++) {
            const day = new Date(start.getTime() + index * DAY);
            const key = day.toISOString().slice(0, 10);
            result.push({
                date: key,
                views: viewMap.get(key) ?? 0,
                users: userMap.get(key) ?? 0,
            });
        }
        return result;
    }

}
