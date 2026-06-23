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
import { DubteamService } from './dubteam.service';
import { Role } from '../../common/decorators/role.decorator';
import { UserRole } from '../../generated/prisma/enums';
import { adminGuards } from '../../common/helpers/admin.accept';
import { CreateDubteamDto } from './dto/create-dubteam.dto';
import { instanceToPlain } from 'class-transformer';
import { DubTeamEntity } from '../../common/entities/dubteam.entity';
import { UpdateDubteamDto } from './dto/update-dubteam.dto';
import { DubTeamFiltersDto } from './dto/dubteam-filters.dto';
import { ExposePaginationHeaders, setPaginationHeaders } from '../../common/pagination';
import { type Response } from 'express';

@Controller('dubteam')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class DubteamController {
    constructor(private readonly dubteamService: DubteamService) {}

    @Post()
    async create(@Body() createDubteamDto: CreateDubteamDto) {
        const dubteam = await this.dubteamService.create(createDubteamDto);

        return instanceToPlain(new DubTeamEntity(dubteam), {
            groups: ['private'],
        });
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: DubTeamFiltersDto,
    ) {
        const result = await this.dubteamService.findAll(filters);

        setPaginationHeaders(res, result);

        return result.items.map((dt) =>
            instanceToPlain(new DubTeamEntity(dt), {
                groups: ['private'],
            }),
        );
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const dubteam = await this.dubteamService.findOne(id);

        return instanceToPlain(new DubTeamEntity(dubteam), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateDubteamDto: UpdateDubteamDto,
    ) {
        const dubteam = await this.dubteamService.update(id, updateDubteamDto);

        return instanceToPlain(new DubTeamEntity(dubteam), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.dubteamService.remove(id);
        return;
    }
}
