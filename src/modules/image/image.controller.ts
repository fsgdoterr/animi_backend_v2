import {
    BadRequestException,
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
import { ImageFiltersListDto } from './dto/image-filters-list.dto';
import { ImageService } from './image.service';
import { instanceToPlain } from 'class-transformer';
import { ImageEntity } from '../../common/entities/image.entity';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { type Response } from 'express';
import { pipeline } from 'stream/promises';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { Role } from '../../common/decorators/role.decorator';
import { CreateImageDto } from './dto/create-image.dto';
import { UpdateImageDto } from './dto/update-image.dto';

@Controller('image')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class ImageController {
    constructor(private readonly imageService: ImageService) {}

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Query() filters: ImageFiltersListDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.imageService.findAll(filters);
        setPaginationHeaders(res, result);

        return result.items.map((img) =>
            instanceToPlain(new ImageEntity(img), {
                groups: ['private'],
            }),
        );
    }

    @Post()
    async create(@Body() dto: CreateImageDto) {
        const image = await this.imageService.createManagedImage(dto);
        return instanceToPlain(new ImageEntity(image), {
            groups: ['private'],
        });
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateImageDto,
    ) {
        const image = await this.imageService.update(id, dto);
        return instanceToPlain(new ImageEntity(image), {
            groups: ['private'],
        });
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.imageService.deleteImage(id);
        return;
    }

    @Get('proxy')
    async proxy(@Query('url') url: string, @Res() res) {
        if (!url) {
            throw new BadRequestException('Image url is required');
        }
        const image = await this.imageService.getProxyImage(url);

        if (image.contentType) {
            res.setHeader('Content-Type', image.contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        await pipeline(image.stream, res);
    }
}
