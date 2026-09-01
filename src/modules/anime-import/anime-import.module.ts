import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnimeModule } from '../anime/anime.module';
import { AnimeImportController } from './anime-import.controller';
import { AnimeImportService } from './anime-import.service';

@Module({
    imports: [AuthModule, AnimeModule],
    controllers: [AnimeImportController],
    providers: [AnimeImportService],
})
export class AnimeImportModule {}
