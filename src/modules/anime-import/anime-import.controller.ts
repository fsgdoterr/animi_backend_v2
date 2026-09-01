import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Role } from '../../common/decorators/role.decorator';
import { adminGuards } from '../../common/helpers/admin.accept';
import { DubType, UserRole } from '../../generated/prisma/enums';
import { AnimeImportService } from './anime-import.service';

@Controller('anime-import')
@UseGuards(...adminGuards)
@Role(UserRole.ADMIN)
export class AnimeImportController {
    constructor(private readonly service: AnimeImportService) {}

    @Post('upload')
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: 100 * 1024 * 1024 },
            fileFilter: (_req, file, callback) => {
                const ok = file.originalname.toLowerCase().endsWith('.zip');
                callback(ok ? null : new Error('Потрібен ZIP-файл.'), ok);
            },
        }),
    )
    upload(@UploadedFile() file: any) {
        if (!file?.buffer) throw new BadRequestException('Файл не передано.');
        return this.service.uploadZip(file.buffer, file.originalname);
    }

    @Post('restore')
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'storage', maxCount: 1 },
                { name: 'results', maxCount: 1 },
            ],
            { limits: { fileSize: 150 * 1024 * 1024 } },
        ),
    )
    restore(
        @UploadedFiles()
        files: { storage?: any[]; results?: any[] },
    ) {
        const storage = files?.storage?.[0];
        const results = files?.results?.[0];
        if (!storage?.buffer || !results?.buffer) {
            throw new BadRequestException('Потрібні storage.zip та results.zip.');
        }
        return this.service.restoreFromArchives(
            storage.buffer,
            results.buffer,
            storage.originalname,
            results.originalname,
        );
    }

    @Get()
    overview(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('reviewReason') reviewReason?: string,
        @Query('reviewCategory') reviewCategory?: string,
        @Query('episodeQueue') episodeQueue?: string,
        @Query('reviewBlocks') reviewBlocks?: string,
    ) {
        return this.service.getOverview({
            status,
            search,
            page: Number(page) || 1,
            limit: Number(limit) || 50,
            reviewReason,
            reviewCategory,
            episodeQueue,
            reviewBlocks,
        });
    }

    @Post('process')
    process(@Body() body: { limit?: number }) {
        return this.service.processPending(body?.limit ?? 5);
    }

    @Post('import-ready')
    importReady(@Body() body: { limit?: number }) {
        return this.service.importReady(body?.limit ?? 5);
    }

    @Patch('mappings/:kind')
    setMapping(
        @Param('kind') kind: 'player' | 'dubTeam',
        @Body() body: { label: string; id: number | null },
    ) {
        if (kind !== 'player' && kind !== 'dubTeam') throw new BadRequestException('Некоректний тип відповідності.');
        return this.service.setMapping(kind, body.label, body.id);
    }

    @Get('records/:key')
    record(@Param('key') key: string) {
        return this.service.getRecord(key);
    }

    @Patch('records/:key/metadata')
    updateMetadata(
        @Param('key') key: string,
        @Body() body: { description?: string | null },
    ) {
        return this.service.updateMetadata(key, body ?? {});
    }

    @Post('records/:key/resolve')
    resolve(
        @Param('key') key: string,
        @Body() body: { hikka?: string; mal?: string; al?: string },
    ) {
        return this.service.resolveManual(key, body ?? {});
    }

    @Post('records/:key/episodes/rule')
    applyRule(
        @Param('key') key: string,
        @Body()
        body: {
            match?: string;
            dubType: DubType;
            playerId: number;
            dubTeamId: number;
            startEpisode: number;
        },
    ) {
        return this.service.applyEpisodeRule(key, body);
    }

    @Post('records/:key/episodes/review/resolve')
    resolveEpisodeReview(
        @Param('key') key: string,
        @Body()
        body: {
            blockRoles?: Record<string, 'type' | 'team' | 'player' | 'range' | 'ignore' | null>;
            typeOverrides?: Record<string, DubType | null>;
            teamOverrides?: Record<string, { id?: number | null; title?: string | null } | null>;
            fallbackType?: DubType | null;
            fallbackTeamId?: number | null;
            fallbackTeamTitle?: string | null;
            episodeOverrides?: Record<string, number | null>;
            excludedVideoKeys?: string[];
        },
    ) {
        return this.service.resolveEpisodeReview(key, body ?? {});
    }

    @Post('records/:key/episodes/manual')
    addManualEpisodes(
        @Param('key') key: string,
        @Body()
        body: {
            dubType: DubType;
            playerId?: number | null;
            playerTitle?: string | null;
            dubTeamId?: number | null;
            dubTeamTitle?: string | null;
            episodes: Array<{ episode: number; link: string }>;
            markReviewDone?: boolean;
        },
    ) {
        return this.service.addManualEpisodes(key, body);
    }

    @Post('records/:key/import')
    importRecord(@Param('key') key: string) {
        return this.service.importRecord(key);
    }
}
