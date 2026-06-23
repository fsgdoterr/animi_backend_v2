import { Expose } from 'class-transformer';

export class PlayerEntity {
    id: number;
    title: string;

    @Expose({ groups: ['private'] })
    createdAt: Date;
    @Expose({ groups: ['private'] })
    updatedAt: Date;
    constructor(partial: Partial<PlayerEntity>) {
        Object.assign(this, partial);
    }
}
