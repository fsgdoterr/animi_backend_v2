import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

@Module({
    imports: [AuthModule],
    controllers: [AdminStatsController],
    providers: [AdminStatsService],
})
export class AdminStatsModule {}
