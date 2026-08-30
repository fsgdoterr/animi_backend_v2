import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PublicAnimeController } from './public-anime.controller';
import { PublicAnimeService } from './public-anime.service';

@Module({
    imports: [AuthModule],
    controllers: [PublicAnimeController],
    providers: [PublicAnimeService],
    exports: [PublicAnimeService],
})
export class PublicAnimeModule {}
