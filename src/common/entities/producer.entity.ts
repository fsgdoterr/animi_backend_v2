import { Expose } from 'class-transformer';

export class ProducerEntity {
    id: number;
    title: string;

    @Expose({ groups: ['private'] })
    createdAt: Date;

    @Expose({ groups: ['private'] })
    updatedAt: Date;

    constructor(partial: Partial<ProducerEntity>) {
        Object.assign(this, partial);
    }
}
