import { Injectable } from '@nestjs/common';
import { PublicAnimeService } from '../anime/public-anime.service';

@Injectable()
export class PublicMetaService {
    constructor(private readonly publicAnimeService: PublicAnimeService) {}

    animeCatalog() {
        return this.publicAnimeService.meta();
    }
}
