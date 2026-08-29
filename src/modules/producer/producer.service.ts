import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { ProducerFiltersDto } from './dto/producer-filters.dto';

type ProducerRow = {
    id: number;
    title: string;
    createdAt: Date;
    updatedAt: Date;
};

@Injectable()
export class ProducerService {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(filters: ProducerFiltersDto) {
        const page = filters.page ?? 1;
        const limit = Math.min(filters.limit ?? 20, 100);
        const offset = (page - 1) * limit;
        const search = filters.search?.trim();
        const pattern = search ? `%${search}%` : null;

        const [items, countRows] = await Promise.all([
            pattern
                ? this.prisma.$queryRawUnsafe<ProducerRow[]>(
                      'SELECT "id", "title", "createdAt", "updatedAt" FROM "Producer" WHERE "title" ILIKE $1 ORDER BY "title" ASC, "id" ASC LIMIT $2 OFFSET $3',
                      pattern,
                      limit,
                      offset,
                  )
                : this.prisma.$queryRawUnsafe<ProducerRow[]>(
                      'SELECT "id", "title", "createdAt", "updatedAt" FROM "Producer" ORDER BY "title" ASC, "id" ASC LIMIT $1 OFFSET $2',
                      limit,
                      offset,
                  ),
            pattern
                ? this.prisma.$queryRawUnsafe<{ count: number }[]>(
                      'SELECT COUNT(*)::int AS "count" FROM "Producer" WHERE "title" ILIKE $1',
                      pattern,
                  )
                : this.prisma.$queryRawUnsafe<{ count: number }[]>(
                      'SELECT COUNT(*)::int AS "count" FROM "Producer"',
                  ),
        ]);

        const totalCount = countRows[0]?.count ?? 0;
        const totalPages = Math.ceil(totalCount / limit);

        return {
            items,
            pageInfo: {
                hasMore: page < totalPages,
                nextCursor: null,
            },
            pageMeta: {
                page,
                limit,
                totalCount,
                totalPages,
            },
        };
    }
}
