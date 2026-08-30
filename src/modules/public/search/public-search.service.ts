import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { ImageSelect } from '../../../common/orm/image.orm';
import { AnimeStatus } from '../../../generated/prisma/enums';
import { getPublicEpisodeStats } from '../common/public-episode-stats';
import { PublicSearchDto } from './dto/public-search.dto';

@Injectable()
export class PublicSearchService {
    constructor(private readonly prisma: PrismaService) {}

    async search({ query, limit = 5 }: PublicSearchDto) {
        const normalized = query.trim();
        if (!normalized) return { type: 'anime' as const, items: [] };

        if (normalized.startsWith('@')) {
            const userQuery = normalized.slice(1).trim();
            if (!userQuery) return { type: 'user' as const, items: [] };

            const items = await this.prisma.user.findMany({
                where: {
                    OR: [
                        { username: { contains: userQuery, mode: 'insensitive' } },
                        { displayName: { contains: userQuery, mode: 'insensitive' } },
                    ],
                },
                orderBy: [{ username: 'asc' }, { id: 'asc' }],
                take: limit,
                select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatar: { select: ImageSelect },
                },
            });
            return { type: 'user' as const, items };
        }

        const items = await this.prisma.anime.findMany({
            where: {
                status: { not: AnimeStatus.DRAFT },
                OR: [
                    { title: { contains: normalized, mode: 'insensitive' } },
                    { originalTitle: { contains: normalized, mode: 'insensitive' } },
                    { engTitle: { contains: normalized, mode: 'insensitive' } },
                    { description: { contains: normalized, mode: 'insensitive' } },
                ],
            },
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            take: limit,
            select: {
                id: true,
                slug: true,
                title: true,
                originalTitle: true,
                engTitle: true,
                poster: { select: ImageSelect },
                rating: true,
                type: true,
                status: true,
                episodesTotal: true,
                episodes: {
                    where: { variants: { some: { isActive: true } } },
                    orderBy: [{ number: 'desc' }],
                    take: 1,
                    select: { number: true },
                },
            },
        });

        const episodeStats = await getPublicEpisodeStats(
            this.prisma,
            items.map((anime) => anime.id),
        );

        return {
            type: 'anime' as const,
            items: items.map(({ episodes, ...anime }) => ({
                ...anime,
                latestEpisodeNumber: episodes[0]?.number ?? null,
                dubEpisodesCount: episodeStats.get(anime.id)?.dubEpisodesCount ?? 0,
                subEpisodesCount: episodeStats.get(anime.id)?.subEpisodesCount ?? 0,
            })),
        };
    }
}
