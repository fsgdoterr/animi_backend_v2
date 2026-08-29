import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProducerController } from './producer.controller';
import { ProducerService } from './producer.service';

@Module({
    imports: [AuthModule],
    controllers: [ProducerController],
    providers: [ProducerService],
})
export class ProducerModule {}
