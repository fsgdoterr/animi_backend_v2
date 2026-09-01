import { Module } from '@nestjs/common';
import { AnimeService } from './anime.service';
import { AnimeController } from './anime.controller';
import { AuthModule } from '../auth/auth.module';
import { ImageModule } from '../image/image.module';
import { GenreModule } from '../genre/genre.module';

@Module({
    imports: [ImageModule, AuthModule, GenreModule],
    controllers: [AnimeController],
    providers: [AnimeService],
    exports: [AnimeService],
})
export class AnimeModule {}
