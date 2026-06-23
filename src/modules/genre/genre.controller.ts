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
    Res,
    Query,
} from '@nestjs/common';
import { GenreService } from './genre.service';
import { CreateGenreDto } from './dto/create-genre.dto';
import { UpdateGenreDto } from './dto/update-genre.dto';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { Role } from '../../common/decorators/role.decorator';
import { instanceToPlain } from 'class-transformer';
import { GenreEntity } from '../../common/entities/genre.entity';
import { type Response } from 'express';
import { GenreFiltersDto } from './dto/genre-filters.dto';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';

@Controller('genre')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class GenreController {
    constructor(private readonly genreService: GenreService) {}

    @Post()
    async create(@Body() createGenreDto: CreateGenreDto) {
        const genre = await this.genreService.create(createGenreDto);

        return instanceToPlain(new GenreEntity(genre), {
            groups: ['private'],
        });
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: GenreFiltersDto,
    ) {
        const result = await this.genreService.findAll(filters);

        setPaginationHeaders(res, result);

        return result.items.map((g) =>
            instanceToPlain(new GenreEntity(g), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const genre = await this.genreService.findOne(id);

        return instanceToPlain(new GenreEntity(genre), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateGenreDto: UpdateGenreDto,
    ) {
        const genre = await this.genreService.update(id, updateGenreDto);

        return instanceToPlain(new GenreEntity(genre), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.genreService.remove(id);
        return;
    }
}
