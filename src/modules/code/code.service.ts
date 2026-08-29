import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { AnimeCodeSelect } from '../../common/orm/anime-code.orm';
import { paginateById } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';
import { CodeFiltersDto } from './dto/code-filters.dto';
import { CreateCodeDto } from './dto/create-code.dto';
import { UpdateCodeDto } from './dto/update-code.dto';

@Injectable()
export class CodeService {
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateCodeDto) {
        const code = this.normalizeCode(dto.code);

        await this.ensureAnimeExists(dto.animeId);
        await this.ensureCodeAvailable(code);

        return this.prisma.animeCode.create({
            data: {
                animeId: dto.animeId,
                code,
            },
            select: AnimeCodeSelect,
        });
    }

    async findAll(filters: CodeFiltersDto) {
        const where: Prisma.AnimeCodeWhereInput = {};

        if (filters.search?.trim()) {
            const search = filters.search.trim();
            where.OR = [
                { code: { contains: search, mode: 'insensitive' } },
                {
                    anime: {
                        is: {
                            OR: [
                                {
                                    title: {
                                        contains: search,
                                        mode: 'insensitive',
                                    },
                                },
                                {
                                    originalTitle: {
                                        contains: search,
                                        mode: 'insensitive',
                                    },
                                },
                                {
                                    engTitle: {
                                        contains: search,
                                        mode: 'insensitive',
                                    },
                                },
                            ],
                        },
                    },
                },
            ];
        }

        return paginateById({
            model: this.prisma.animeCode,
            pagination: filters,
            where,
            orderBy: this.getOrderBy(filters.sort),
            select: AnimeCodeSelect,
        });
    }

    async findOne(id: number) {
        const code = await this.prisma.animeCode.findUnique({
            where: { id },
            select: AnimeCodeSelect,
        });

        if (!code) {
            throw new NotFoundException('Не існує коду з таким айді.');
        }

        return code;
    }

    async update(id: number, dto: UpdateCodeDto) {
        const existing = await this.prisma.animeCode.findUnique({
            where: { id },
            select: { id: true, animeId: true, code: true },
        });

        if (!existing) {
            throw new NotFoundException('Не існує коду з таким айді.');
        }

        if (dto.animeId !== undefined) {
            await this.ensureAnimeExists(dto.animeId);
        }

        const code =
            dto.code !== undefined ? this.normalizeCode(dto.code) : undefined;

        if (code !== undefined) {
            await this.ensureCodeAvailable(code, id);
        }

        return this.prisma.animeCode.update({
            where: { id },
            data: {
                animeId: dto.animeId,
                code,
            },
            select: AnimeCodeSelect,
        });
    }

    async remove(id: number) {
        const existing = await this.prisma.animeCode.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new NotFoundException('Не існує коду з таким айді.');
        }

        await this.prisma.animeCode.delete({ where: { id } });
    }

    private async ensureAnimeExists(animeId: number) {
        const anime = await this.prisma.anime.findUnique({
            where: { id: animeId },
            select: { id: true },
        });

        if (!anime) {
            throw new BadRequestException('Обране аніме більше не існує.');
        }
    }

    private async ensureCodeAvailable(code: string, exceptId?: number) {
        const existing = await this.prisma.animeCode.findFirst({
            where: {
                code: { equals: code, mode: 'insensitive' },
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            select: { id: true },
        });

        if (existing) {
            throw new BadRequestException('Такий код уже існує.');
        }
    }

    private normalizeCode(value: string) {
        const code = value.trim();
        if (!code) {
            throw new BadRequestException('Код не може бути порожнім.');
        }
        return code;
    }

    private getOrderBy(sort: CodeFiltersDto['sort']) {
        switch (sort) {
            case 'old':
                return [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
            case 'code':
                return [{ code: 'asc' as const }, { id: 'desc' as const }];
            case 'anime':
                return [
                    { anime: { title: 'asc' as const } },
                    { id: 'desc' as const },
                ];
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
}
