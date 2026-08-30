import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { type Response } from 'express';
import { User } from '../../../common/decorators/user.decorator';
import { UserEntity } from '../../../common/entities/user.entity';
import { SessionAuthGuard } from '../../../common/guards/session-auth.guard';
import { ExposePaginationHeaders, setPaginationHeaders } from '../../../common/pagination';
import { PublicAnimeFiltersDto } from './dto/public-anime-filters.dto';
import {
    CreatePublicCommentDto,
    RatePublicAnimeDto,
    ReactPublicCommentDto,
} from './dto/public-anime-interaction.dto';
import { PublicAnimeService } from './public-anime.service';

@Controller('public/anime')
export class PublicAnimeController {
    constructor(private readonly publicAnimeService: PublicAnimeService) {}

    @Get('home')
    home() {
        return this.publicAnimeService.home();
    }

    @Get('meta')
    meta() {
        return this.publicAnimeService.meta();
    }

    @Get('random')
    random() {
        return this.publicAnimeService.random();
    }

    @Get()
    @ExposePaginationHeaders()
    async findAll(
        @Res({ passthrough: true }) res: Response,
        @Query() filters: PublicAnimeFiltersDto,
    ) {
        const result = await this.publicAnimeService.findAll(filters);
        setPaginationHeaders(res, result);
        return result.items;
    }

    @Get(':slug/comments')
    comments(
        @Param('slug') slug: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('sort') sort?: 'new' | 'old' | 'top',
    ) {
        return this.publicAnimeService.comments(slug, page, limit, sort);
    }

    @Post(':slug/comments')
    @UseGuards(SessionAuthGuard)
    createComment(
        @Param('slug') slug: string,
        @User() user: UserEntity,
        @Body() dto: CreatePublicCommentDto,
    ) {
        return this.publicAnimeService.createComment(slug, user.id, dto.text, dto.parentId);
    }

    @Post(':slug/comments/:commentId/reaction')
    @UseGuards(SessionAuthGuard)
    reactToComment(
        @Param('slug') slug: string,
        @Param('commentId', ParseIntPipe) commentId: number,
        @User() user: UserEntity,
        @Body() dto: ReactPublicCommentDto,
    ) {
        return this.publicAnimeService.reactToComment(slug, commentId, user.id, dto.type);
    }

    @Post(':slug/view')
    @UseGuards(SessionAuthGuard)
    recordView(@Param('slug') slug: string, @User() user: UserEntity) {
        return this.publicAnimeService.recordView(slug, user.id);
    }

    @Get(':slug/review/me')
    @UseGuards(SessionAuthGuard)
    getMyReview(@Param('slug') slug: string, @User() user: UserEntity) {
        return this.publicAnimeService.getMyReview(slug, user.id);
    }

    @Put(':slug/review')
    @UseGuards(SessionAuthGuard)
    rate(
        @Param('slug') slug: string,
        @User() user: UserEntity,
        @Body() dto: RatePublicAnimeDto,
    ) {
        return this.publicAnimeService.rate(slug, user.id, dto.rating);
    }

    @Get(':slug')
    findOne(@Param('slug') slug: string) {
        return this.publicAnimeService.findOne(slug);
    }
}
