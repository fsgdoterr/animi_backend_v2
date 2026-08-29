import { Expose } from 'class-transformer';

export class ImageEntity {
    id: number;
    path: string;
    isAvatarAllowed: boolean;

    @Expose({ groups: ['private'] })
    sourceUrl: string | null;
    @Expose({ groups: ['private'] })
    createdAt: Date;
    @Expose({ groups: ['private'] })
    updatedAt: Date;

    _count?: {
        avatars: number;
        genres: number;
        animes: number;
        animeAdditionalImages: number;
    };
    avatars?: { id: number; username: string; displayName: string | null }[];
    genres?: { id: number; title: string }[];
    animes?: { id: number; title: string }[];
    animeAdditionalImages?: { id: number; title: string }[];

    constructor(partial: Partial<ImageEntity>) {
        Object.assign(this, partial);
    }
}
