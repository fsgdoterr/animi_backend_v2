import { PrismaClient } from '../../../generated/prisma/client';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
{
    constructor(private readonly configService: ConfigService) {
        const connectionString =
            configService.getOrThrow<string>('databaseUrl');
        const adapter = new PrismaPg({ connectionString });

        super({
            adapter,
            log:
                configService.get<string>('nodeEnv') === 'development'
                    ? ['query', 'error', 'warn']
                    : ['error', 'warn'],
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
