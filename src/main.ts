import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import express from 'express';
import { createCorsConfig } from './common/config/cors.config';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    const configService = app.get(ConfigService);

    app.setGlobalPrefix(configService.getOrThrow<string>('apiPrefix'));

    app.use(
        helmet({
            crossOriginResourcePolicy: {
                policy: 'cross-origin',
            },
        }),
    );
    app.use(compression());
    app.use(cookieParser());
    app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

    app.enableCors(createCorsConfig(configService));

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },

            stopAtFirstError: true,
        }),
    );

    const port = configService.getOrThrow<number>('port');

    await app.listen(port, '0.0.0.0', () => {});
}

void bootstrap();
