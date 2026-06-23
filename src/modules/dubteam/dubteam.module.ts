import { Module } from '@nestjs/common';
import { DubteamService } from './dubteam.service';
import { DubteamController } from './dubteam.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [AuthModule],
    controllers: [DubteamController],
    providers: [DubteamService],
})
export class DubteamModule {}
