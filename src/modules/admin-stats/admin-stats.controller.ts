import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { Role } from '../../common/decorators/role.decorator';
import { adminGuards } from '../../common/helpers/admin.accept';
import { UserRole } from '../../generated/prisma/enums';
import { AdminStatsService } from './admin-stats.service';

@Controller('admin/stats')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class AdminStatsController {
    constructor(private readonly statsService: AdminStatsService) {}

    @Get('dashboard')
    getDashboard() {
        return this.statsService.getDashboard();
    }

    @Get('anime/:id')
    getAnime(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getAnimeStats(id);
    }

    @Get('user/:id')
    getUser(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getUserStats(id);
    }

    @Get('genre/:id')
    getGenre(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getGenreStats(id);
    }

    @Get('player/:id')
    getPlayer(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getPlayerStats(id);
    }

    @Get('dub-team/:id')
    getDubTeam(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getDubTeamStats(id);
    }

    @Get('code/:id')
    getCode(@Param('id', ParseIntPipe) id: number) {
        return this.statsService.getCodeStats(id);
    }
}
