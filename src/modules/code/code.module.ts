import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CodeController } from './code.controller';
import { CodeService } from './code.service';

@Module({
    imports: [AuthModule],
    controllers: [CodeController],
    providers: [CodeService],
})
export class CodeModule {}
