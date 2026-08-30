import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { ImageSelect } from '../../../common/orm/image.orm';
import { Prisma } from '../../../generated/prisma/client';
import { AnimeStatus } from '../../../generated/prisma/enums';

const PublicBookmarkAnimeSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    engTitle: true,
    poster: { select: ImageSelect },
    type: true,
    status: true,
    episodesTotal: true,
} satisfies Prisma.AnimeSelect;

@Injectable()
export class PublicBookmarkService {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(userId: number, page = 1, limit = 30) {
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, Math.min(limit, 100));
        const where: Prisma.SubscriptionWhereInput = {
            userId,
            anime: { status: { not: AnimeStatus.DRAFT } },
        };

        const [items, totalCount] = await Promise.all([
            this.prisma.subscription.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
                select: {
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                    anime: { select: PublicBookmarkAnimeSelect },
                },
            }),
            this.prisma.subscription.count({ where }),
        ]);

        return {
            items,
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        };
    }

    async ids(userId: number) {
        const bookmarks = await this.prisma.subscription.findMany({
            where: {
                userId,
                anime: { status: { not: AnimeStatus.DRAFT } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { animeId: true },
        });

        return bookmarks.map((bookmark) => bookmark.animeId);
    }

    async add(userId: number, animeId: number) {
        const anime = await this.prisma.anime.findFirst({
            where: { id: animeId, status: { not: AnimeStatus.DRAFT } },
            select: { id: true },
        });
        if (!anime) throw new NotFoundException('Аніме не знайдено.');

        return this.prisma.subscription.upsert({
            where: { userId_animeId: { userId, animeId } },
            create: { userId, animeId },
            update: {},
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                anime: { select: PublicBookmarkAnimeSelect },
            },
        });
    }

    async remove(userId: number, animeId: number) {
        await this.prisma.subscription.deleteMany({ where: { userId, animeId } });
        return;
    }
}
