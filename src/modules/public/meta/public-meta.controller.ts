import { Controller, Get } from '@nestjs/common';
import { PublicMetaService } from './public-meta.service';

@Controller('public/meta')
export class PublicMetaController {
    constructor(private readonly publicMetaService: PublicMetaService) {}

    @Get('anime')
    animeCatalog() {
        return this.publicMetaService.animeCatalog();
    }
}
