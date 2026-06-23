import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import appConfig from './common/config/app.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';

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
