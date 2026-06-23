import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { CreateDubteamDto } from './dto/create-dubteam.dto';
import { UpdateDubteamDto } from './dto/update-dubteam.dto';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { DubTeamSelect } from '../../common/orm/dubteam.orm';
import { DubTeamFiltersDto } from './dto/dubteam-filters.dto';
import { paginateById } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class DubteamService {
    constructor(private readonly prisma: PrismaService) {}
    async create({ title }: CreateDubteamDto) {
        const existingDubTeam = await this.prisma.dubTeam.findFirst({
            where: { title },
        });
        if (existingDubTeam)
            throw new BadRequestException('Така команда озвучки вже існує.');

        const newDubTeam = await this.prisma.dubTeam.create({
            data: {
                title,
            },
            select: DubTeamSelect,
        });

        return newDubTeam;
    }

    async findAll(filters: DubTeamFiltersDto) {
        const where: Prisma.DubTeamWhereInput = {};

        if (filters.search) {
            where.OR = [
                { title: { contains: filters.search, mode: 'insensitive' } },
            ];
        }

        return paginateById({
            model: this.prisma.dubTeam,
            pagination: filters,
            where,
            orderBy: [{ id: 'desc' }],
            select: DubTeamSelect,
        });
    }

    async findOne(id: number) {
        const dubTeam = await this.prisma.dubTeam.findFirst({
            where: { id },
            select: DubTeamSelect,
        });

        if (!dubTeam)
            throw new NotFoundException(
                'Не існує команди озвучки з таким айді.',
            );

        return dubTeam;
    }

    async update(id: number, { title }: UpdateDubteamDto) {
        const existing = await this.prisma.dubTeam.findFirst({ where: { id } });
        if (!existing)
            throw new NotFoundException(
                'Не існує команди озвучки з таким айді.',
            );

        const updated = await this.prisma.dubTeam.update({
            where: { id },
            data: { title },
            select: DubTeamSelect,
        });

        return updated;
    }

    async remove(id: number) {
        const existing = await this.prisma.dubTeam.findFirst({
            where: { id },
            select: {
                ...DubTeamSelect,
                _count: {
                    select: {
                        episodeVariants: true,
                    },
                },
            },
        });
        if (!existing)
            throw new NotFoundException(
                'Не існує команди озвучки з таким айді.',
            );

        if (existing._count.episodeVariants)
            throw new BadRequestException(
                'У цієї команди є епізоди, треба з цим щось зробити.',
            );

        return await this.prisma.dubTeam.delete({ where: { id } });
    }
}
