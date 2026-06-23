import { Expose } from 'class-transformer';
import { ImageEntity } from './image.entity';

export class GenreEntity {
    id: number;
    slug: string;
    title: string;

    poster: ImageEntity | null;

    @Expose({ groups: ['private'] })
    createdAt: Date;
    @Expose({ groups: ['private'] })
    updatedAt: Date;
    constructor(partial: Partial<GenreEntity>) {
        Object.assign(this, partial);

        this.poster = partial.poster ? new ImageEntity(partial.poster) : null;
    }
}
