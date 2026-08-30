import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import slugify from 'slugify';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { prepareImage } from '../../common/helpers/prepare-image';
import { AnimeListSelect, AnimeSelect } from '../../common/orm/anime.orm';
import { paginateById } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';
import {
    AnimeStatus,
    AnimeType,
} from '../../generated/prisma/enums';
import { GenreService } from '../genre/genre.service';
import { ImageService } from '../image/image.service';
import { AnimeFiltersDto } from './dto/anime-filters.dto';
import { CreateAnimeDto } from './dto/create-anime.dto';
import { UpdateAnimeDto } from './dto/update-anime.dto';
import { UpdateHomeSliderDto } from './dto/update-home-slider.dto';

@Injectable()
export class AnimeService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly imageService: ImageService,
        private readonly genreService: GenreService,
    ) {}

    async create(dto: CreateAnimeDto) {
        let posterImage: { id: number } | undefined;
        let posterCreated = false;
        let additionalImages: { id: number }[] = [];
        let createdAdditionalImageIds: number[] = [];
        let createdAnimeId: number | undefined;

        try {
            const preparedPoster = await prepareImage({
                service: this.imageService,
                image: dto.poster,
            });
            posterImage = preparedPoster.image;
            posterCreated = preparedPoster.created;

            if (dto.additionalImages) {
                const preparedAdditional = await this.prepareImages(
                    dto.additionalImages,
                );
                additionalImages = preparedAdditional.refs;
                createdAdditionalImageIds = preparedAdditional.createdIds;
            }

            const animeData = await this.assembleData(dto);
            const created = await this.prisma.anime.create({
                data: {
                    ...animeData,
                    status: dto.status ?? AnimeStatus.DRAFT,
                    poster: posterImage
                        ? { connect: { id: posterImage.id } }
                        : undefined,
                    additionalImages: additionalImages.length
                        ? {
                              connect: additionalImages.map((image) => ({
                                  id: image.id,
                              })),
                          }
                        : undefined,
                    genres: dto.genres
                        ? await this.prepareGenres(dto.genres)
                        : undefined,
                },
                select: { id: true },
            });
            createdAnimeId = created.id;

            if (dto.producers !== undefined) {
                await this.syncProducers(created.id, dto.producers);
            }
            if (dto.relatedAnimeId !== undefined) {
                await this.syncRelatedAnime(created.id, dto.relatedAnimeId);
            }

            return await this.findOne(created.id);
        } catch (error) {
            if (createdAnimeId) {
                await this.prisma.anime
                    .delete({ where: { id: createdAnimeId } })
                    .catch(() => undefined);
            }
            if (posterImage && posterCreated) {
                await this.imageService.deleteImageIfUnused(posterImage.id);
            }
            await Promise.all(
                createdAdditionalImageIds.map((imageId) =>
                    this.imageService.deleteImageIfUnused(imageId),
                ),
            );

            if (
                error instanceof BadRequestException ||
                error instanceof NotFoundException
            ) {
                throw error;
            }
            throw new InternalServerErrorException();
        }
    }

    async findAll(filters: AnimeFiltersDto) {
        const where: Prisma.AnimeWhereInput = {};

        if (filters.search?.trim()) {
            const search = filters.search.trim();
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { originalTitle: { contains: search, mode: 'insensitive' } },
                { engTitle: { contains: search, mode: 'insensitive' } },
            ];
        }

        const statuses = this.enumCsv(filters.status, AnimeStatus);
        const types = this.enumCsv(filters.type, AnimeType);
        const genres = this.csv(filters.genres);

        if (statuses.length) where.status = { in: statuses };
        if (types.length) where.type = { in: types };
        if (genres.length) {
            where.genres = {
                some: {
                    OR: genres.map((title) => ({
                        title: { equals: title, mode: 'insensitive' },
                    })),
                },
            };
        }

        if (filters.issue) {
            const issueWhere: Record<NonNullable<AnimeFiltersDto['issue']>, Prisma.AnimeWhereInput> = {
                missingPoster: { posterId: null },
                missingDescription: {
                    OR: [{ description: null }, { description: '' }],
                },
                withoutEpisodes: { episodes: { none: {} } },
                withoutActiveVariant: {
                    episodes: {
                        some: { variants: { none: { isActive: true } } },
                    },
                },
            };

            where.AND = issueWhere[filters.issue];
        }

        const result = await paginateById<any>({
            model: this.prisma.anime,
            pagination: filters,
            where,
            orderBy: this.getOrderBy(filters.sort),
            select: AnimeListSelect,
        });

        const ids = result.items.map((anime) => anime.id);
        const reviewStats = ids.length
            ? await this.prisma.review.groupBy({
                  by: ['animeId'],
                  where: { animeId: { in: ids } },
                  _avg: { rating: true },
              })
            : [];
        const averageByAnime = new Map(
            reviewStats.map((stat) => [stat.animeId, stat._avg.rating]),
        );

        return {
            ...result,
            items: result.items.map((anime) => ({
                ...anime,
                averageReviewRating: averageByAnime.get(anime.id) ?? null,
            })),
        };
    }

    async findOne(id: number) {
        const anime = await this.prisma.anime.findUnique({
            where: { id },
            select: AnimeSelect,
        });
        if (!anime) {
            throw new NotFoundException('Не існує аніме з таким айді.');
        }

        const reviewStats = await this.prisma.review.aggregate({
            where: { animeId: id },
            _avg: { rating: true },
        });
        const { relation, ...rest } = anime;

        const producers = await this.getProducersForAnime(id);

        return {
            ...rest,
            producers,
            relatedAnimes:
                relation?.animes.filter((related) => related.id !== id) ?? [],
            averageReviewRating: reviewStats._avg.rating,
        };
    }

    async update(id: number, dto: UpdateAnimeDto) {
        const existing = await this.prisma.anime.findUnique({
            where: { id },
            select: AnimeSelect,
        });
        if (!existing) {
            throw new NotFoundException('Не існує аніме з таким айді.');
        }

        let posterImage: { id: number } | undefined;
        let posterCreated = false;
        let additionalImages: { id: number }[] | undefined;
        let createdAdditionalImageIds: number[] = [];

        try {
            const poster =
                dto.poster !== undefined
                    ? await prepareImage({
                          service: this.imageService,
                          image: dto.poster,
                      })
                    : undefined;
            posterImage = poster?.image;
            posterCreated = poster?.created ?? false;

            if (dto.additionalImages !== undefined) {
                const preparedAdditional = await this.prepareImages(
                    dto.additionalImages,
                );
                additionalImages = preparedAdditional.refs;
                createdAdditionalImageIds = preparedAdditional.createdIds;
            }

            const resultingType = dto.type ?? existing.type;
            const typeFields = this.normalizeTypeFields(resultingType, {
                episodesTotal:
                    dto.episodesTotal !== undefined
                        ? dto.episodesTotal
                        : existing.episodesTotal,
                seasonNumber:
                    dto.seasonNumber !== undefined
                        ? dto.seasonNumber
                        : existing.seasonNumber,
                partNumber:
                    dto.partNumber !== undefined
                        ? dto.partNumber
                        : existing.partNumber,
            });

            const updated = await this.prisma.anime.update({
                where: { id },
                data: {
                    title: dto.title,
                    slug:
                        dto.title !== undefined
                            ? await this.generateUniqueSlug(dto.title, id)
                            : undefined,
                    originalTitle: dto.originalTitle,
                    engTitle: dto.engTitle,
                    rating: dto.rating,
                    description: dto.description,
                    country: dto.country,
                    releaseDate: this.normalizeDate(dto.releaseDate),
                    endDate: this.normalizeDate(dto.endDate),
                    ...typeFields,
                    duration: dto.duration,
                    type: dto.type,
                    status: dto.status,
                    studio: dto.studio,
                    mal: dto.mal,
                    al: dto.al,
                    poster: poster?.imagePrismaObj,
                    additionalImages:
                        additionalImages !== undefined
                            ? {
                                  set: additionalImages.map((image) => ({
                                      id: image.id,
                                  })),
                              }
                            : undefined,
                    genres:
                        dto.genres !== undefined
                            ? {
                                  set: [],
                                  ...(await this.prepareGenres(dto.genres)),
                              }
                            : undefined,
                },
                select: AnimeSelect,
            });

            if (dto.producers !== undefined) {
                await this.syncProducers(id, dto.producers);
            }
            if (dto.relatedAnimeId !== undefined) {
                await this.syncRelatedAnime(id, dto.relatedAnimeId);
            }

            if (
                dto.poster !== undefined &&
                existing.poster &&
                existing.poster.id !== updated.poster?.id
            ) {
                await this.imageService.deleteImageIfUnused(existing.poster.id);
            }

            if (dto.additionalImages !== undefined) {
                const nextIds = new Set(
                    updated.additionalImages.map((image) => image.id),
                );
                await Promise.all(
                    existing.additionalImages
                        .filter((image) => !nextIds.has(image.id))
                        .map((image) =>
                            this.imageService.deleteImageIfUnused(image.id),
                        ),
                );
            }

            return await this.findOne(id);
        } catch (error) {
            if (posterImage && posterCreated) {
                await this.imageService.deleteImageIfUnused(posterImage.id);
            }
            await Promise.all(
                createdAdditionalImageIds.map((imageId) =>
                    this.imageService.deleteImageIfUnused(imageId),
                ),
            );

            if (
                error instanceof BadRequestException ||
                error instanceof NotFoundException
            ) {
                throw error;
            }
            throw new InternalServerErrorException();
        }
    }

    async remove(id: number) {
        const existing = await this.prisma.anime.findUnique({
            where: { id },
            select: {
                id: true,
                relationId: true,
                poster: { select: { id: true } },
                additionalImages: { select: { id: true } },
            },
        });
        if (!existing) {
            throw new NotFoundException('Не існує аніме з таким айді.');
        }

        await this.prisma.$transaction([
            this.prisma.playlistItem.deleteMany({ where: { animeId: id } }),
            this.prisma.anime.delete({ where: { id } }),
        ]);

        if (existing.relationId) {
            await this.cleanupRelation(existing.relationId);
        }
        if (existing.poster) {
            await this.imageService.deleteImageIfUnused(existing.poster.id);
        }
        await Promise.all(
            existing.additionalImages.map((image) =>
                this.imageService.deleteImageIfUnused(image.id),
            ),
        );
    }

    async prepareImages(images: (string | number | null)[]) {
        const refs: { id: number }[] = [];
        const createdIds: number[] = [];

        try {
            for (const image of images) {
                if (typeof image === 'string') {
                    const created = await this.imageService.createImage(image);
                    refs.push(created);
                    createdIds.push(created.id);
                } else if (typeof image === 'number') {
                    refs.push({ id: image });
                }
            }

            return { refs, createdIds };
        } catch (error) {
            // If one URL fails after previous URLs were downloaded, do not leave
            // orphaned files/images behind. The form can then safely retry.
            await Promise.all(
                createdIds.map((imageId) =>
                    this.imageService
                        .deleteImageIfUnused(imageId)
                        .catch(() => undefined),
                ),
            );
            throw error;
        }
    }

    async prepareGenres(genres: string[]) {
        const uniqueGenres = this.uniqueNames(genres);

        return {
            connectOrCreate: await Promise.all(
                uniqueGenres.map(async (genre) => ({
                    where: { title: genre },
                    create: {
                        title: genre,
                        slug: await this.genreService.generateUniqueSlug(genre),
                    },
                })),
            ),
        };
    }

    private async getProducersForAnime(animeId: number) {
        return this.prisma.$queryRawUnsafe<
            { id: number; title: string; createdAt: Date; updatedAt: Date }[]
        >(
            'SELECT p."id", p."title", p."createdAt", p."updatedAt" FROM "Producer" p INNER JOIN "_AnimeToProducer" ap ON ap."B" = p."id" WHERE ap."A" = $1 ORDER BY p."title" ASC, p."id" ASC',
            animeId,
        );
    }

    private async syncProducers(animeId: number, rawNames: string[]) {
        const names = this.uniqueNames(rawNames);

        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                'DELETE FROM "_AnimeToProducer" WHERE "A" = $1',
                animeId,
            );

            for (const title of names) {
                await tx.$executeRawUnsafe(
                    'INSERT INTO "Producer" ("title", "createdAt", "updatedAt") VALUES ($1, NOW(), NOW()) ON CONFLICT ("title") DO NOTHING',
                    title,
                );
                const rows = await tx.$queryRawUnsafe<{ id: number }[]>(
                    'SELECT "id" FROM "Producer" WHERE "title" = $1 LIMIT 1',
                    title,
                );
                const producerId = rows[0]?.id;
                if (producerId) {
                    await tx.$executeRawUnsafe(
                        'INSERT INTO "_AnimeToProducer" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        animeId,
                        producerId,
                    );
                }
            }
        });
    }

    async assembleData(dto: CreateAnimeDto) {
        const typeFields = this.normalizeTypeFields(dto.type, dto);

        return {
            title: dto.title.trim(),
            type: dto.type,
            slug: await this.generateUniqueSlug(dto.title),
            originalTitle: this.nullableText(dto.originalTitle),
            engTitle: this.nullableText(dto.engTitle),
            rating: dto.rating,
            description: this.nullableText(dto.description),
            country: this.nullableText(dto.country),
            releaseDate: this.normalizeDate(dto.releaseDate),
            endDate: this.normalizeDate(dto.endDate),
            ...typeFields,
            duration: dto.duration,
            studio: this.nullableText(dto.studio),
            mal: this.nullableText(dto.mal),
            al: this.nullableText(dto.al),
        };
    }

    private normalizeDate(value: string | null | undefined) {
        if (value === undefined) return undefined;
        if (value === null || !value.trim()) return null;

        const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? `${value}T00:00:00.000Z`
            : value;
        const date = new Date(normalized);

        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Невірний формат дати.');
        }

        return date;
    }

    async getHomeSlider() {
        type SliderRow = {
            id: number;
            animeId: number;
            imageId: number | null;
            order: number;
            imagePath: string | null;
            imageSourceUrl: string | null;
            imageAvatarAllowed: boolean | null;
            imageCreatedAt: Date | null;
            imageUpdatedAt: Date | null;
        };

        const rows = await this.prisma.$queryRaw<SliderRow[]>(Prisma.sql`
            SELECT
                h."id",
                h."animeId",
                h."imageId",
                h."order",
                i."path" AS "imagePath",
                i."sourceUrl" AS "imageSourceUrl",
                i."isAvatarAllowed" AS "imageAvatarAllowed",
                i."createdAt" AS "imageCreatedAt",
                i."updatedAt" AS "imageUpdatedAt"
            FROM "HomeSliderItem" h
            LEFT JOIN "Image" i ON i."id" = h."imageId"
            ORDER BY h."order" ASC, h."id" ASC
        `);

        if (!rows.length) return [];

        const animes = await this.prisma.anime.findMany({
            where: { id: { in: rows.map((row) => row.animeId) } },
            select: AnimeListSelect,
        });
        const byId = new Map(animes.map((anime) => [anime.id, anime]));

        return rows.flatMap((row) => {
            const anime = byId.get(row.animeId);
            if (!anime) return [];

            return [{
                id: row.id,
                order: row.order,
                anime,
                image: row.imageId && row.imagePath ? {
                    id: row.imageId,
                    path: row.imagePath,
                    sourceUrl: row.imageSourceUrl,
                    isAvatarAllowed: row.imageAvatarAllowed ?? false,
                    createdAt: row.imageCreatedAt,
                    updatedAt: row.imageUpdatedAt,
                } : null,
            }];
        });
    }

    async updateHomeSlider(dto: UpdateHomeSliderDto) {
        const animeIds = dto.items.map((item) => item.animeId);
        if (new Set(animeIds).size !== animeIds.length) {
            throw new BadRequestException('Одне аніме не можна додати до слайдера двічі.');
        }

        if (animeIds.length) {
            const foundAnimes = await this.prisma.anime.findMany({
                where: { id: { in: animeIds } },
                select: { id: true, status: true },
            });
            if (foundAnimes.length !== animeIds.length) {
                throw new BadRequestException('Одне з обраних аніме більше не існує.');
            }
            if (foundAnimes.some((anime) => anime.status === AnimeStatus.DRAFT)) {
                throw new BadRequestException('Чернетки не можна показувати у публічному слайдері.');
            }
        }

        const imageIds = [...new Set(dto.items.flatMap((item) => item.imageId ? [item.imageId] : []))];
        if (imageIds.length) {
            const imageCount = await this.prisma.image.count({
                where: { id: { in: imageIds } },
            });
            if (imageCount !== imageIds.length) {
                throw new BadRequestException('Одне з обраних зображень більше не існує.');
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`DELETE FROM "HomeSliderItem"`);

            for (const [order, item] of dto.items.entries()) {
                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "HomeSliderItem" ("animeId", "imageId", "order", "createdAt", "updatedAt")
                    VALUES (${item.animeId}, ${item.imageId ?? null}, ${order}, NOW(), NOW())
                `);
            }
        });

        return this.getHomeSlider();
    }

    async generateUniqueSlug(title: string, excludeId?: number) {
        const baseSlug = slugify(title, {
            lower: true,
            strict: true,
            trim: true,
        });

        let slug = baseSlug || 'anime';
        let counter = 2;

        while (true) {
            const existing = await this.prisma.anime.findUnique({
                where: { slug },
                select: { id: true },
            });

            if (!existing || existing.id === excludeId) {
                return slug;
            }

            slug = `${baseSlug || 'anime'}-${counter}`;
            counter++;
        }
    }

    private async syncRelatedAnime(
        animeId: number,
        relatedAnimeId: number | null,
    ) {
        const current = await this.prisma.anime.findUnique({
            where: { id: animeId },
            select: { id: true, relationId: true },
        });
        if (!current) {
            throw new NotFoundException('Не існує аніме з таким айді.');
        }

        if (relatedAnimeId === null) {
            if (!current.relationId) return;

            const oldRelationId = current.relationId;
            await this.prisma.anime.update({
                where: { id: animeId },
                data: { relationId: null },
            });
            await this.cleanupRelation(oldRelationId);
            return;
        }

        if (relatedAnimeId === animeId) {
            throw new BadRequestException(
                'Аніме не можна повʼязати саме з собою.',
            );
        }

        const target = await this.prisma.anime.findUnique({
            where: { id: relatedAnimeId },
            select: { id: true, relationId: true },
        });
        if (!target) {
            throw new BadRequestException(
                'Обране повʼязане аніме більше не існує.',
            );
        }

        if (current.relationId && current.relationId === target.relationId) {
            return;
        }

        const oldRelationId = current.relationId;

        // The selected anime is the anchor. If it already belongs to a relation
        // group, the current anime joins that whole group. If the anchor has no
        // group yet, keep the current group when possible; otherwise create one
        // relation for the pair.
        if (target.relationId) {
            await this.prisma.anime.update({
                where: { id: animeId },
                data: { relationId: target.relationId },
            });
        } else if (current.relationId) {
            await this.prisma.anime.update({
                where: { id: relatedAnimeId },
                data: { relationId: current.relationId },
            });
        } else {
            await this.prisma.$transaction(async (tx) => {
                const relation = await tx.relation.create({ data: {} });
                await tx.anime.updateMany({
                    where: { id: { in: [animeId, relatedAnimeId] } },
                    data: { relationId: relation.id },
                });
            });
        }

        if (
            oldRelationId &&
            target.relationId &&
            oldRelationId !== target.relationId
        ) {
            await this.cleanupRelation(oldRelationId);
        }
    }

    private async cleanupRelation(relationId: number) {
        const relation = await this.prisma.relation.findUnique({
            where: { id: relationId },
            select: { animes: { select: { id: true } } },
        });
        if (!relation) return;

        if (relation.animes.length < 2) {
            await this.prisma.$transaction([
                this.prisma.anime.updateMany({
                    where: { relationId },
                    data: { relationId: null },
                }),
                this.prisma.relation.delete({ where: { id: relationId } }),
            ]);
        }
    }

    private normalizeTypeFields(
        type: AnimeType,
        values: {
            episodesTotal?: number | null;
            seasonNumber?: number | null;
            partNumber?: number | null;
        },
    ) {
        if (type === AnimeType.TV) {
            return {
                episodesTotal: values.episodesTotal ?? null,
                seasonNumber: values.seasonNumber ?? null,
                partNumber: values.partNumber ?? null,
            };
        }

        if (type === AnimeType.MOVIE) {
            return {
                episodesTotal: null,
                seasonNumber: null,
                partNumber: values.partNumber ?? null,
            };
        }

        return {
            episodesTotal: null,
            seasonNumber: null,
            partNumber: null,
        };
    }

    private uniqueNames(values: string[]) {
        const byNormalized = new Map<string, string>();
        for (const raw of values) {
            const value = raw.trim();
            if (!value) continue;
            const key = value.toLocaleLowerCase();
            if (!byNormalized.has(key)) byNormalized.set(key, value);
        }
        return [...byNormalized.values()];
    }

    private csv(value?: string) {
        return value
            ? value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
            : [];
    }

    private enumCsv<T extends Record<string, string>>(
        value: string | undefined,
        enumObject: T,
    ): T[keyof T][] {
        const allowed = new Set(Object.values(enumObject));
        return this.csv(value).filter((item) => allowed.has(item)) as T[keyof T][];
    }

    private getOrderBy(sort: AnimeFiltersDto['sort']) {
        switch (sort) {
            case 'old':
                return [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
            case 'title':
                return [{ title: 'asc' as const }, { id: 'desc' as const }];
            case 'release':
                return [{ releaseDate: 'desc' as const }, { id: 'desc' as const }];
            case 'views':
                return [
                    { views: { _count: 'desc' as const } },
                    { id: 'desc' as const },
                ];
            case 'new':
            default:
                return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
        }
    }

    private nullableText(value?: string | null) {
        if (value === undefined) return undefined;
        const normalized = value?.trim();
        return normalized ? normalized : null;
    }
}
