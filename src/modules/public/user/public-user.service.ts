import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import slugify from 'slugify';
import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { ImageSelect } from '../../../common/orm/image.orm';
import { Prisma } from '../../../generated/prisma/client';
import { AnimeStatus } from '../../../generated/prisma/enums';
import {
    CreatePublicPlaylistDto,
    CreatePublicPlaylistItemDto,
    UpdatePublicPlaylistDto,
    UpdatePublicPlaylistItemDto,
} from './dto/public-user.dto';

const PublicUserAnimeSelect = {
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

const PublicPlaylistSummarySelect = {
    id: true,
    slug: true,
    title: true,
    description: true,
    isPrivate: true,
    image: { select: ImageSelect },
    createdAt: true,
    updatedAt: true,
    _count: {
        select: {
            items: { where: { anime: { status: { not: AnimeStatus.DRAFT } } } },
        },
    },
    items: {
        where: { anime: { status: { not: AnimeStatus.DRAFT } } },
        orderBy: [{ order: 'asc' as const }],
        take: 1,
        select: { anime: { select: PublicUserAnimeSelect } },
    },
} satisfies Prisma.PlaylistSelect;

@Injectable()
export class PublicUserService {
    constructor(private readonly prisma: PrismaService) {}

    async profile(username: string, viewerId?: number) {
        const user = await this.getUser(username);
        const canSeePrivate = viewerId === user.id;
        const playlistWhere: Prisma.PlaylistWhereInput = {
            userId: user.id,
            ...(canSeePrivate ? {} : { isPrivate: false }),
        };

        const [playlists, reviewsCount, commentsCount, listItemsCount] =
            await Promise.all([
                this.prisma.playlist.findMany({
                    where: playlistWhere,
                    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                    select: PublicPlaylistSummarySelect,
                }),
                this.prisma.review.count({
                    where: {
                        userId: user.id,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                }),
                this.prisma.comment.count({
                    where: {
                        userId: user.id,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                }),
                this.prisma.playlistItem.count({
                    where: {
                        playlist: playlistWhere,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                }),
            ]);

        return {
            user,
            stats: {
                reviews: reviewsCount,
                comments: commentsCount,
                playlists: playlists.length,
                listItems: listItemsCount,
            },
            playlists: playlists.map(({ items, ...playlist }) => ({
                ...playlist,
                previewAnime: items[0]?.anime ?? null,
            })),
        };
    }

    async activity(username: string, page = 1, limit = 20, viewerId?: number) {
        const user = await this.getUser(username);
        const canSeePrivate = viewerId === user.id;
        const playlistWhere: Prisma.PlaylistWhereInput = {
            userId: user.id,
            ...(canSeePrivate ? {} : { isPrivate: false }),
        };
        const safePage = Math.max(1, Math.min(page, 50));
        const safeLimit = Math.max(1, Math.min(limit, 30));
        const take = safePage * safeLimit;

        const [comments, reviews, views, playlists, playlistItems, counts] =
            await Promise.all([
                this.prisma.comment.findMany({
                    where: {
                        userId: user.id,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take,
                    select: {
                        id: true,
                        text: true,
                        createdAt: true,
                        anime: { select: PublicUserAnimeSelect },
                    },
                }),
                this.prisma.review.findMany({
                    where: {
                        userId: user.id,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                    take,
                    select: {
                        id: true,
                        rating: true,
                        updatedAt: true,
                        anime: { select: PublicUserAnimeSelect },
                    },
                }),
                this.prisma.view.findMany({
                    where: {
                        userId: user.id,
                        animeView: {
                            is: { anime: { status: { not: AnimeStatus.DRAFT } } },
                        },
                    },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take,
                    select: {
                        id: true,
                        createdAt: true,
                        animeView: {
                            select: {
                                anime: { select: PublicUserAnimeSelect },
                            },
                        },
                    },
                }),
                this.prisma.playlist.findMany({
                    where: playlistWhere,
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take,
                    select: {
                        id: true,
                        slug: true,
                        title: true,
                        createdAt: true,
                    },
                }),
                this.prisma.playlistItem.findMany({
                    where: {
                        playlist: playlistWhere,
                        anime: { status: { not: AnimeStatus.DRAFT } },
                    },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take,
                    select: {
                        id: true,
                        description: true,
                        createdAt: true,
                        anime: { select: PublicUserAnimeSelect },
                        playlist: {
                            select: { id: true, slug: true, title: true },
                        },
                    },
                }),
                Promise.all([
                    this.prisma.comment.count({
                        where: {
                            userId: user.id,
                            anime: { status: { not: AnimeStatus.DRAFT } },
                        },
                    }),
                    this.prisma.review.count({
                        where: {
                            userId: user.id,
                            anime: { status: { not: AnimeStatus.DRAFT } },
                        },
                    }),
                    this.prisma.view.count({
                        where: {
                            userId: user.id,
                            animeView: {
                                is: { anime: { status: { not: AnimeStatus.DRAFT } } },
                            },
                        },
                    }),
                    this.prisma.playlist.count({ where: playlistWhere }),
                    this.prisma.playlistItem.count({
                        where: {
                            playlist: playlistWhere,
                            anime: { status: { not: AnimeStatus.DRAFT } },
                        },
                    }),
                ]),
            ]);

        const items = [
            ...comments.map((comment) => ({
                id: `comment-${comment.id}`,
                type: 'COMMENT' as const,
                occurredAt: comment.createdAt,
                anime: comment.anime,
                comment: { id: comment.id, text: comment.text },
            })),
            ...reviews.map((review) => ({
                id: `review-${review.id}`,
                type: 'REVIEW' as const,
                occurredAt: review.updatedAt,
                anime: review.anime,
                rating: review.rating,
            })),
            ...views.flatMap((view) =>
                view.animeView
                    ? [
                          {
                              id: `view-${view.id}`,
                              type: 'VIEW' as const,
                              occurredAt: view.createdAt,
                              anime: view.animeView.anime,
                          },
                      ]
                    : [],
            ),
            ...playlists.map((playlist) => ({
                id: `playlist-${playlist.id}`,
                type: 'PLAYLIST_CREATED' as const,
                occurredAt: playlist.createdAt,
                playlist: {
                    id: playlist.id,
                    slug: playlist.slug,
                    title: playlist.title,
                },
            })),
            ...playlistItems.map((item) => ({
                id: `playlist-item-${item.id}`,
                type: 'PLAYLIST_ITEM_ADDED' as const,
                occurredAt: item.createdAt,
                anime: item.anime,
                playlist: item.playlist,
                description: item.description,
            })),
        ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

        const totalCount = counts.reduce((sum, count) => sum + count, 0);
        const start = (safePage - 1) * safeLimit;

        return {
            items: items.slice(start, start + safeLimit),
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        };
    }

    async playlistImages(
        username: string,
        userId: number,
        page = 1,
        limit = 18,
        search?: string,
    ) {
        await this.assertOwner(username, userId);
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, Math.min(limit, 30));
        const normalizedSearch = search?.trim();
        const where: Prisma.ImageWhereInput = {
            isAvatarAllowed: true,
            ...(normalizedSearch
                ? {
                      OR: [
                          { path: { contains: normalizedSearch, mode: 'insensitive' } },
                          { sourceUrl: { contains: normalizedSearch, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        };

        const [items, totalCount] = await Promise.all([
            this.prisma.image.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
                select: { id: true, path: true, isAvatarAllowed: true },
            }),
            this.prisma.image.count({ where }),
        ]);

        return {
            items,
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        };
    }

    async playlist(username: string, slug: string, viewerId?: number) {
        const user = await this.getUser(username);
        const playlist = await this.prisma.playlist.findFirst({
            where: {
                userId: user.id,
                slug,
                ...(viewerId === user.id ? {} : { isPrivate: false }),
            },
            select: {
                id: true,
                slug: true,
                title: true,
                description: true,
                isPrivate: true,
                image: { select: ImageSelect },
                createdAt: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatar: { select: ImageSelect },
                    },
                },
                items: {
                    where: { anime: { status: { not: AnimeStatus.DRAFT } } },
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        order: true,
                        description: true,
                        createdAt: true,
                        updatedAt: true,
                        anime: { select: PublicUserAnimeSelect },
                    },
                },
            },
        });

        if (!playlist) throw new NotFoundException('Список не знайдено.');
        return playlist;
    }

    async createPlaylist(
        username: string,
        userId: number,
        dto: CreatePublicPlaylistDto,
    ) {
        const user = await this.assertOwner(username, userId);
        const title = dto.title.trim();
        const description = this.normalizeOptionalText(dto.description);

        const duplicateTitle = await this.prisma.playlist.findFirst({
            where: {
                userId: user.id,
                title: { equals: title, mode: 'insensitive' },
            },
            select: { id: true },
        });
        if (duplicateTitle) {
            throw new BadRequestException('Список з такою назвою вже існує.');
        }

        const slug = await this.createPlaylistSlug(user.id, title);
        let imageId: number | null = null;

        if (dto.imageId) {
            const image = await this.prisma.image.findFirst({
                where: { id: dto.imageId, isAvatarAllowed: true },
                select: { id: true },
            });
            if (!image) {
                throw new BadRequestException(
                    'Це зображення не дозволено використовувати для списку.',
                );
            }
            imageId = image.id;
        }

        const playlist = await this.prisma.playlist.create({
            data: {
                userId: user.id,
                slug,
                title,
                description,
                imageId,
                isPrivate: dto.isPrivate ?? false,
            },
            select: PublicPlaylistSummarySelect,
        });

        const { items, ...summary } = playlist;
        return { ...summary, previewAnime: items[0]?.anime ?? null };
    }

    async updatePlaylist(
        username: string,
        slug: string,
        userId: number,
        dto: UpdatePublicPlaylistDto,
    ) {
        const playlist = await this.getOwnedPlaylist(username, slug, userId);
        const updated = await this.prisma.playlist.update({
            where: { id: playlist.id },
            data: {
                ...(dto.isPrivate === undefined ? {} : { isPrivate: dto.isPrivate }),
            },
            select: PublicPlaylistSummarySelect,
        });

        const { items, ...summary } = updated;
        return { ...summary, previewAnime: items[0]?.anime ?? null };
    }

    async addPlaylistItem(
        username: string,
        slug: string,
        userId: number,
        dto: CreatePublicPlaylistItemDto,
    ) {
        const playlist = await this.getOwnedPlaylist(username, slug, userId);
        const itemCount = await this.prisma.playlistItem.count({
            where: { playlistId: playlist.id },
        });
        if (itemCount >= 30) {
            throw new BadRequestException('У списку може бути не більше 30 аніме.');
        }

        const anime = await this.prisma.anime.findFirst({
            where: { id: dto.animeId, status: { not: AnimeStatus.DRAFT } },
            select: { id: true },
        });
        if (!anime) throw new NotFoundException('Аніме не знайдено.');

        const existing = await this.prisma.playlistItem.findUnique({
            where: {
                playlistId_animeId: {
                    playlistId: playlist.id,
                    animeId: dto.animeId,
                },
            },
            select: { id: true },
        });
        if (existing) {
            throw new BadRequestException('Це аніме вже є у списку.');
        }

        const maxOrder = await this.prisma.playlistItem.aggregate({
            where: { playlistId: playlist.id },
            _max: { order: true },
        });

        return this.prisma.$transaction(async (tx) => {
            const item = await tx.playlistItem.create({
                data: {
                    playlistId: playlist.id,
                    animeId: dto.animeId,
                    order: (maxOrder._max.order ?? -1) + 1,
                    description: this.normalizeOptionalText(dto.description),
                },
                select: {
                    id: true,
                    order: true,
                    description: true,
                    createdAt: true,
                    updatedAt: true,
                    anime: { select: PublicUserAnimeSelect },
                },
            });

            if (dto.removeFromBookmarks) {
                await tx.subscription.deleteMany({
                    where: { userId, animeId: dto.animeId },
                });
            }

            return item;
        });
    }

    async updatePlaylistItem(
        username: string,
        slug: string,
        itemId: number,
        userId: number,
        dto: UpdatePublicPlaylistItemDto,
    ) {
        const playlist = await this.getOwnedPlaylist(username, slug, userId);
        const item = await this.prisma.playlistItem.findFirst({
            where: { id: itemId, playlistId: playlist.id },
            select: { id: true },
        });
        if (!item) throw new NotFoundException('Елемент списку не знайдено.');

        return this.prisma.playlistItem.update({
            where: { id: itemId },
            data: { description: this.normalizeOptionalText(dto.description) },
            select: {
                id: true,
                order: true,
                description: true,
                createdAt: true,
                updatedAt: true,
                anime: { select: PublicUserAnimeSelect },
            },
        });
    }

    async reorderPlaylistItems(
        username: string,
        slug: string,
        userId: number,
        orderedItemIds: number[],
    ) {
        const playlist = await this.getOwnedPlaylist(username, slug, userId);
        const items = await this.prisma.playlistItem.findMany({
            where: { playlistId: playlist.id },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true },
        });
        const existingIds = items.map((item) => item.id);

        if (
            new Set(orderedItemIds).size !== orderedItemIds.length ||
            orderedItemIds.some((id) => !existingIds.includes(id))
        ) {
            throw new BadRequestException('Передано некоректний порядок елементів.');
        }

        // Public responses hide draft anime. If a title became a draft after it was
        // added, keep that hidden item at the end instead of blocking reordering.
        const finalOrder = [
            ...orderedItemIds,
            ...existingIds.filter((id) => !orderedItemIds.includes(id)),
        ];

        await this.prisma.$transaction(async (tx) => {
            for (let index = 0; index < finalOrder.length; index += 1) {
                await tx.playlistItem.update({
                    where: { id: finalOrder[index] },
                    data: { order: -(index + 1) },
                });
            }
            for (let index = 0; index < finalOrder.length; index += 1) {
                await tx.playlistItem.update({
                    where: { id: finalOrder[index] },
                    data: { order: index },
                });
            }
        });

        return { orderedItemIds };
    }

    async removePlaylistItem(
        username: string,
        slug: string,
        itemId: number,
        userId: number,
    ) {
        const playlist = await this.getOwnedPlaylist(username, slug, userId);
        const item = await this.prisma.playlistItem.findFirst({
            where: { id: itemId, playlistId: playlist.id },
            select: { id: true, order: true },
        });
        if (!item) throw new NotFoundException('Елемент списку не знайдено.');

        await this.prisma.$transaction(async (tx) => {
            await tx.playlistItem.delete({ where: { id: itemId } });
            const remaining = await tx.playlistItem.findMany({
                where: { playlistId: playlist.id },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                select: { id: true, order: true },
            });

            for (let index = 0; index < remaining.length; index += 1) {
                const entry = remaining[index];
                if (entry.order === index) continue;
                await tx.playlistItem.update({
                    where: { id: entry.id },
                    data: { order: index },
                });
            }
        });

        return;
    }

    private async getUser(username: string) {
        const normalized = username.trim();
        const user = await this.prisma.user.findFirst({
            where: {
                username: { equals: normalized, mode: 'insensitive' },
            },
            select: {
                id: true,
                username: true,
                displayName: true,
                avatar: { select: ImageSelect },
                createdAt: true,
            },
        });
        if (!user) throw new NotFoundException('Користувача не знайдено.');
        return user;
    }

    private async assertOwner(username: string, userId: number) {
        const user = await this.getUser(username);
        if (user.id !== userId) {
            throw new ForbiddenException('Ви не можете змінювати списки іншого користувача.');
        }
        return user;
    }

    private async getOwnedPlaylist(
        username: string,
        slug: string,
        userId: number,
    ) {
        const user = await this.assertOwner(username, userId);
        const playlist = await this.prisma.playlist.findFirst({
            where: { userId: user.id, slug },
            select: { id: true, slug: true, title: true },
        });
        if (!playlist) throw new NotFoundException('Список не знайдено.');
        return playlist;
    }

    private async createPlaylistSlug(userId: number, title: string) {
        const base =
            slugify(title, {
                lower: true,
                strict: true,
                trim: true,
                locale: 'uk',
            }) || 'list';

        for (let suffix = 0; suffix < 1000; suffix += 1) {
            const slug = suffix === 0 ? base : `${base}-${suffix + 1}`;
            const exists = await this.prisma.playlist.findUnique({
                where: { userId_slug: { userId, slug } },
                select: { id: true },
            });
            if (!exists) return slug;
        }

        return `${base}-${Date.now()}`;
    }

    private normalizeOptionalText(value?: string | null) {
        const normalized = value?.trim();
        return normalized ? normalized : null;
    }
}
