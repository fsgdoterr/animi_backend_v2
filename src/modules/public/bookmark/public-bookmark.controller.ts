import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { User } from '../../../common/decorators/user.decorator';
import { UserEntity } from '../../../common/entities/user.entity';
import { SessionAuthGuard } from '../../../common/guards/session-auth.guard';
import { PublicBookmarksQueryDto } from './dto/public-bookmark.dto';
import { PublicBookmarkService } from './public-bookmark.service';

@Controller('public/bookmarks')
@UseGuards(SessionAuthGuard)
export class PublicBookmarkController {
    constructor(private readonly publicBookmarkService: PublicBookmarkService) {}

    @Get()
    findAll(@User() user: UserEntity, @Query() query: PublicBookmarksQueryDto) {
        return this.publicBookmarkService.findAll(
            user.id,
            query.page ?? 1,
            query.limit ?? 30,
        );
    }

    @Get('ids')
    ids(@User() user: UserEntity) {
        return this.publicBookmarkService.ids(user.id);
    }

    @Post(':animeId')
    add(
        @User() user: UserEntity,
        @Param('animeId', ParseIntPipe) animeId: number,
    ) {
        return this.publicBookmarkService.add(user.id, animeId);
    }

    @Delete(':animeId')
    remove(
        @User() user: UserEntity,
        @Param('animeId', ParseIntPipe) animeId: number,
    ) {
        return this.publicBookmarkService.remove(user.id, animeId);
    }
}
