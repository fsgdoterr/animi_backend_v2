import { Expose } from 'class-transformer';
import { ImageEntity } from './image.entity';
import { UserPermissions, UserRole } from '../../generated/prisma/enums';

export class UserEntity {
    id: number;
    username: string;
    displayName: string | null;
    avatar: ImageEntity | null;
    createdAt: Date;
    role: UserRole;
    _count?: {
        views: number;
        reviews: number;
        comments: number;
        subscriptions: number;
    };
    
    @Expose({groups: ["private", "me"]})
    email: string;
    @Expose({groups: ["private", "me"]})
    permissions: UserPermissions[];
    @Expose({groups: ["private"]})
    updatedAt: Date;

    constructor(partial: Partial<UserEntity>) {
        Object.assign(this, partial);

        this.avatar = partial.avatar ? new ImageEntity(partial.avatar) : null;
    }
}