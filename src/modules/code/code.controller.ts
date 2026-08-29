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
import { Role } from '../../common/decorators/role.decorator';
import { AnimeCodeEntity } from '../../common/entities/anime-code.entity';
import { adminGuards } from '../../common/helpers/admin.accept';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { UserRole } from '../../generated/prisma/enums';
import { CodeService } from './code.service';
import { CodeFiltersDto } from './dto/code-filters.dto';
import { CreateCodeDto } from './dto/create-code.dto';
import { UpdateCodeDto } from './dto/update-code.dto';

@Controller('code')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class CodeController {
    constructor(private readonly codeService: CodeService) {}

    @Post()
    async create(@Body() dto: CreateCodeDto) {
        const code = await this.codeService.create(dto);
        return instanceToPlain(new AnimeCodeEntity(code), {
            groups: ['private'],
        });
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: CodeFiltersDto,
    ) {
        const result = await this.codeService.findAll(filters);
        setPaginationHeaders(res, result);

        return result.items.map((code) =>
            instanceToPlain(new AnimeCodeEntity(code), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const code = await this.codeService.findOne(id);
        return instanceToPlain(new AnimeCodeEntity(code), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateCodeDto,
    ) {
        const code = await this.codeService.update(id, dto);
        return instanceToPlain(new AnimeCodeEntity(code), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.codeService.remove(id);
        return;
    }
}
