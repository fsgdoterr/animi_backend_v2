import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { AuthModule } from '../auth/auth.module';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule, AuthModule],
    controllers: [ImageController],
    providers: [ImageService],
    exports: [ImageService],
})
export class ImageModule {}
