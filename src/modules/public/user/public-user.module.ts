import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PublicUserController } from './public-user.controller';
import { PublicUserService } from './public-user.service';

@Module({
    imports: [AuthModule],
    controllers: [PublicUserController],
    providers: [PublicUserService],
})
export class PublicUserModule {}
