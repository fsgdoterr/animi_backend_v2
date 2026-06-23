import { Module } from '@nestjs/common';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [AuthModule],
    controllers: [PlayerController],
    providers: [PlayerService],
})
export class PlayerModule {}
