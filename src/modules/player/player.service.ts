import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { PlayerSelect } from '../../common/orm/player.orm';
import { PlayerFiltersDto } from './dto/player-filters.dto';
import { Prisma } from '../../generated/prisma/client';
import { paginateById } from '../../common/pagination';

@Injectable()
export class PlayerService {
    constructor(private readonly prisma: PrismaService) {}

    async create({ title }: CreatePlayerDto) {
        const existing = await this.prisma.player.findFirst({
            where: { title },
        });
        if (existing)
            throw new BadRequestException('Плеєр з такою назвою вже існує.');

        const player = await this.prisma.player.create({
            data: {
                title,
            },
            select: PlayerSelect,
        });

        return player;
    }

    async findAll(filters: PlayerFiltersDto) {
        const where: Prisma.PlayerWhereInput = {};

        if (filters.search) {
            where.OR = [
                { title: { contains: filters.search, mode: 'insensitive' } },
            ];
        }

        return paginateById({
            model: this.prisma.player,
            pagination: filters,
            where,
            orderBy: [{ id: 'desc' }],
            select: PlayerSelect,
        });
    }

    async findOne(id: number) {
        const player = await this.prisma.player.findFirst({
            where: { id },
            select: PlayerSelect,
        });

        if (!player)
            throw new NotFoundException('Не існує плеєра з таким айді.');

        return player;
    }

    async update(id: number, { title }: UpdatePlayerDto) {
        const existing = await this.prisma.player.findFirst({ where: { id } });

        if (!existing)
            throw new NotFoundException('Не існує плеєра з таким айді.');

        const updated = await this.prisma.player.update({
            where: { id },
            data: { title },
            select: PlayerSelect,
        });

        return updated;
    }

    async remove(id: number) {
        const existing = await this.prisma.player.findFirst({
            where: { id },
            select: {
                ...PlayerSelect,
                _count: {
                    select: {
                        episodeVariants: true,
                    },
                },
            },
        });
        if (!existing)
            throw new NotFoundException('Не існує плеєра з таким айді.');

        if (existing._count.episodeVariants)
            throw new BadRequestException(
                'У цього плеєра є епізоди, треба з цим щось зробити.',
            );

        return await this.prisma.player.delete({ where: { id } });
    }
}
