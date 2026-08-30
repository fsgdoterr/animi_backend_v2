import { Controller, Get, Query } from '@nestjs/common';
import { PublicSearchDto } from './dto/public-search.dto';
import { PublicSearchService } from './public-search.service';

@Controller('public/search')
export class PublicSearchController {
    constructor(private readonly publicSearchService: PublicSearchService) {}

    @Get()
    search(@Query() query: PublicSearchDto) {
        return this.publicSearchService.search(query);
    }
}
