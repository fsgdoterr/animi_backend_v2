import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { type Response } from 'express';
import { Role } from '../../common/decorators/role.decorator';
import { ProducerEntity } from '../../common/entities/producer.entity';
import { adminGuards } from '../../common/helpers/admin.accept';
import {
    ExposePaginationHeaders,
    setPaginationHeaders,
} from '../../common/pagination';
import { UserRole } from '../../generated/prisma/enums';
import { ProducerFiltersDto } from './dto/producer-filters.dto';
import { ProducerService } from './producer.service';

@Controller('producer')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class ProducerController {
    constructor(private readonly producerService: ProducerService) {}

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: ProducerFiltersDto,
    ) {
        const result = await this.producerService.findAll(filters);
        setPaginationHeaders(res, result);

        return result.items.map((producer) =>
            instanceToPlain(new ProducerEntity(producer), {
                groups: ['private'],
            }),
        );
    }
}
