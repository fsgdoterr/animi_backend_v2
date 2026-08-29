import { Prisma } from '../../generated/prisma/client';
import { DubTeamSelect } from './dubteam.orm';
import { PlayerSelect } from './player.orm';

export const EpisodeVariantSelect = {
    id: true,
    sourceType: true,
    endpoint: true,
    dubType: true,
    isActive: true,
    dubTeam: {
        select: DubTeamSelect,
    },
    player: {
        select: PlayerSelect,
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.EpisodeVariantSelect;

export const EpisodeSelect = {
    id: true,
    animeId: true,
    number: true,
    title: true,
    variants: {
        orderBy: [{ id: 'asc' }],
        select: EpisodeVariantSelect,
    },
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.EpisodeSelect;
