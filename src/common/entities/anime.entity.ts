import { Expose, Type } from 'class-transformer';
import { GenreEntity } from './genre.entity';
import { ImageEntity } from './image.entity';
import { ProducerEntity } from './producer.entity';

export class AnimeEntity {
    id: number;
    slug: string;
    title: string;
    originalTitle: string | null;
    engTitle: string | null;

    @Type(() => ImageEntity)
    poster: ImageEntity | null;

    @Type(() => ImageEntity)
    additionalImages?: ImageEntity[];

    rating: string | null;
    description: string | null;
    country: string | null;

    @Type(() => GenreEntity)
    genres: GenreEntity[];

    @Type(() => ProducerEntity)
    producers?: ProducerEntity[];

    relatedAnimes?: unknown[];
    releaseDate: Date | null;
    endDate?: Date | null;
    episodesTotal?: number | null;
    seasonNumber?: number | null;
    partNumber?: number | null;
    duration?: number | null;
    type: string;
    status: string;
    studio?: string | null;
    mal?: string | null;
    al?: string | null;
    _count?: {
        episodes: number;
        reviews: number;
        views: number;
    };
    averageReviewRating?: number | null;

    @Expose({ groups: ['private'] })
    createdAt: Date;

    @Expose({ groups: ['private'] })
    updatedAt: Date;

    constructor(partial: Partial<AnimeEntity>) {
        Object.assign(this, partial);

        this.poster = partial.poster ? new ImageEntity(partial.poster) : null;
        this.additionalImages = partial.additionalImages?.map(
            (image) => new ImageEntity(image),
        );
        this.genres = partial.genres?.map((genre) => new GenreEntity(genre)) ?? [];
        this.producers = partial.producers?.map(
            (producer) => new ProducerEntity(producer),
        );
    }
}
