import {
    Controller,
    Get,
    Query,
    Res,
    BadRequestException,
    UseGuards,
} from '@nestjs/common';
import { ImageFiltersListDto } from './dto/image-filters-list.dto';
import { ImageService } from './image.service';
import { instanceToPlain } from 'class-transformer';
import { ImageEntity } from '../../common/entities/image.entity';
import { ExposePaginationHeaders, setPaginationHeaders } from '../../common/pagination';
import { type Response } from 'express';
import { pipeline } from 'stream/promises';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { Role } from '../../common/decorators/role.decorator';

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
