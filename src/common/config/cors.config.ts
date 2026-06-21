import { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function createCorsConfig(configService: ConfigService): CorsOptions {
    const clientUrl = configService.get<string>('clientUrl');

    return {
        origin: clientUrl,
        credentials: true,
        exposedHeaders: [
            'X-Has-More',
            'X-Next-Cursor',
            'X-Page',
            'X-Limit',
            'X-Total-Count',
            'X-TotalPages',
        ],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    };
}
