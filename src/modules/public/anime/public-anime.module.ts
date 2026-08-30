import { Module } from '@nestjs/common';
import { PublicAnimeController } from './public-anime.controller';
import { PublicAnimeService } from './public-anime.service';

@Module({
    controllers: [PublicAnimeController],
    providers: [PublicAnimeService],
    exports: [PublicAnimeService],
})
export class PublicAnimeModule {}
