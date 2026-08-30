import { PrismaService } from '../../../common/database/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { DubType } from '../../../generated/prisma/enums';

export interface PublicEpisodeStats {
    dubEpisodesCount: number;
    subEpisodesCount: number;
}

type PublicEpisodeStatsRow = PublicEpisodeStats & {
    animeId: number;
};

export async function getPublicEpisodeStats(
    prisma: PrismaService,
    animeIds: number[],
): Promise<Map<number, PublicEpisodeStats>> {
    const ids = [...new Set(animeIds)];
    if (!ids.length) return new Map();

    const rows = await prisma.$queryRaw<PublicEpisodeStatsRow[]>(Prisma.sql`
        SELECT
            e."animeId" AS "animeId",
            COUNT(DISTINCT e."id") FILTER (
                WHERE ev."isActive" = true
                  AND ev."dubType" = ${DubType.DUB}::"DubType"
            )::int AS "dubEpisodesCount",
            COUNT(DISTINCT e."id") FILTER (
                WHERE ev."isActive" = true
                  AND ev."dubType" = ${DubType.SUB}::"DubType"
            )::int AS "subEpisodesCount"
        FROM "Episode" e
        LEFT JOIN "EpisodeVariant" ev ON ev."episodeId" = e."id"
        WHERE e."animeId" IN (${Prisma.join(ids)})
        GROUP BY e."animeId"
    `);

    return new Map(
        rows.map((row) => [
            row.animeId,
            {
                dubEpisodesCount: row.dubEpisodesCount,
                subEpisodesCount: row.subEpisodesCount,
            },
        ]),
    );
}
