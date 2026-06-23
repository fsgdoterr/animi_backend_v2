import { Prisma } from "../../generated/prisma/client";

export const DubTeamSelect = {
    id: true,
    title: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.DubTeamSelect;