import { Module } from '@nestjs/common';
import { PublicSearchController } from './public-search.controller';
import { PublicSearchService } from './public-search.service';

@Module({
    controllers: [PublicSearchController],
    providers: [PublicSearchService],
})
export class PublicSearchModule {}
