import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { EpisodeSelect } from '../../common/orm/episode.orm';
import { Prisma } from '../../generated/prisma/client';
import {
    CreateEpisodeDto,
    CreateEpisodeVariantDto,
    EpisodeInputDto,
    ReplaceAnimeEpisodesDto,
} from './dto/create-episode.dto';
import { EpisodeFiltersDto } from './dto/episode-filters.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';

@Injectable()
export class EpisodeService {
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateEpisodeDto) {
        this.validateEpisodes([dto]);
        await this.ensureAnimeExists(dto.animeId);

        try {
            return await this.prisma.episode.create({
                data: {
                    animeId: dto.animeId,
                    number: dto.number,
                    title: this.nullableText(dto.title),
                    variants: dto.variants?.length
                        ? { create: dto.variants.map((variant) => this.prepareVariant(variant)) }
                        : undefined,
                },
                select: EpisodeSelect,
            });
        } catch (error) {
            this.rethrowKnownPrismaError(error, dto.number);
        }
    }

    async findAll(filters: EpisodeFiltersDto) {
        await this.ensureAnimeExists(filters.animeId);
        const page = filters.page ?? 1;
        const limit = Math.min(filters.limit ?? 25, 100);
        const where = { animeId: filters.animeId };

        const [items, totalCount] = await Promise.all([
            this.prisma.episode.findMany({
                where,
                orderBy: [{ number: 'asc' }, { id: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
                select: EpisodeSelect,
            }),
            this.prisma.episode.count({ where }),
        ]);

        return {
            items,
            pageInfo: {
                hasMore: page * limit < totalCount,
                nextCursor: null,
            },
            pageMeta: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
            },
        };
    }

    async findAllForEditor(animeId: number) {
        await this.ensureAnimeExists(animeId);

        return this.prisma.episode.findMany({
            where: { animeId },
            orderBy: [{ number: 'asc' }, { id: 'asc' }],
            select: EpisodeSelect,
        });
    }

    async findOne(id: number) {
        const episode = await this.prisma.episode.findUnique({
            where: { id },
            select: EpisodeSelect,
        });
        if (!episode) {
            throw new NotFoundException('Не існує серії з таким айді.');
        }
        return episode;
    }

    async update(id: number, dto: UpdateEpisodeDto) {
        const existing = await this.prisma.episode.findUnique({
            where: { id },
            select: { id: true, animeId: true, number: true },
        });
        if (!existing) {
            throw new NotFoundException('Не існує серії з таким айді.');
        }

        if (dto.number !== undefined || dto.variants !== undefined) {
            this.validateEpisodes([
                {
                    number: dto.number ?? existing.number,
                    title: dto.title,
                    variants: dto.variants,
                },
            ]);
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.episode.update({
                    where: { id },
                    data: {
                        number: dto.number,
                        title:
                            dto.title !== undefined
                                ? this.nullableText(dto.title)
                                : undefined,
                    },
                });

                if (dto.variants !== undefined) {
                    await tx.episodeVariant.deleteMany({ where: { episodeId: id } });
                    if (dto.variants.length) {
                        await tx.episodeVariant.createMany({
                            data: dto.variants.map((variant) => ({
                                episodeId: id,
                                ...this.prepareVariantScalar(variant),
                            })),
                        });
                    }
                }

                return tx.episode.findUniqueOrThrow({
                    where: { id },
                    select: EpisodeSelect,
                });
            });
        } catch (error) {
            this.rethrowKnownPrismaError(error, dto.number ?? existing.number);
        }
    }

    async remove(id: number) {
        const existing = await this.prisma.episode.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException('Не існує серії з таким айді.');
        }
        await this.prisma.episode.delete({ where: { id } });
    }

    async replaceAnimeEpisodes(animeId: number, dto: ReplaceAnimeEpisodesDto) {
        await this.ensureAnimeExists(animeId);
        this.validateEpisodes(dto.episodes);

        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.episode.deleteMany({ where: { animeId } });

                if (dto.episodes.length === 0) {
                    return [];
                }

                await tx.episode.createMany({
                    data: dto.episodes.map((episode) => ({
                        animeId,
                        number: episode.number,
                        title: this.nullableText(episode.title) ?? null,
                    })),
                });

                const createdEpisodes = await tx.episode.findMany({
                    where: { animeId },
                    select: { id: true, number: true },
                });
                const idByNumber = new Map(
                    createdEpisodes.map((episode) => [episode.number, episode.id]),
                );

                const variants = dto.episodes.flatMap((episode) => {
                    const episodeId = idByNumber.get(episode.number);
                    if (!episodeId) return [];
                    return (episode.variants ?? []).map((variant) => ({
                        episodeId,
                        ...this.prepareVariantScalar(variant),
                    }));
                });

                if (variants.length) {
                    await tx.episodeVariant.createMany({ data: variants });
                }

                return tx.episode.findMany({
                    where: { animeId },
                    orderBy: [{ number: 'asc' }, { id: 'asc' }],
                    select: EpisodeSelect,
                });
            });
        } catch (error) {
            this.rethrowKnownPrismaError(error);
        }
    }

    private async ensureAnimeExists(animeId: number) {
        const anime = await this.prisma.anime.findUnique({
            where: { id: animeId },
            select: { id: true },
        });
        if (!anime) {
            throw new NotFoundException('Не існує аніме з таким айді.');
        }
    }

    private validateEpisodes(episodes: EpisodeInputDto[]) {
        const episodeNumbers = new Set<number>();

        for (const episode of episodes) {
            if (episodeNumbers.has(episode.number)) {
                throw new BadRequestException(
                    `Серія №${episode.number} додана більше одного разу.`,
                );
            }
            episodeNumbers.add(episode.number);

            const variantKeys = new Set<string>();
            for (const variant of episode.variants ?? []) {
                const key = `${variant.dubType}:${variant.dubTeamId}:${variant.playerId}`;
                if (variantKeys.has(key)) {
                    throw new BadRequestException(
                        `Серія №${episode.number} містить дубльований варіант.`,
                    );
                }
                variantKeys.add(key);
            }
        }
    }

    private prepareVariant(variant: CreateEpisodeVariantDto) {
        return {
            sourceType: variant.sourceType,
            endpoint: variant.endpoint.trim(),
            dubType: variant.dubType,
            isActive: variant.isActive ?? false,
            dubTeam: { connect: { id: variant.dubTeamId } },
            player: { connect: { id: variant.playerId } },
        };
    }

    private prepareVariantScalar(variant: CreateEpisodeVariantDto) {
        return {
            sourceType: variant.sourceType,
            endpoint: variant.endpoint.trim(),
            dubType: variant.dubType,
            dubTeamId: variant.dubTeamId,
            playerId: variant.playerId,
            isActive: variant.isActive ?? false,
        };
    }

    private nullableText(value?: string | null) {
        if (value === undefined) return undefined;
        const normalized = value?.trim();
        return normalized ? normalized : null;
    }

    private rethrowKnownPrismaError(error: unknown, number?: number): never {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            throw new BadRequestException(
                number
                    ? `Серія №${number} вже існує для цього аніме.`
                    : 'Номери серій не можуть повторюватися.',
            );
        }
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2003'
        ) {
            throw new BadRequestException(
                'Один із плеєрів або команд озвучення більше не існує.',
            );
        }
        throw error;
    }
}
