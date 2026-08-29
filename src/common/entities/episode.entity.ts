import { Expose } from 'class-transformer';

export class EpisodeEntity {
    id: number;
    animeId: number;
    number: number;
    title: string | null;
    variants: unknown[];

    @Expose({ groups: ['private'] })
    createdAt: Date;

    @Expose({ groups: ['private'] })
    updatedAt: Date;

    constructor(partial: Partial<EpisodeEntity>) {
        Object.assign(this, partial);
    }
}
