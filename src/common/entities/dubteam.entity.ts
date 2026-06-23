import { Expose } from 'class-transformer';

export class DubTeamEntity {
    id: number;
    title: string;

    @Expose({ groups: ['private'] })
    createdAt: Date;
    @Expose({ groups: ['private'] })
    updatedAt: Date;
    constructor(partial: Partial<DubTeamEntity>) {
        Object.assign(this, partial);
    }
}
