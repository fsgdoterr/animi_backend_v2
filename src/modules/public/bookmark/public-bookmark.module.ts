import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PublicBookmarkController } from './public-bookmark.controller';
import { PublicBookmarkService } from './public-bookmark.service';

@Module({
    imports: [AuthModule],
    controllers: [PublicBookmarkController],
    providers: [PublicBookmarkService],
})
export class PublicBookmarkModule {}
