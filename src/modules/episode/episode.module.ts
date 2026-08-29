import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EpisodeController } from './episode.controller';
import { EpisodeService } from './episode.service';

@Module({
    imports: [AuthModule],
    controllers: [EpisodeController],
    providers: [EpisodeService],
})
export class EpisodeModule {}
