import { Expose } from "class-transformer";

export class ImageEntity {
    id: number;
    path: string;
    @Expose({ groups: ['private'] })
    sourceUrl: string | null;
    @Expose({ groups: ['private'] })
    createdAt: Date;
    @Expose({ groups: ['private'] })
    updatedAt: Date;

    constructor(partial: Partial<ImageEntity>) {
        Object.assign(this, partial);
    }
}