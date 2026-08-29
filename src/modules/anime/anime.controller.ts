import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { type Response } from 'express';
import { AnimeEntity } from '../../common/entities/anime.entity';
import { Role } from '../../common/decorators/role.decorator';
import { adminGuards } from '../../common/helpers/admin.accept';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { UserRole } from '../../generated/prisma/enums';
import { AnimeService } from './anime.service';
import { AnimeFiltersDto } from './dto/anime-filters.dto';
import { CreateAnimeDto } from './dto/create-anime.dto';
import { UpdateAnimeDto } from './dto/update-anime.dto';

@Controller('anime')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class AnimeController {
    constructor(private readonly animeService: AnimeService) {}

    @Post()
    async create(@Body() createAnimeDto: CreateAnimeDto) {
        const anime = await this.animeService.create(createAnimeDto);

        return instanceToPlain(new AnimeEntity(anime), {
            groups: ['private'],
        });
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: AnimeFiltersDto,
    ) {
        const result = await this.animeService.findAll(filters);

        setPaginationHeaders(res, result);

        return result.items.map((anime) =>
            instanceToPlain(new AnimeEntity(anime), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const anime = await this.animeService.findOne(id);

        return instanceToPlain(new AnimeEntity(anime), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateAnimeDto: UpdateAnimeDto,
    ) {
        const anime = await this.animeService.update(id, updateAnimeDto);

        return instanceToPlain(new AnimeEntity(anime), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.animeService.remove(id);
        return;
    }
}
