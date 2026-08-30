import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import { ExposePaginationHeaders, setPaginationHeaders } from '../../../common/pagination';
import { PublicAnimeFiltersDto } from './dto/public-anime-filters.dto';
import { PublicAnimeService } from './public-anime.service';

@Controller('public/anime')
export class PublicAnimeController {
    constructor(private readonly publicAnimeService: PublicAnimeService) {}

    @Get('home')
    home() {
        return this.publicAnimeService.home();
    }

    @Get('meta')
    meta() {
        return this.publicAnimeService.meta();
    }

    @Get('random')
    random() {
        return this.publicAnimeService.random();
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: PublicAnimeFiltersDto,
    ) {
        const result = await this.publicAnimeService.findAll(filters);
        setPaginationHeaders(res, result);
        return result.items;
    }

    @Get(':slug')
    findOne(@Param('slug') slug: string) {
        return this.publicAnimeService.findOne(slug);
    }
}
