import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import appConfig from './common/config/app.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { DubteamModule } from './modules/dubteam/dubteam.module';
import { PlayerModule } from './modules/player/player.module';
import { GenreModule } from './modules/genre/genre.module';
import { ImageModule } from './modules/image/image.module';
import { UserModule } from './modules/user/user.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [appConfig],
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => [
                {
                    ttl: configService.getOrThrow<number>('throttle.ttl'),
                    limit: configService.getOrThrow<number>('throttle.limit'),
                },
            ],
        }),
        PrismaModule,
        AuthModule,
        DubteamModule,
        PlayerModule,
        GenreModule,
        ImageModule,
        UserModule,
    ],
    controllers: [],
    providers: [
        {
            provide: APP_INTERCEPTOR,
            inject: [Reflector],
            useFactory: (reflector: Reflector) => {
                return new ClassSerializerInterceptor(reflector, {});
            },
        },
    ],
})
export class AppModule {}
