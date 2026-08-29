import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { type Response } from 'express';
import { Role } from '../../common/decorators/role.decorator';
import { EpisodeEntity } from '../../common/entities/episode.entity';
import { adminGuards } from '../../common/helpers/admin.accept';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { UserRole } from '../../generated/prisma/enums';
import {
    CreateEpisodeDto,
    ReplaceAnimeEpisodesDto,
} from './dto/create-episode.dto';
import { EpisodeFiltersDto } from './dto/episode-filters.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';
import { EpisodeService } from './episode.service';

@Controller('episode')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class EpisodeController {
    constructor(private readonly episodeService: EpisodeService) {}

    @Post()
    async create(@Body() dto: CreateEpisodeDto) {
        return this.serialize(await this.episodeService.create(dto));
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: EpisodeFiltersDto,
    ) {
        const result = await this.episodeService.findAll(filters);
        setPaginationHeaders(res, result);
        return result.items.map((episode) => this.serialize(episode));
    }

    @Get('anime/:animeId/editor')
    async findAllForEditor(@Param('animeId', ParseIntPipe) animeId: number) {
        const episodes = await this.episodeService.findAllForEditor(animeId);
        return episodes.map((episode) => this.serialize(episode));
    }

    @Put('anime/:animeId')
    async replaceAnimeEpisodes(
        @Param('animeId', ParseIntPipe) animeId: number,
        @Body() dto: ReplaceAnimeEpisodesDto,
    ) {
        const episodes = await this.episodeService.replaceAnimeEpisodes(animeId, dto);
        return episodes.map((episode) => this.serialize(episode));
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        return this.serialize(await this.episodeService.findOne(id));
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateEpisodeDto,
    ) {
        return this.serialize(await this.episodeService.update(id, dto));
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.episodeService.remove(id);
    }

    private serialize(episode: object) {
        return instanceToPlain(new EpisodeEntity(episode), {
            groups: ['private'],
        });
    }
}
