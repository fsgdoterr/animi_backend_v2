import { Expose, Type } from 'class-transformer';
import { ImageEntity } from './image.entity';

class AnimeCodeAnimeEntity {
    id: number;
    slug: string;
    title: string;
    originalTitle: string | null;
    engTitle: string | null;
    type: string;
    status: string;

    @Type(() => ImageEntity)
    poster: ImageEntity | null;

    constructor(partial: Partial<AnimeCodeAnimeEntity>) {
        Object.assign(this, partial);
        this.poster = partial.poster ? new ImageEntity(partial.poster) : null;
    }
}

export class AnimeCodeEntity {
    id: number;
    animeId: number;
    code: string;

    @Type(() => AnimeCodeAnimeEntity)
    anime: AnimeCodeAnimeEntity;

    _count: {
        views: number;
    };

    @Expose({ groups: ['private'] })
    createdAt: Date;

    @Expose({ groups: ['private'] })
    updatedAt: Date;

    constructor(partial: Partial<AnimeCodeEntity>) {
        Object.assign(this, partial);
        this.anime = new AnimeCodeAnimeEntity(partial.anime ?? {});
        this._count = partial._count ?? { views: 0 };
    }
}
