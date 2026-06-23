import { Module } from '@nestjs/common';
import { GenreService } from './genre.service';
import { GenreController } from './genre.controller';
import { AuthModule } from '../auth/auth.module';
import { ImageModule } from '../image/image.module';

@Module({
    imports: [AuthModule, ImageModule],
    controllers: [GenreController],
    providers: [GenreService],
})
export class GenreModule {}
