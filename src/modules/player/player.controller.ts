import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    ParseIntPipe,
    Query,
    Res,
} from '@nestjs/common';
import { PlayerService } from './player.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { Role } from '../../common/decorators/role.decorator';
import { PlayerEntity } from '../../common/entities/player.entity';
import { instanceToPlain } from 'class-transformer';
import { setPaginationHeaders } from '../../common/pagination';
import { PlayerFiltersDto } from './dto/player-filters.dto';
import { type Response } from 'express';

@Controller('player')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class PlayerController {
    constructor(private readonly playerService: PlayerService) {}

    @Post()
    async create(@Body() createPlayerDto: CreatePlayerDto) {
        const player = await this.playerService.create(createPlayerDto);

        return instanceToPlain(new PlayerEntity(player), {
            groups: ['private'],
        });
    }

    @Get()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: PlayerFiltersDto,
    ) {
        const result = await this.playerService.findAll(filters);

        setPaginationHeaders(res, result);

        return result.items.map((dt) =>
            instanceToPlain(new PlayerEntity(dt), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const player = await this.playerService.findOne(id);

        return instanceToPlain(new PlayerEntity(player), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updatePlayerDto: UpdatePlayerDto,
    ) {
        const player = await this.playerService.update(id, updatePlayerDto);

        return instanceToPlain(new PlayerEntity(player), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.playerService.remove(id);
        return;
    }
}
