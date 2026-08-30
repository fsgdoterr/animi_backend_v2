import { Module } from '@nestjs/common';
import { PublicAnimeModule } from '../anime/public-anime.module';
import { PublicMetaController } from './public-meta.controller';
import { PublicMetaService } from './public-meta.service';

@Module({
    imports: [PublicAnimeModule],
    controllers: [PublicMetaController],
    providers: [PublicMetaService],
})
export class PublicMetaModule {}
