import { Prisma } from '../../generated/prisma/client';
import { ImageSelect } from './image.orm';

export const UserSelect = {
    id: true,
    username: true,
    email: true,
    displayName: true,
    avatar: {
        select: ImageSelect,
    },
    role: true,
    permissions: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.UserSelect;
