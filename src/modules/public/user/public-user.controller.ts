import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { User } from '../../../common/decorators/user.decorator';
import { UserEntity } from '../../../common/entities/user.entity';
import { OptionalSessionAuthGuard } from '../../../common/guards/optional-session-auth.guard';
import { SessionAuthGuard } from '../../../common/guards/session-auth.guard';
import {
    CreatePublicPlaylistDto,
    CreatePublicPlaylistItemDto,
    PublicPlaylistImageQueryDto,
    PublicUserActivityQueryDto,
    ReorderPublicPlaylistItemsDto,
    UpdatePublicPlaylistDto,
    UpdatePublicPlaylistItemDto,
} from './dto/public-user.dto';
import { PublicUserService } from './public-user.service';

@Controller('public/users')
export class PublicUserController {
    constructor(private readonly publicUserService: PublicUserService) {}

    @Get(':username')
    @UseGuards(OptionalSessionAuthGuard)
    profile(
        @Param('username') username: string,
        @User() viewer?: UserEntity,
    ) {
        return this.publicUserService.profile(username, viewer?.id);
    }

    @Get(':username/activity')
    @UseGuards(OptionalSessionAuthGuard)
    activity(
        @Param('username') username: string,
        @Query() query: PublicUserActivityQueryDto,
        @User() viewer?: UserEntity,
    ) {
        return this.publicUserService.activity(
            username,
            query.page ?? 1,
            query.limit ?? 20,
            viewer?.id,
        );
    }


    @Get(':username/playlist-images')
    @UseGuards(SessionAuthGuard)
    playlistImages(
        @Param('username') username: string,
        @User() user: UserEntity,
        @Query() query: PublicPlaylistImageQueryDto,
    ) {
        return this.publicUserService.playlistImages(
            username,
            user.id,
            query.page ?? 1,
            query.limit ?? 18,
            query.search,
        );
    }

    @Get(':username/lists/:slug')
    @UseGuards(OptionalSessionAuthGuard)
    playlist(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @User() viewer?: UserEntity,
    ) {
        return this.publicUserService.playlist(username, slug, viewer?.id);
    }

    @Post(':username/lists')
    @UseGuards(SessionAuthGuard)
    createPlaylist(
        @Param('username') username: string,
        @User() user: UserEntity,
        @Body() dto: CreatePublicPlaylistDto,
    ) {
        return this.publicUserService.createPlaylist(username, user.id, dto);
    }

    @Patch(':username/lists/:slug')
    @UseGuards(SessionAuthGuard)
    updatePlaylist(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @User() user: UserEntity,
        @Body() dto: UpdatePublicPlaylistDto,
    ) {
        return this.publicUserService.updatePlaylist(username, slug, user.id, dto);
    }

    @Post(':username/lists/:slug/items')
    @UseGuards(SessionAuthGuard)
    addPlaylistItem(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @User() user: UserEntity,
        @Body() dto: CreatePublicPlaylistItemDto,
    ) {
        return this.publicUserService.addPlaylistItem(
            username,
            slug,
            user.id,
            dto,
        );
    }

    @Patch(':username/lists/:slug/items/:itemId')
    @UseGuards(SessionAuthGuard)
    updatePlaylistItem(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @Param('itemId', ParseIntPipe) itemId: number,
        @User() user: UserEntity,
        @Body() dto: UpdatePublicPlaylistItemDto,
    ) {
        return this.publicUserService.updatePlaylistItem(
            username,
            slug,
            itemId,
            user.id,
            dto,
        );
    }

    @Put(':username/lists/:slug/items/order')
    @UseGuards(SessionAuthGuard)
    reorderPlaylistItems(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @User() user: UserEntity,
        @Body() dto: ReorderPublicPlaylistItemsDto,
    ) {
        return this.publicUserService.reorderPlaylistItems(
            username,
            slug,
            user.id,
            dto.orderedItemIds,
        );
    }

    @Delete(':username/lists/:slug/items/:itemId')
    @UseGuards(SessionAuthGuard)
    removePlaylistItem(
        @Param('username') username: string,
        @Param('slug') slug: string,
        @Param('itemId', ParseIntPipe) itemId: number,
        @User() user: UserEntity,
    ) {
        return this.publicUserService.removePlaylistItem(
            username,
            slug,
            itemId,
            user.id,
        );
    }
}
