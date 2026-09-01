import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import {
    AnimeRating,
    AnimeStatus,
    AnimeType,
    DubType,
    EpisodeSourceType,
} from '../../generated/prisma/enums';
import { AnimeService } from '../anime/anime.service';

type ImportRecordStatus =
    | 'PENDING'
    | 'READY'
    | 'REVIEW'
    | 'UNRESOLVED'
    | 'IMPORTED'
    | 'FAILED';

type ParserEpisode = {
    episode: number;
    source?: 'main' | 'review' | 'manual';
    type: 'DUB' | 'SUB';
    link: string;
    player?: string | null;
    dubteam?: string | null;
    playerId?: number | null;
    dubTeamId?: number | null;
};

type ManualVideo = {
    id?: string | number;
    label?: string | null;
    file?: string | null;
    provider?: string | null;
    ancestors?: unknown;
};

type ReviewBlockRole = 'type' | 'team' | 'player' | 'range' | 'ignore';

type EpisodeReviewResolutionInput = {
    blockRoles?: Record<string, ReviewBlockRole | null>;
    typeOverrides?: Record<string, DubType | null>;
    teamOverrides?: Record<string, { id?: number | null; title?: string | null } | null>;
    fallbackType?: DubType | null;
    fallbackTeamId?: number | null;
    fallbackTeamTitle?: string | null;
    episodeOverrides?: Record<string, number | null>;
    excludedVideoKeys?: string[];
};

type ManualEpisodeInput = {
    episode: number;
    link: string;
};

type ImportMetadata = {
    title: string | null;
    originalTitle: string | null;
    engTitle: string | null;
    poster: string | null;
    rating: AnimeRating | null;
    description: string | null;
    descriptionLanguage: 'uk' | 'en' | null;
    country: string | null;
    genres: string[];
    producers: string[];
    releaseDate: string | null;
    endDate: string | null;
    episodesTotal: number | null;
    duration: number | null;
    type: AnimeType | null;
    status: AnimeStatus | null;
    studio: string | null;
    mal: string | null;
    al: string | null;
};

type ImportRecord = {
    key: string;
    link: string;
    anitubeId: number;
    parserTitle: string | null;
    originalTitle: string | null;
    parserEpisodes: ParserEpisode[];
    manualReview: Record<string, any> | null;
    manualHandledVideoIds: string[];
    episodeReviewDone?: boolean;
    status: ImportRecordStatus;
    issues: string[];
    warnings: string[];
    episodeIssues?: string[];
    metadata: ImportMetadata | null;
    resolution: {
        method?: string | null;
        hikkaSlug?: string | null;
        malId?: number | null;
        anilistId?: number | null;
    };
    animeId?: number | null;
    importedAsDraft?: boolean;
    lastError?: string | null;
    /** Resolver version that last attempted automatic metadata lookup. */
    resolverVersion?: number;
    updatedAt: string;
};

type ImportState = {
    version: 1;
    uploadedAt: string | null;
    updatedAt: string;
    sourceFilename: string | null;
    mappings: {
        players: Record<string, number>;
        dubTeams: Record<string, number>;
    };
    records: ImportRecord[];
};

@Injectable()
export class AnimeImportService implements OnModuleInit {
    private readonly storageDir = path.join(process.cwd(), 'storage', 'json');
    private readonly statePath = path.join(this.storageDir, 'anime-import.json');
    private readonly stateBackupPath = path.join(this.storageDir, 'anime-import.backup.json');
    private readonly preV6BackupPath = path.join(this.storageDir, 'anime-import.pre-v6.json');
    private readonly unresolvedPath = path.join(
        this.storageDir,
        'anime-import-unresolved.json',
    );
    /**
     * Bump this whenever automatic resolution logic changes in a way that
     * should retry records previously marked UNRESOLVED/FAILED.
     */
    private readonly resolverVersion = 5;
    private readonly importerVersion = '6.1.6';
    private readonly logger = new Logger(AnimeImportService.name);
    private stateSaveQueue: Promise<void> = Promise.resolve();
    private mutationQueue: Promise<void> = Promise.resolve();
    private readonly providerLastRequestAt = new Map<string, number>();

    private readonly http: AxiosInstance = axios.create({
        timeout: 20_000,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Animi anime importer/1.0',
            Accept: 'application/json',
        },
    });

    constructor(
        private readonly prisma: PrismaService,
        private readonly animeService: AnimeService,
    ) {}

    onModuleInit() {
        this.logger.log(
            `Mass importer v${this.importerVersion}; resolver v${this.resolverVersion}; state persistence=direct-write`,
        );
    }

    /**
     * Serialize the complete read -> mutate -> save transaction. Serializing only
     * saveState() is not enough: two HTTP requests could otherwise load the same
     * snapshot and the later one would overwrite changes made by the first.
     */
    private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.mutationQueue.catch(() => undefined);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.mutationQueue = previous.then(() => gate);
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    async uploadZip(buffer: Buffer, filename = 'results.zip') {
        return this.withMutationLock(async () => {
            const previous = await this.loadState();
            const state = this.buildStateFromResultsZip(buffer, filename, previous);
            await this.autoMapKnownLabels(state);
            for (const record of state.records) this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.getOverviewFromState(state, {});
        });
    }

    /**
     * Disaster-recovery path: the first ZIP is an old storage backup containing
     * anime-import.json, the second one is a fresh parser results.zip. Metadata,
     * provider IDs, already imported anime IDs and manual episode decisions come
     * from the old storage, while parser diagnostics/episodes are refreshed from
     * results.zip. No Hikka/MAL/AniList request is made here.
     */
    async restoreFromArchives(
        storageBuffer: Buffer,
        resultsBuffer: Buffer,
        storageFilename = 'storage.zip',
        resultsFilename = 'results.zip',
    ) {
        return this.withMutationLock(async () => {
            if (!storageBuffer?.length || !resultsBuffer?.length) {
                throw new BadRequestException('Потрібні обидва ZIP-файли: storage та results.zip.');
            }
            const previous = this.readStateFromStorageZip(storageBuffer, storageFilename);
            const state = this.buildStateFromResultsZip(resultsBuffer, resultsFilename, previous);
            await this.autoMapKnownLabels(state);
            for (const record of state.records) this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.getOverviewFromState(state, {});
        });
    }

    private buildStateFromResultsZip(
        buffer: Buffer,
        filename: string,
        previous: ImportState,
    ): ImportState {
        if (!buffer?.length) throw new BadRequestException('ZIP-файл порожній.');

        const entries = this.readZipEntries(buffer);
        const allLinks = this.readJsonArray(entries, 'all-links.json', true);
        const main = this.readJsonArray(entries, 'main.json', false);
        const manualReview = this.readJsonArray(entries, 'manual-review.json', false);

        const mainByLink = new Map(
            main
                .filter((item) => item?.link)
                .map((item) => [this.normalizeUrl(item.link), item]),
        );
        const reviewByLink = new Map(
            manualReview
                .filter((item) => item?.link)
                .map((item) => [this.normalizeUrl(item.link), item]),
        );

        const previousByKey = new Map(previous.records.map((item) => [item.key, item]));
        const records: ImportRecord[] = [];

        for (const raw of allLinks) {
            if (!raw?.link || typeof raw.link !== 'string') continue;
            const anitubeId = this.extractAniTubeId(raw.link);
            if (!anitubeId) continue;
            const key = String(anitubeId);
            const parsed = mainByLink.get(this.normalizeUrl(raw.link));
            const review = reviewByLink.get(this.normalizeUrl(raw.link));
            const old = previousByKey.get(key);
            const parserEpisodes = this.normalizeParserEpisodes(parsed?.episodes ?? [], 'main');
            const oldManualEpisodes = (old?.parserEpisodes ?? []).filter(
                (episode) => episode.source === 'manual' || Boolean(episode.playerId) || Boolean(episode.dubTeamId),
            );
            const mergedEpisodes = this.mergeParserEpisodes(parserEpisodes, oldManualEpisodes);

            const record: ImportRecord = {
                key,
                link: raw.link,
                anitubeId,
                parserTitle: this.cleanText(parsed?.name) ?? old?.parserTitle ?? null,
                originalTitle:
                    this.cleanText(raw.originalTitle) ??
                    this.cleanText(parsed?.originalTitle) ??
                    old?.originalTitle ??
                    null,
                parserEpisodes: mergedEpisodes,
                manualReview: review ?? old?.manualReview ?? null,
                manualHandledVideoIds: old?.manualHandledVideoIds ?? [],
                episodeReviewDone: old?.episodeReviewDone ?? false,
                metadata: old?.metadata ?? null,
                resolution: old?.resolution ?? {},
                animeId: old?.animeId ?? null,
                importedAsDraft: old?.importedAsDraft ?? false,
                issues: old?.issues ?? [],
                warnings: old?.warnings ?? [],
                episodeIssues: old?.episodeIssues ?? [],
                status: old?.status === 'IMPORTED' ? 'IMPORTED' : old?.metadata ? 'REVIEW' : 'PENDING',
                lastError: old?.lastError ?? null,
                resolverVersion: old?.resolverVersion ?? 0,
                updatedAt: new Date().toISOString(),
            };
            this.migrateManualVideoKeys(record);
            this.hydrateResolvedParserEpisodes(record);
            this.recalculateRecord(record, previous.mappings);
            if (!record.metadata && record.status !== 'IMPORTED') record.status = 'PENDING';
            records.push(record);
        }

        if (!records.length) {
            throw new BadRequestException(
                'У results.zip не знайдено валідних записів all-links.json.',
            );
        }

        return {
            version: 1,
            uploadedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sourceFilename: filename,
            mappings: previous.mappings ?? { players: {}, dubTeams: {} },
            records,
        };
    }

    async getOverview(params: {
        status?: string;
        search?: string;
        page?: number;
        limit?: number;
        reviewReason?: string;
        reviewCategory?: string;
        episodeQueue?: string;
        reviewBlocks?: string;
    }) {
        const state = await this.loadState();
        return this.getOverviewFromState(state, params);
    }

    async getRecord(key: string) {
        const state = await this.loadState();
        const record = this.requireRecord(state, key);
        return this.toRecordDetail(record, state);
    }

    async processPending(limit = 5) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            await this.autoMapKnownLabels(state);
            for (const item of state.records) this.recalculateRecord(item, state.mappings);
            const jobs = state.records
                .filter((record) => this.needsMetadataProcessing(record))
                .slice(0, Math.max(1, Math.min(limit, 20)));

            await this.mapLimit(jobs, 1, async (record) => {
                try {
                    await this.resolveRecordMetadata(record, {});
                    record.resolverVersion = this.resolverVersion;
                    if (record.status !== 'UNRESOLVED') record.lastError = null;
                } catch (error) {
                    record.status = 'FAILED';
                    record.resolverVersion = this.resolverVersion;
                    record.lastError = this.errorText(error);
                    record.issues = [
                        `Помилка автоматичного отримання метаданих: ${record.lastError}`,
                    ];
                }
                record.updatedAt = new Date().toISOString();
                this.recalculateRecord(record, state.mappings);
            });

            state.updatedAt = new Date().toISOString();
            await this.saveState(state);
            return this.getOverviewFromState(state, {});
        });
    }

    async resolveManual(
        key: string,
        refs: { hikka?: string; mal?: string; al?: string },
    ) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            const record = this.requireRecord(state, key);
            await this.resolveRecordMetadata(record, refs);
            record.resolverVersion = this.resolverVersion;
            record.updatedAt = new Date().toISOString();
            record.lastError = null;
            this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.toRecordDetail(record, state);
        });
    }

    async updateMetadata(
        key: string,
        input: { description?: string | null },
    ) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            const record = this.requireRecord(state, key);
            if (!record.metadata) {
                throw new BadRequestException('Спочатку потрібно отримати метадані аніме.');
            }

            if (Object.prototype.hasOwnProperty.call(input, 'description')) {
                const description = this.cleanDescription(input.description);
                record.metadata.description = description;
                record.metadata.descriptionLanguage = description ? 'uk' : null;
            }

            record.updatedAt = new Date().toISOString();
            this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.toRecordDetail(record, state);
        });
    }

    async setMapping(kind: 'player' | 'dubTeam', label: string, id: number | null) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            const normalized = this.cleanText(label);
            if (!normalized) throw new BadRequestException('Порожня назва відповідності.');

            if (id !== null) {
                const exists =
                    kind === 'player'
                        ? await this.prisma.player.findUnique({ where: { id }, select: { id: true } })
                        : await this.prisma.dubTeam.findUnique({ where: { id }, select: { id: true } });
                if (!exists) throw new BadRequestException('Обрана сутність більше не існує.');
            }

            const target = kind === 'player' ? state.mappings.players : state.mappings.dubTeams;
            if (id === null) delete target[normalized];
            else target[normalized] = id;

            for (const record of state.records) this.recalculateRecord(record, state.mappings);
            state.updatedAt = new Date().toISOString();
            await this.saveState(state);
            return this.getEpisodeMappings(state);
        });
    }

    async applyEpisodeRule(
        key: string,
        input: {
            match?: string;
            dubType: DubType;
            playerId: number;
            dubTeamId: number;
            startEpisode: number;
        },
    ) {
        return this.withMutationLock(async () => {
        const state = await this.loadState();
        const record = this.requireRecord(state, key);
        if (!record.manualReview) {
            throw new BadRequestException('Для цього аніме немає manual-review даних.');
        }
        const [player, dubTeam] = await Promise.all([
            this.prisma.player.findUnique({ where: { id: input.playerId }, select: { id: true, title: true } }),
            this.prisma.dubTeam.findUnique({ where: { id: input.dubTeamId }, select: { id: true, title: true } }),
        ]);
        if (!player || !dubTeam) {
            throw new BadRequestException('Плеєр або команда озвучення не існує.');
        }

        const handled = new Set(record.manualHandledVideoIds ?? []);
        const needle = this.normalizeSearch(input.match ?? '');
        const videos = this.manualVideos(record)
            .filter((video) => !handled.has(this.videoKey(video)))
            .filter((video) => !needle || this.normalizeSearch(this.videoSearchText(video)).includes(needle));
        if (!videos.length) {
            throw new BadRequestException('Немає нерозмічених відео, що відповідають фільтру.');
        }

        const start = Math.max(1, Number(input.startEpisode) || 1);
        const additions = videos.map<ParserEpisode>((video, index) => ({
            source: 'manual',
            episode: start + index,
            type: input.dubType,
            link: String(video.file ?? '').trim(),
            player: player.title,
            dubteam: dubTeam.title,
            playerId: player.id,
            dubTeamId: dubTeam.id,
        })).filter((episode) => Boolean(episode.link));

        record.parserEpisodes = this.mergeParserEpisodes(record.parserEpisodes, additions);
        for (const video of videos) handled.add(this.videoKey(video));
        record.manualHandledVideoIds = [...handled];
        record.updatedAt = new Date().toISOString();
        this.recalculateRecord(record, state.mappings);
        await this.saveState(state);
        return this.toRecordDetail(record, state);
        });
    }

    async resolveEpisodeReview(
        key: string,
        input: EpisodeReviewResolutionInput,
    ) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            const record = this.requireRecord(state, key);
            if (!record.manualReview) {
                throw new BadRequestException('Для цього аніме немає manual-review даних.');
            }

            const allVideos = this.manualVideos(record);
            if (!allVideos.length) {
                throw new BadRequestException('У review-записі немає ASHDI-відео для автоматичної розмітки.');
            }

            const blocks = Array.isArray(record.manualReview?.blocks)
                ? record.manualReview.blocks.filter((block: any) => Number.isFinite(Number(block?.index)))
                : [];
            const effectiveRoles = this.effectiveReviewBlockRoles(blocks, input.blockRoles ?? {});
            const typeBlocks = blocks.filter((block: any) => effectiveRoles[String(block.index)] === 'type');
            const teamBlocks = blocks.filter((block: any) => effectiveRoles[String(block.index)] === 'team');
            const rangeBlocks = blocks.filter((block: any) => effectiveRoles[String(block.index)] === 'range');

            if (typeBlocks.length > 1) {
                throw new BadRequestException('Оберіть лише один блок, який відповідає за тип перекладу.');
            }
            if (teamBlocks.length > 1) {
                throw new BadRequestException('Оберіть лише один блок, який відповідає за команду озвучення.');
            }

            const typeBlock = typeBlocks[0] ?? null;
            const teamBlock = teamBlocks[0] ?? null;
            const fallbackType = this.normalizeDubType(input.fallbackType);
            const fallbackTeam = teamBlock
                ? null
                : await this.resolveDubTeamReference(input.fallbackTeamId, input.fallbackTeamTitle);
            if (!typeBlock && !fallbackType) {
                throw new BadRequestException('Не визначено тип: оберіть блок типу або загальний DUB/SUB.');
            }
            if (!teamBlock && !fallbackTeam) {
                throw new BadRequestException('Не визначено команду: оберіть блок команд або вкажіть команду вручну.');
            }

            const player = await this.ensurePlayerByTitle('Ashdi');
            const handled = new Set(record.manualHandledVideoIds ?? []);
            const excluded = new Set((input.excludedVideoKeys ?? []).map((value) => String(value)));
            const teamCache = new Map<string, { id: number; title: string }>();
            const candidates: Array<ParserEpisode & { videoKey: string; videoLabel: string }> = [];
            const unresolved: Array<{ videoKey: string; label: string; reason: string }> = [];

            for (const video of allVideos) {
                const videoKey = this.videoKey(video);
                if (handled.has(videoKey)) continue;
                if (excluded.has(videoKey)) {
                    handled.add(videoKey);
                    continue;
                }

                const unmatchedRangeBlock = rangeBlocks.find((block: any) => !this.findVideoBlockOption(video, block));
                if (unmatchedRangeBlock) {
                    unresolved.push({ videoKey, label: String(video.label ?? ''), reason: `відео не належить жодному діапазону блока #${unmatchedRangeBlock.index + 1}` });
                    continue;
                }

                let dubType = fallbackType;
                if (typeBlock) {
                    const option = this.findVideoBlockOption(video, typeBlock);
                    if (!option) {
                        unresolved.push({ videoKey, label: String(video.label ?? ''), reason: `відео не належить жодній опції блока #${typeBlock.index + 1}` });
                        continue;
                    }
                    const overrideKey = this.reviewOptionKey(typeBlock.index, option.id);
                    dubType = this.normalizeDubType(
                        input.typeOverrides?.[overrideKey] ??
                            input.typeOverrides?.[String(option.id)] ??
                            this.classifyReviewTypeLabel(option.label),
                    );
                    if (!dubType) {
                        unresolved.push({ videoKey, label: String(video.label ?? ''), reason: `невідомий тип «${option.label}»` });
                        continue;
                    }
                }

                let team = fallbackTeam;
                if (teamBlock) {
                    const option = this.findVideoBlockOption(video, teamBlock);
                    if (!option) {
                        unresolved.push({ videoKey, label: String(video.label ?? ''), reason: `відео не належить жодній опції блока команд #${teamBlock.index + 1}` });
                        continue;
                    }
                    const overrideKey = this.reviewOptionKey(teamBlock.index, option.id);
                    const override = input.teamOverrides?.[overrideKey] ?? input.teamOverrides?.[String(option.id)] ?? null;
                    const cacheKey = `${override?.id ?? ''}:${this.normalizeSearch(override?.title ?? option.label ?? '')}`;
                    team = teamCache.get(cacheKey) ?? null;
                    if (!team) {
                        team = await this.resolveDubTeamReference(override?.id, override?.title ?? option.label);
                        if (team) teamCache.set(cacheKey, team);
                    }
                    if (!team) {
                        unresolved.push({ videoKey, label: String(video.label ?? ''), reason: `не визначено команду для «${option.label}»` });
                        continue;
                    }
                }

                const overriddenEpisode = this.asPositiveInt(input.episodeOverrides?.[videoKey]);
                const episode = overriddenEpisode ?? this.extractManualEpisodeNumber(video.label);
                if (!episode) {
                    unresolved.push({ videoKey, label: String(video.label ?? ''), reason: 'не вдалося визначити номер серії' });
                    continue;
                }

                candidates.push({
                    source: 'manual',
                    episode,
                    type: dubType === DubType.SUB ? 'SUB' : 'DUB',
                    link: String(video.file ?? '').trim(),
                    player: player.title,
                    playerId: player.id,
                    dubteam: team!.title,
                    dubTeamId: team!.id,
                    videoKey,
                    videoLabel: String(video.label ?? ''),
                });
            }

            if (unresolved.length) {
                const examples = unresolved
                    .slice(0, 3)
                    .map((item) => `${item.label || item.videoKey}: ${item.reason}`)
                    .join(' · ');
                throw new BadRequestException({
                    message: `Не всі ASHDI-відео можна розмітити з поточними налаштуваннями (${unresolved.length}).${examples ? ` ${examples}` : ''}`,
                    code: 'EPISODE_REVIEW_INCOMPLETE',
                    unresolved: unresolved.slice(0, 100),
                });
            }

            const duplicateMap = new Map<string, typeof candidates>();
            for (const item of candidates) {
                const duplicateKey = `${item.episode}:${item.type}:${item.dubTeamId ?? item.dubteam ?? ''}`;
                const group = duplicateMap.get(duplicateKey) ?? [];
                group.push(item);
                duplicateMap.set(duplicateKey, group);
            }
            const duplicates = [...duplicateMap.values()]
                .filter((group) => group.length > 1)
                .map((group) => ({
                    episode: group[0].episode,
                    type: group[0].type,
                    dubteam: group[0].dubteam,
                    videos: group.map((item) => ({ key: item.videoKey, label: item.videoLabel, link: item.link })),
                }));
            if (duplicates.length) {
                throw new BadRequestException({
                    message: 'Знайдено дублікати одного номера серії для однакової команди/типу. Залиште один варіант, решту позначте як виключені.',
                    code: 'EPISODE_DUPLICATES',
                    duplicates,
                });
            }

            const additions: ParserEpisode[] = candidates.map(({ videoKey: _videoKey, videoLabel: _videoLabel, ...episode }) => episode);
            record.parserEpisodes = this.mergeParserEpisodes(record.parserEpisodes, additions);
            for (const item of candidates) handled.add(item.videoKey);
            for (const keyToExclude of excluded) handled.add(keyToExclude);
            record.manualHandledVideoIds = [...handled];
            record.episodeReviewDone = this.remainingManualVideos(record) === 0;
            record.updatedAt = new Date().toISOString();
            await this.autoMapKnownLabels(state);
            this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.toRecordDetail(record, state);
        });
    }

    async addManualEpisodes(
        key: string,
        input: {
            dubType: DubType;
            playerId?: number | null;
            playerTitle?: string | null;
            dubTeamId?: number | null;
            dubTeamTitle?: string | null;
            episodes: ManualEpisodeInput[];
            markReviewDone?: boolean;
        },
    ) {
        return this.withMutationLock(async () => {
            const state = await this.loadState();
            const record = this.requireRecord(state, key);
            const player = input.playerId
                ? await this.resolvePlayerReference(input.playerId, input.playerTitle)
                : await this.ensurePlayerByTitle(input.playerTitle || 'Ashdi');
            const team = await this.resolveDubTeamReference(input.dubTeamId, input.dubTeamTitle);
            const dubType = this.normalizeDubType(input.dubType);
            if (!player || !team || !dubType) {
                throw new BadRequestException('Для ручного додавання потрібні плеєр, команда та тип DUB/SUB.');
            }
            const episodes = Array.isArray(input.episodes) ? input.episodes : [];
            const additions: ParserEpisode[] = episodes
                .map((item) => ({
                    source: 'manual' as const,
                    episode: Math.max(1, Number(item?.episode) || 0),
                    type: dubType === DubType.SUB ? 'SUB' as const : 'DUB' as const,
                    link: String(item?.link ?? '').trim(),
                    player: player.title,
                    playerId: player.id,
                    dubteam: team.title,
                    dubTeamId: team.id,
                }))
                .filter((item) => item.episode > 0 && Boolean(item.link));
            if (!additions.length) throw new BadRequestException('Не додано жодної валідної серії.');

            record.parserEpisodes = this.mergeParserEpisodes(record.parserEpisodes, additions);
            if (input.markReviewDone) record.episodeReviewDone = true;
            record.updatedAt = new Date().toISOString();
            await this.autoMapKnownLabels(state);
            this.recalculateRecord(record, state.mappings);
            await this.saveState(state);
            return this.toRecordDetail(record, state);
        });
    }

    async importRecord(key: string) {
        return this.withMutationLock(async () => {
        const state = await this.loadState();
        await this.autoMapKnownLabels(state);
        for (const item of state.records) this.recalculateRecord(item, state.mappings);
        const record = this.requireRecord(state, key);
        if (!record.metadata) {
            throw new BadRequestException('Спочатку потрібно отримати метадані аніме.');
        }

        try {
            const result = await this.upsertAnime(record, state);
            record.animeId = result.animeId;
            record.importedAsDraft = result.draft;
            record.status = 'IMPORTED';
            record.lastError = null;
            record.updatedAt = new Date().toISOString();
        } catch (error) {
            record.status = 'FAILED';
            record.lastError = this.errorText(error);
            record.updatedAt = new Date().toISOString();
            await this.saveState(state);
            throw error;
        }

        await this.saveState(state);
        return this.toRecordDetail(record, state);
        });
    }

    async importReady(limit = 5) {
        return this.withMutationLock(async () => {
        const state = await this.loadState();
        await this.autoMapKnownLabels(state);
        for (const item of state.records) this.recalculateRecord(item, state.mappings);
        const jobs = state.records
            .filter((record) => record.status === 'READY')
            .slice(0, Math.max(1, Math.min(limit, 20)));
        const results: Array<{ key: string; ok: boolean; error?: string }> = [];

        for (const record of jobs) {
            try {
                const result = await this.upsertAnime(record, state);
                record.animeId = result.animeId;
                record.importedAsDraft = result.draft;
                record.status = 'IMPORTED';
                record.lastError = null;
                results.push({ key: record.key, ok: true });
            } catch (error) {
                record.status = 'FAILED';
                record.lastError = this.errorText(error);
                results.push({ key: record.key, ok: false, error: record.lastError });
            }
            record.updatedAt = new Date().toISOString();
        }

        if (jobs.length) await this.saveState(state);
        return { results, overview: this.getOverviewFromState(state, {}) };
        });
    }

    private async resolveRecordMetadata(
        record: ImportRecord,
        refs: { hikka?: string; mal?: string; al?: string },
    ) {
        let hikka: any = null;
        let hikkaFull: any = null;
        let jikan: any = null;
        let anilist: any = null;
        let malId = this.parseNumericRef(refs.mal);
        let anilistId = this.parseNumericRef(refs.al);
        let method = '';
        const automatic = !refs.hikka && !refs.mal && !refs.al;
        const lookupWarnings: string[] = [];

        const explicitHikka = this.parseHikkaSlug(refs.hikka);
        if (explicitHikka) {
            hikkaFull = await this.hikkaBySlug(explicitHikka);
            hikka = hikkaFull;
            method = 'manual-hikka';
        }

        if (!hikka && malId && refs.mal) {
            hikka = await this.hikkaByMal(malId);
            hikkaFull = hikka;
            method = hikka ? 'manual-mal+hikka' : 'manual-mal';
        }

        if (!hikka && anilistId && refs.al) {
            anilist = await this.anilistById(anilistId);
            malId = malId ?? this.asPositiveInt(anilist?.idMal);
            method = 'manual-anilist';
        }

        if (automatic) {
            // The AniTube integration is only a fast/precise first attempt.
            // It is not allowed to abort the record: the endpoint is noticeably
            // less stable than Hikka's normal title search and may return 504.
            try {
                hikka = await this.hikkaByAniTube(record.anitubeId);
                if (hikka) {
                    hikkaFull = hikka;
                    method = 'anitube-id';
                }
            } catch (error) {
                lookupWarnings.push(this.errorText(error));
            }

            // Keep this request intentionally identical to the tiny standalone
            // script that is known to work reliably:
            // POST /anime with ONLY { query: originalTitle } in JSON body.
            if (!hikka && record.originalTitle) {
                try {
                    hikka = await this.hikkaSearch(record.originalTitle);
                    if (hikka) {
                        hikkaFull = hikka;
                        method = 'original-title-search';
                    }
                } catch (error) {
                    lookupWarnings.push(this.errorText(error));
                }
            }
        }

        const h = hikkaFull ?? hikka ?? {};
        malId =
            malId ??
            this.asPositiveInt(h?.mal_id) ??
            this.asPositiveInt(h?.malId);
        anilistId =
            anilistId ??
            this.asPositiveInt(h?.anilist_id) ??
            this.asPositiveInt(h?.anilistId) ??
            this.asPositiveInt(h?.al_id);

        // Do NOT hit MAL + AniList for every Hikka result. That was the main
        // source of 429s in v3. Enrich only when fields required by the anime
        // entity are actually missing.
        if (hikka && this.needsCriticalEnrichment(h, null, null)) {
            if (malId) {
                try {
                    jikan = await this.jikanByMal(malId);
                } catch (error) {
                    lookupWarnings.push(this.errorText(error));
                }
            }

            if (this.needsCriticalEnrichment(h, jikan, null) && malId) {
                try {
                    anilist = await this.anilistByMal(malId);
                } catch (error) {
                    lookupWarnings.push(this.errorText(error));
                }
            }
        }

        // If Hikka itself did not identify the title, use the other catalogues
        // as a fallback. These calls are provider-throttled and are never run in
        // parallel with another record.
        if (!hikka && record.originalTitle && !jikan && !anilist) {
            try {
                jikan = await this.jikanSearch(record.originalTitle);
            } catch (error) {
                lookupWarnings.push(this.errorText(error));
            }

            malId = malId ?? this.asPositiveInt(jikan?.mal_id);
            if (malId) {
                try {
                    const hikkaFromMal = await this.hikkaByMalSoft(malId);
                    if (hikkaFromMal) {
                        hikka = hikkaFromMal;
                        hikkaFull = hikkaFromMal;
                        method = 'original-title-jikan+hikka';
                    } else if (!method) {
                        method = 'original-title-jikan';
                    }
                } catch (error) {
                    lookupWarnings.push(this.errorText(error));
                }
            }
        }

        if (!hikka && record.originalTitle && !anilist) {
            try {
                anilist = malId
                    ? await this.anilistByMal(malId)
                    : await this.anilistSearch(record.originalTitle);
            } catch (error) {
                lookupWarnings.push(this.errorText(error));
            }

            malId = malId ?? this.asPositiveInt(anilist?.idMal);
            if (anilist && !method) method = 'original-title-anilist';

            if (malId && !hikka) {
                try {
                    const hikkaFromMal = await this.hikkaByMalSoft(malId);
                    if (hikkaFromMal) {
                        hikka = hikkaFromMal;
                        hikkaFull = hikkaFromMal;
                        method = 'original-title-anilist+hikka';
                    }
                } catch (error) {
                    lookupWarnings.push(this.errorText(error));
                }
            }
        }

        const finalHikka = hikkaFull ?? hikka ?? {};
        anilistId = anilistId ?? this.asPositiveInt(anilist?.id);

        if (!hikka && !jikan && !anilist) {
            record.metadata = null;
            record.resolution = {
                method: method || 'all-title-searches-empty',
                malId,
                anilistId,
            };
            record.status = 'UNRESOLVED';
            record.lastError = lookupWarnings.length ? lookupWarnings.join(' | ') : null;
            record.issues = [
                record.originalTitle
                    ? `Не знайдено за AniTube ID та назвою «${record.originalTitle}».`
                    : 'У записі немає originalTitle, а AniTube integration не знайшов аніме.',
            ];
            if (lookupWarnings.length) {
                record.issues.push(`Помилки зовнішніх API: ${lookupWarnings.slice(0, 2).join(' | ')}`);
            }
            return;
        }

        const titleUa = this.cleanText(finalHikka.title_ua);
        const titleEn =
            this.cleanText(finalHikka.title_en) ??
            this.cleanText(anilist?.title?.english) ??
            this.cleanText(jikan?.title_english);
        const titleFallback =
            titleUa ??
            record.parserTitle ??
            titleEn ??
            this.cleanText(anilist?.title?.romaji) ??
            this.cleanText(jikan?.title) ??
            record.originalTitle;

        const descriptionUa = this.cleanDescription(finalHikka.synopsis_ua);
        const descriptionEn =
            this.cleanDescription(finalHikka.synopsis_en) ??
            this.cleanDescription(anilist?.description) ??
            this.cleanDescription(jikan?.synopsis);

        const studios = this.hikkaStudios(finalHikka);
        const alStudios = Array.isArray(anilist?.studios?.nodes)
            ? anilist.studios.nodes.map((item: any) => this.cleanText(item?.name)).filter(Boolean)
            : [];
        const jikanStudios = Array.isArray(jikan?.studios)
            ? jikan.studios.map((item: any) => this.cleanText(item?.name)).filter(Boolean)
            : [];
        const producers = this.uniqueStrings([
            ...this.hikkaProducers(finalHikka),
            ...(Array.isArray(jikan?.producers)
                ? jikan.producers.map((item: any) => this.cleanText(item?.name)).filter(Boolean)
                : []),
        ]);

        const hikkaGenres = Array.isArray(finalHikka.genres)
            ? finalHikka.genres
                  .map(
                      (item: any) =>
                          this.cleanText(item?.name_ua) ??
                          this.cleanText(item?.name_en) ??
                          this.cleanText(item?.name),
                  )
                  .filter(Boolean)
            : [];
        const fallbackGenres = Array.isArray(anilist?.genres)
            ? anilist.genres.map((item: any) => this.cleanText(item)).filter(Boolean)
            : Array.isArray(jikan?.genres)
              ? jikan.genres.map((item: any) => this.cleanText(item?.name)).filter(Boolean)
              : [];

        const mediaType = finalHikka.media_type ?? anilist?.format ?? jikan?.type;
        const sourceStatus = finalHikka.status ?? anilist?.status ?? jikan?.status;
        const hikkaRating = this.mapRating(finalHikka.rating);
        const jikanRating = this.mapJikanRating(jikan?.rating);
        const startDate =
            this.timestampToIso(finalHikka.start_date) ??
            this.fuzzyDateToIso(anilist?.startDate) ??
            this.safeIso(jikan?.aired?.from);
        const endDate =
            this.timestampToIso(finalHikka.end_date) ??
            this.fuzzyDateToIso(anilist?.endDate) ??
            this.safeIso(jikan?.aired?.to);

        record.metadata = {
            title: titleFallback,
            originalTitle:
                record.originalTitle ??
                this.cleanText(anilist?.title?.romaji) ??
                this.cleanText(jikan?.title) ??
                null,
            engTitle: titleEn,
            poster:
                this.cleanText(finalHikka.image) ??
                this.cleanText(anilist?.coverImage?.extraLarge) ??
                this.cleanText(anilist?.coverImage?.large) ??
                this.cleanText(jikan?.images?.webp?.large_image_url) ??
                this.cleanText(jikan?.images?.jpg?.large_image_url) ??
                null,
            rating: hikkaRating ?? jikanRating,
            description: descriptionUa ?? descriptionEn,
            descriptionLanguage: descriptionUa ? 'uk' : descriptionEn ? 'en' : null,
            country:
                this.cleanText(finalHikka.country) ??
                this.countryName(anilist?.countryOfOrigin),
            genres: this.uniqueStrings(hikkaGenres.length ? hikkaGenres : fallbackGenres),
            producers,
            releaseDate: startDate,
            endDate,
            episodesTotal:
                this.asNonNegativeInt(finalHikka.episodes_total) ??
                this.asNonNegativeInt(anilist?.episodes) ??
                this.asNonNegativeInt(jikan?.episodes),
            duration:
                this.asNonNegativeInt(finalHikka.duration) ??
                this.asNonNegativeInt(anilist?.duration) ??
                this.parseDuration(jikan?.duration),
            type: this.mapType(mediaType),
            status: this.mapStatus(sourceStatus),
            studio: (studios[0] ?? alStudios[0] ?? jikanStudios[0] ?? null) as string | null,
            mal: malId ? `https://myanimelist.net/anime/${malId}` : null,
            al: anilistId ? `https://anilist.co/anime/${anilistId}` : null,
        };
        record.resolution = {
            method: method || (hikka ? 'hikka' : malId ? 'mal-fallback' : 'anilist-fallback'),
            hikkaSlug: this.cleanText(finalHikka.slug),
            malId,
            anilistId,
        };
        record.lastError = lookupWarnings.length ? lookupWarnings.join(' | ') : null;
        record.status = 'REVIEW';
    }

    private recalculateRecord(
        record: ImportRecord,
        mappings: ImportState['mappings'],
    ) {
        if (record.status === 'IMPORTED') return;
        if (!record.metadata) {
            if (record.status !== 'PENDING' && record.status !== 'FAILED') {
                record.status = 'UNRESOLVED';
            }
            return;
        }

        const issues: string[] = [];
        const warnings: string[] = [];
        const episodeIssues: string[] = [];
        const meta = record.metadata;

        if (!meta.title) issues.push('Не визначено назву.');
        if (!meta.originalTitle) issues.push('Відсутня оригінальна назва з AniTube.');
        if (!meta.poster) issues.push('Не знайдено постер.');
        if (!meta.description) {
            issues.push('Не знайдено опис.');
        } else {
            if (meta.descriptionLanguage === 'en') {
                warnings.push('Опис отримано англійською — відредагуйте або перекладіть його перед публікацією.');
            }
            if (/\[[^\]]*\]/u.test(meta.description)) {
                issues.push('В описі є текст у квадратних дужках — перевірте та відредагуйте опис.');
            }
            if (/(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|org|net|io|ua|ru|me|tv)\b)/iu.test(meta.description)) {
                issues.push('В описі знайдено посилання — перевірте та відредагуйте опис.');
            }
        }
        if (!meta.rating) issues.push('Не визначено віковий рейтинг.');
        if (!meta.type) issues.push('Не визначено тип аніме.');
        if (!meta.status) issues.push('Не визначено статус релізу.');
        if (!meta.mal && !meta.al) warnings.push('Немає посилань MAL/AniList.');

        const trustedMainEpisodes = record.parserEpisodes.filter((episode) => episode.source === 'main');
        const remainingManual = this.remainingManualVideos(record);

        // main.json is only one possible trusted source of episodes. If the parser put
        // the page into manual-review and the admin successfully reconstructed every
        // ASHDI variant, those manual/review variants are just as valid for publication.
        // Do not keep the anime in REVIEW merely because main.json was empty.
        if (!record.parserEpisodes.length) {
            issues.push('Не знайдено жодного варіанта серій.');
        } else if (!trustedMainEpisodes.length && remainingManual > 0 && !record.episodeReviewDone) {
            issues.push('Серій немає в main.json — завершіть review серій.');
        }

        const missingPlayers = new Set<string>();
        const missingTeams = new Set<string>();
        for (const episode of record.parserEpisodes) {
            if (!episode.playerId && episode.player && !mappings.players[episode.player]) {
                missingPlayers.add(episode.player);
            }
            if (!episode.dubTeamId && episode.dubteam && !mappings.dubTeams[episode.dubteam]) {
                missingTeams.add(episode.dubteam);
            }
            if (!episode.playerId && !episode.player) missingPlayers.add('(без назви)');
            if (!episode.dubTeamId && !episode.dubteam) missingTeams.add('(без назви)');
        }
        if (missingPlayers.size) episodeIssues.push(`Не зіставлено плеєри: ${[...missingPlayers].join(', ')}.`);
        if (missingTeams.size) episodeIssues.push(`Не зіставлено команди: ${[...missingTeams].join(', ')}.`);

        if (remainingManual > 0) {
            episodeIssues.push(`Залишилось вручну розмітити відео: ${remainingManual}.`);
        }

        const reviewProblems = Array.isArray(record.manualReview?.problems)
            ? record.manualReview.problems.map((value: any) =>
                  typeof value === 'string' ? value : JSON.stringify(value),
              )
            : [];
        for (const problem of reviewProblems) {
            if (problem) episodeIssues.push(`Парсер: ${problem}`);
        }

        record.issues = this.uniqueStrings(issues);
        record.warnings = this.uniqueStrings(warnings);
        record.episodeIssues = this.uniqueStrings(episodeIssues);

        // Episode review is intentionally independent from publication status.
        // If main.json contains trusted variants, unresolved extra videos from
        // manual-review/review-* do not force the anime into DRAFT.
        record.status = record.issues.length || record.warnings.length ? 'REVIEW' : 'READY';
    }

    private async upsertAnime(record: ImportRecord, state: ImportState) {
        const meta = record.metadata!;
        const existing = await this.findExistingAnime(meta);
        const shouldDraft = record.issues.length > 0 || record.warnings.length > 0;
        const desiredStatus = shouldDraft ? AnimeStatus.DRAFT : meta.status ?? AnimeStatus.DRAFT;

        const basePayload: any = {
            title: meta.title ?? record.parserTitle ?? record.originalTitle ?? `AniTube ${record.anitubeId}`,
            originalTitle: meta.originalTitle,
            engTitle: meta.engTitle,
            poster: meta.poster,
            rating: meta.rating,
            description: meta.description,
            country: meta.country,
            genres: meta.genres,
            producers: meta.producers,
            releaseDate: meta.releaseDate,
            endDate: meta.endDate,
            episodesTotal: meta.episodesTotal,
            duration: meta.duration,
            type: meta.type ?? AnimeType.TV,
            status: desiredStatus,
            studio: meta.studio,
            mal: meta.mal,
            al: meta.al,
        };

        let animeId: number;
        if (!existing) {
            try {
                const created = await this.animeService.create(basePayload);
                animeId = created.id;
            } catch (error) {
                if (!meta.poster) throw error;
                record.issues = this.uniqueStrings([...record.issues, 'Не вдалося завантажити постер — створено без нього.']);
                record.status = 'REVIEW';
                const created = await this.animeService.create({ ...basePayload, poster: null, status: AnimeStatus.DRAFT });
                animeId = created.id;
            }
        } else {
            animeId = existing.id;
            const update: any = {};
            const fill = (key: string, existingValue: unknown, nextValue: unknown) => {
                if ((existingValue === null || existingValue === undefined || existingValue === '') && nextValue !== null && nextValue !== undefined && nextValue !== '') {
                    update[key] = nextValue;
                }
            };
            fill('title', existing.title, basePayload.title);
            fill('originalTitle', existing.originalTitle, basePayload.originalTitle);
            fill('engTitle', existing.engTitle, basePayload.engTitle);
            fill('rating', existing.rating, basePayload.rating);
            fill('description', existing.description, basePayload.description);
            fill('country', existing.country, basePayload.country);
            fill('releaseDate', existing.releaseDate, basePayload.releaseDate);
            fill('endDate', existing.endDate, basePayload.endDate);
            fill('episodesTotal', existing.episodesTotal, basePayload.episodesTotal);
            fill('duration', existing.duration, basePayload.duration);
            fill('studio', existing.studio, basePayload.studio);
            fill('mal', existing.mal, basePayload.mal);
            fill('al', existing.al, basePayload.al);
            if (!existing.posterId && basePayload.poster) update.poster = basePayload.poster;
            if (!existing.genres.length && basePayload.genres.length) update.genres = basePayload.genres;
            if (!existing.producers.length && basePayload.producers.length) update.producers = basePayload.producers;
            if (existing.status === AnimeStatus.DRAFT && !shouldDraft && meta.status) update.status = meta.status;
            if (Object.keys(update).length) {
                try {
                    await this.animeService.update(animeId, update);
                } catch (error) {
                    if (update.poster) {
                        delete update.poster;
                        record.issues = this.uniqueStrings([...record.issues, 'Не вдалося завантажити постер.']);
                        await this.animeService.update(animeId, update);
                    } else throw error;
                }
            }
        }

        await this.mergeEpisodes(animeId, record, state.mappings);
        const finalDraft = shouldDraft || record.issues.length > 0 || record.warnings.length > 0;
        if (finalDraft) {
            const current = await this.prisma.anime.findUnique({ where: { id: animeId }, select: { status: true } });
            if (!existing && current?.status !== AnimeStatus.DRAFT) {
                await this.prisma.anime.update({ where: { id: animeId }, data: { status: AnimeStatus.DRAFT } });
            }
        }
        return { animeId, draft: finalDraft || existing?.status === AnimeStatus.DRAFT };
    }

    private async findExistingAnime(meta: ImportMetadata) {
        const or: any[] = [];
        if (meta.mal) or.push({ mal: meta.mal });
        if (meta.al) or.push({ al: meta.al });
        if (meta.originalTitle) or.push({ originalTitle: { equals: meta.originalTitle, mode: 'insensitive' } });
        if (!or.length) return null;
        return this.prisma.anime.findFirst({
            where: { OR: or },
            select: {
                id: true,
                title: true,
                originalTitle: true,
                engTitle: true,
                posterId: true,
                rating: true,
                description: true,
                country: true,
                releaseDate: true,
                endDate: true,
                episodesTotal: true,
                duration: true,
                type: true,
                status: true,
                studio: true,
                mal: true,
                al: true,
                genres: { select: { id: true } },
                producers: { select: { id: true } },
            },
        });
    }

    private async mergeEpisodes(
        animeId: number,
        record: ImportRecord,
        mappings: ImportState['mappings'],
    ) {
        const unresolved: string[] = [];
        const episodes = [...record.parserEpisodes].sort((a, b) => a.episode - b.episode);
        for (const item of episodes) {
            const playerId = item.playerId ?? (item.player ? mappings.players[item.player] : undefined);
            const dubTeamId = item.dubTeamId ?? (item.dubteam ? mappings.dubTeams[item.dubteam] : undefined);
            if (!playerId || !dubTeamId || !item.link) {
                unresolved.push(`Серія ${item.episode}: немає плеєра/команди/посилання.`);
                continue;
            }
            const episode = await this.prisma.episode.upsert({
                where: { animeId_number: { animeId, number: item.episode } },
                create: { animeId, number: item.episode },
                update: {},
                select: { id: true },
            });
            const dubType = item.type === 'SUB' ? DubType.SUB : DubType.DUB;
            const existingVariant = await this.prisma.episodeVariant.findFirst({
                where: { episodeId: episode.id, dubType, dubTeamId, playerId },
                select: { id: true },
            });
            if (existingVariant) {
                await this.prisma.episodeVariant.update({
                    where: { id: existingVariant.id },
                    data: { endpoint: item.link, sourceType: EpisodeSourceType.IFRAME },
                });
            } else {
                await this.prisma.episodeVariant.create({
                    data: {
                        episodeId: episode.id,
                        sourceType: EpisodeSourceType.IFRAME,
                        endpoint: item.link,
                        dubType,
                        dubTeamId,
                        playerId,
                        isActive: false,
                    },
                });
            }
        }
        if (unresolved.length) {
            record.issues = this.uniqueStrings([...record.issues, ...unresolved.slice(0, 5)]);
        }
    }

    private async hikkaByAniTube(id: number) {
        let response: any;
        try {
            response = await this.http.get(
                `https://api.hikka.io/integrations/anitube/anime/${id}`,
                { timeout: 6_000 },
            );
        } catch (error) {
            throw new Error(`Hikka AniTube integration: ${this.errorText(error)}`);
        }

        const status = Number(response?.status ?? 0);
        if (status >= 200 && status < 300) return response?.data ?? null;
        if (status === 404) return null;

        // Crucial: this endpoint is only an optional shortcut. 429/5xx must not
        // prevent the resolver from reaching the reliable title search.
        throw new Error(
            `Hikka AniTube integration: HTTP ${status || 'unknown'}${this.apiResponseMessage(response?.data) ? ` — ${this.apiResponseMessage(response?.data)}` : ''}`,
        );
    }

    private async hikkaByMal(id: number) {
        const response = await this.http.get(
            `https://api.hikka.io/integrations/mal/anime/${id}`,
        );
        return this.optionalApiResult('Hikka MAL integration', response);
    }

    private async hikkaByMalSoft(id: number) {
        try {
            return await this.hikkaByMal(id);
        } catch {
            return null;
        }
    }

    private async hikkaBySlug(slug: string) {
        const response = await this.http.get(
            `https://api.hikka.io/anime/${encodeURIComponent(slug)}`,
        );
        return this.optionalApiResult('Hikka anime info', response);
    }

    private async hikkaSearch(query: string) {
        const cleanQuery = this.cleanText(query);
        if (!cleanQuery) return null;

        // Deliberately use the same native fetch shape as the standalone script
        // that was verified against Hikka by the user. No extra query params,
        // sort options, alternate candidates, concurrency or retry loop.
        const response = await fetch('https://api.hikka.io/anime', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: cleanQuery }),
        });

        let data: any = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (response.status === 404) return null;
        if (!response.ok) {
            const detail = this.apiResponseMessage(data);
            throw new Error(
                `Hikka title search: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
            );
        }

        const list = Array.isArray(data?.list) ? data.list : [];
        return list[0] ?? null;
    }

    private async jikanByMal(id: number) {
        await this.throttleProvider('jikan', 400);
        const response = await this.http.get(
            `https://api.jikan.moe/v4/anime/${id}/full`,
        );
        if (response.status === 404) return null;
        this.assertSuccessfulApiResponse('Jikan anime by MAL id', response);
        return response.data?.data ?? null;
    }

    private async jikanSearch(query: string) {
        const cleanQuery = this.cleanText(query);
        if (!cleanQuery) return null;
        await this.throttleProvider('jikan', 400);
        const response = await this.http.get('https://api.jikan.moe/v4/anime', {
            params: { q: cleanQuery, limit: 10 },
        });
        this.assertSuccessfulApiResponse('Jikan title search', response);
        const list = Array.isArray(response.data?.data) ? response.data.data : [];
        return list.length ? this.pickBestJikanSearchResult(cleanQuery, list) : null;
    }

    private async anilistByMal(malId: number) {
        return this.anilistQuery(
            `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id idMal title { romaji english native } description(asHtml: false) format status episodes duration countryOfOrigin startDate { year month day } endDate { year month day } genres studios(isMain: true) { nodes { name } } coverImage { extraLarge large } } }`,
            { idMal: malId },
        );
    }

    private async anilistById(id: number) {
        return this.anilistQuery(
            `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { romaji english native } description(asHtml: false) format status episodes duration countryOfOrigin startDate { year month day } endDate { year month day } genres studios(isMain: true) { nodes { name } } coverImage { extraLarge large } } }`,
            { id },
        );
    }

    private async anilistSearch(title: string) {
        const cleanTitle = this.cleanText(title);
        if (!cleanTitle) return null;
        return this.anilistQuery(
            `query ($search: String) { Media(search: $search, type: ANIME) { id idMal title { romaji english native } description(asHtml: false) format status episodes duration countryOfOrigin startDate { year month day } endDate { year month day } genres studios(isMain: true) { nodes { name } } coverImage { extraLarge large } } }`,
            { search: cleanTitle },
        );
    }

    private async anilistQuery(query: string, variables: Record<string, unknown>) {
        await this.throttleProvider('anilist', 750);
        const response = await this.http.post(
            'https://graphql.anilist.co',
            { query, variables },
            { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } },
        );
        if (response.status === 404) return null;
        this.assertSuccessfulApiResponse('AniList GraphQL', response);
        if (Array.isArray(response.data?.errors) && response.data.errors.length) {
            throw new Error(
                `AniList GraphQL: ${this.cleanText(response.data.errors[0]?.message) ?? 'unknown error'}`,
            );
        }
        return response.data?.data?.Media ?? null;
    }

    private optionalApiResult(name: string, response: any) {
        if (response?.status === 404) return null;
        this.assertSuccessfulApiResponse(name, response);
        return response?.data ?? null;
    }

    private assertSuccessfulApiResponse(name: string, response: any) {
        const status = Number(response?.status ?? 0);
        if (status >= 200 && status < 300) return;
        const detail = this.apiResponseMessage(response?.data);
        throw new Error(`${name}: HTTP ${status || 'unknown'}${detail ? ` — ${detail}` : ''}`);
    }

    private apiResponseMessage(data: any) {
        const direct = this.cleanText(data?.message ?? data?.detail ?? data?.error);
        if (direct) return direct;
        if (Array.isArray(data?.detail) && data.detail.length) {
            return this.cleanText(data.detail[0]?.msg ?? data.detail[0]?.message);
        }
        return null;
    }

    private titleSearchCandidates(value: string) {
        const original = this.cleanText(value);
        if (!original) return [];
        const withoutBrackets = this.cleanText(
            original
                .replace(/\s*[\[(][^\])]{1,80}[\])]\s*$/u, '')
                .replace(/\s+(?:season|part)\s*\d+\s*$/iu, ''),
        );
        return this.uniqueStrings([original, withoutBrackets]).slice(0, 2);
    }

    private pickBestJikanSearchResult(query: string, list: any[]) {
        const needle = this.normalizeSearch(query);
        const score = (item: any) => {
            const titles = [
                item?.title,
                item?.title_english,
                item?.title_japanese,
                ...(Array.isArray(item?.titles) ? item.titles.map((title: any) => title?.title) : []),
            ]
                .map((value) => this.normalizeSearch(value ?? ''))
                .filter(Boolean);
            let best = 0;
            for (const value of titles) {
                if (value === needle) best = Math.max(best, 100);
                else if (value.includes(needle) || needle.includes(value)) best = Math.max(best, 75);
                else {
                    const a = new Set(needle.split(' ').filter(Boolean));
                    const b = new Set(value.split(' ').filter(Boolean));
                    const common = [...a].filter((token) => b.has(token)).length;
                    const union = new Set([...a, ...b]).size || 1;
                    best = Math.max(best, Math.round((common / union) * 60));
                }
            }
            return best;
        };
        return [...list].sort((a, b) => score(b) - score(a))[0] ?? null;
    }

    private needsCriticalEnrichment(hikka: any, jikan: any, anilist: any) {
        const poster =
            this.cleanText(hikka?.image) ??
            this.cleanText(anilist?.coverImage?.extraLarge) ??
            this.cleanText(anilist?.coverImage?.large) ??
            this.cleanText(jikan?.images?.webp?.large_image_url) ??
            this.cleanText(jikan?.images?.jpg?.large_image_url);
        const description =
            this.cleanDescription(hikka?.synopsis_ua) ??
            this.cleanDescription(hikka?.synopsis_en) ??
            this.cleanDescription(anilist?.description) ??
            this.cleanDescription(jikan?.synopsis);
        const rating = this.mapRating(hikka?.rating) ?? this.mapJikanRating(jikan?.rating);
        const type = this.mapType(hikka?.media_type ?? anilist?.format ?? jikan?.type);
        const status = this.mapStatus(hikka?.status ?? anilist?.status ?? jikan?.status);
        return !poster || !description || !rating || !type || !status;
    }

    private hikkaProducers(hikka: any): string[] {
        if (!Array.isArray(hikka?.companies)) return [];
        return hikka.companies
            .filter((item: any) => {
                const type = String(item?.type ?? '').toLowerCase();
                return type.includes('producer') || type.includes('licensor');
            })
            .map((item: any) => this.cleanText(item?.company?.name ?? item?.name))
            .filter(Boolean) as string[];
    }

    private async throttleProvider(provider: string, minIntervalMs: number) {
        const previous = this.providerLastRequestAt.get(provider) ?? 0;
        const wait = minIntervalMs - (Date.now() - previous);
        if (wait > 0) await this.delay(wait);
        this.providerLastRequestAt.set(provider, Date.now());
    }

    private needsMetadataProcessing(record: ImportRecord) {
        if (record.status === 'PENDING') return true;
        if (record.metadata || record.status === 'IMPORTED') return false;
        if (!['UNRESOLVED', 'FAILED'].includes(record.status)) return false;
        return (record.resolverVersion ?? 0) < this.resolverVersion;
    }

    private reviewCategories(record: ImportRecord): string[] {
        const raw = Array.isArray(record.manualReview?.categories)
            ? record.manualReview.categories.map((value: unknown) => String(value)).filter(Boolean)
            : [];
        const categories = new Set<string>();
        const allowed = new Set([
            'ambiguous-blocks',
            'missing-team',
            'missing-metadata',
            'episode-or-type-label',
            'missing-type',
            'request-failure',
            'strange-layout',
            'unknown-player',
        ]);
        for (const category of raw) {
            if (allowed.has(category)) categories.add(category);
            // These are parser implementation details, not separate repair flows.
            // Legacy fallback is handled by the strange-layout editor; a playlist
            // error with no ASHDI data is effectively a request failure.
            else if (category === 'legacy-layout') categories.add('strange-layout');
            else if (category === 'playlist-error' && this.manualVideos(record).length === 0) categories.add('request-failure');
        }
        return [...categories];
    }

    private reviewReasonCodes(record: ImportRecord): string[] {
        const reasons = new Set<string>();
        const texts = [...(record.issues ?? []), ...(record.warnings ?? [])];
        if (record.lastError) texts.push(record.lastError);
        for (const textValue of texts) {
            const text = String(textValue ?? '').toLowerCase();
            if (!text) continue;
            if (text.includes('англій') && text.includes('опис')) reasons.add('description-en');
            else if (text.includes('опис')) reasons.add('description');
            if (text.includes('постер')) reasons.add('poster');
            if (text.includes('рейтинг')) reasons.add('rating');
            if (text.includes('тип аніме')) reasons.add('type');
            if (text.includes('статус')) reasons.add('status');
            if (text.includes('mal/anilist') || text.includes('mal') || text.includes('anilist')) reasons.add('external-links');
            if (text.includes('оригінальн') && text.includes('назв')) reasons.add('original-title');
            else if (text.includes('назв')) reasons.add('title');
            if (text.includes('main.json')) reasons.add('main-episodes');
            if (/http\s*\d{3}|hikka|jikan|anilist|timeout|econn|fetch/i.test(textValue)) reasons.add('provider-error');
        }
        if ((record.status === 'REVIEW' || record.status === 'FAILED') && !reasons.size) reasons.add('other');
        return [...reasons];
    }

    private getImportFacets(state: ImportState) {
        const reviewReasonCounts = new Map<string, number>();
        const categoryCounts = new Map<string, { workable: number; noAshdi: number; done: number }>();
        const blockCountCounts = new Map<string, { workable: number; noAshdi: number; done: number }>();
        let workable = 0;
        let noAshdi = 0;
        let episodeDone = 0;

        for (const record of state.records) {
            if (record.status === 'REVIEW' || record.status === 'FAILED') {
                for (const reason of this.reviewReasonCodes(record)) {
                    reviewReasonCounts.set(reason, (reviewReasonCounts.get(reason) ?? 0) + 1);
                }
            }
            if (!record.manualReview) continue;
            const ashdiCount = this.manualVideos(record).length;
            const isDone = Boolean(record.episodeReviewDone) || this.remainingManualVideos(record) <= 0;
            const bucket = ashdiCount === 0 ? 'noAshdi' : isDone ? 'done' : 'workable';
            if (bucket === 'noAshdi') noAshdi += 1;
            else if (bucket === 'done') episodeDone += 1;
            else workable += 1;
            for (const category of this.reviewCategories(record)) {
                const current = categoryCounts.get(category) ?? { workable: 0, noAshdi: 0, done: 0 };
                current[bucket] += 1;
                categoryCounts.set(category, current);
            }
            const blockCount = Array.isArray(record.manualReview.blocks) ? record.manualReview.blocks.length : 0;
            const blockCountKey = blockCount >= 3 ? '3plus' : String(blockCount);
            const blockCurrent = blockCountCounts.get(blockCountKey) ?? { workable: 0, noAshdi: 0, done: 0 };
            blockCurrent[bucket] += 1;
            blockCountCounts.set(blockCountKey, blockCurrent);
        }

        return {
            reviewReasons: [...reviewReasonCounts.entries()]
                .map(([code, count]) => ({ code, count }))
                .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
            episodeCategories: [...categoryCounts.entries()]
                .map(([category, counts]) => ({
                    category,
                    count: counts.workable + counts.noAshdi + counts.done,
                    workable: counts.workable,
                    noAshdi: counts.noAshdi,
                    done: counts.done,
                }))
                .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
            episodeBlockCounts: ['3plus', '2', '1', '0'].map((blockCount) => {
                const counts = blockCountCounts.get(blockCount) ?? { workable: 0, noAshdi: 0, done: 0 };
                return {
                    blockCount,
                    count: counts.workable + counts.noAshdi + counts.done,
                    workable: counts.workable,
                    noAshdi: counts.noAshdi,
                    done: counts.done,
                };
            }),
            episodeReview: { workable, noAshdi, done: episodeDone },
        };
    }

    private getOverviewFromState(
        state: ImportState,
        params: {
            status?: string;
            search?: string;
            page?: number;
            limit?: number;
            reviewReason?: string;
            reviewCategory?: string;
            episodeQueue?: string;
            reviewBlocks?: string;
        },
    ) {
        const status = params.status?.toUpperCase();
        const statuses = status && status !== 'ALL' && status !== 'EPISODES'
            ? new Set(status.split(',').map((item) => item.trim()).filter(Boolean))
            : null;
        const needle = this.normalizeSearch(params.search ?? '');
        const reviewReason = String(params.reviewReason ?? '').trim();
        const reviewCategory = String(params.reviewCategory ?? '').trim();
        const episodeQueue = String(params.episodeQueue ?? 'workable').trim().toLowerCase();
        const reviewBlocks = String(params.reviewBlocks ?? '').trim().toLowerCase();

        let records = state.records.filter((record) => {
            if (statuses && !statuses.has(record.status)) return false;
            if (reviewReason && !this.reviewReasonCodes(record).includes(reviewReason)) return false;
            if (status === 'EPISODES') {
                if (!record.manualReview) return false;
                const categories = this.reviewCategories(record);
                if (reviewCategory && !categories.includes(reviewCategory)) return false;
                const blockCount = Array.isArray(record.manualReview.blocks) ? record.manualReview.blocks.length : 0;
                if (reviewBlocks === '3plus' && blockCount < 3) return false;
                if (/^[0-2]$/.test(reviewBlocks) && blockCount !== Number(reviewBlocks)) return false;
                const ashdiCount = this.manualVideos(record).length;
                if (episodeQueue === 'no-ashdi') {
                    if (ashdiCount > 0) return false;
                } else {
                    if (ashdiCount <= 0 || record.episodeReviewDone || this.remainingManualVideos(record) <= 0) return false;
                }
            }
            if (!needle) return true;
            return this.normalizeSearch(
                `${record.metadata?.title ?? ''} ${record.parserTitle ?? ''} ${record.originalTitle ?? ''} ${record.link}`,
            ).includes(needle);
        });
        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.max(1, Math.min(Number(params.limit) || 50, 200));
        const total = records.length;
        records = records.slice((page - 1) * limit, page * limit);
        const counts = this.countStatuses(state.records);
        return {
            importerVersion: this.importerVersion,
            resolverVersion: this.resolverVersion,
            uploadedAt: state.uploadedAt,
            updatedAt: state.updatedAt,
            sourceFilename: state.sourceFilename,
            counts,
            progress: {
                metadataDone: state.records.filter((record) => !this.needsMetadataProcessing(record)).length,
                metadataTotal: state.records.length,
                pending: state.records.filter((record) => this.needsMetadataProcessing(record)).length,
            },
            mappings: this.getEpisodeMappings(state),
            facets: this.getImportFacets(state),
            records: records.map((record) => this.toRecordSummary(record, state)),
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    private toRecordSummary(record: ImportRecord, state: ImportState) {
        return {
            key: record.key,
            anitubeId: record.anitubeId,
            link: record.link,
            title: record.metadata?.title ?? record.parserTitle ?? record.originalTitle ?? `AniTube ${record.anitubeId}`,
            originalTitle: record.originalTitle,
            poster: record.metadata?.poster ?? null,
            status: record.status,
            issues: record.issues,
            warnings: record.warnings,
            episodeIssues: record.episodeIssues ?? [],
            reviewReasons: this.reviewReasonCodes(record),
            resolution: record.resolution,
            animeId: record.animeId ?? null,
            importedAsDraft: Boolean(record.importedAsDraft),
            episodes: {
                variants: record.parserEpisodes.length,
                numbers: new Set(record.parserEpisodes.map((item) => item.episode)).size,
                trustedVariants: record.parserEpisodes.filter((item) => item.source === 'main').length,
                reviewResolvedVariants: record.parserEpisodes.filter((item) => item.source === 'review').length,
                manualVariants: record.parserEpisodes.filter((item) => item.source === 'manual').length,
                manualRemaining: this.remainingManualVideos(record),
                reviewCategories: this.reviewCategories(record),
                reviewProblems: Array.isArray(record.manualReview?.problems) ? record.manualReview.problems : [],
                ashdiVideos: this.manualVideos(record).length,
                reviewDone: Boolean(record.episodeReviewDone),
            },
            lastError: record.lastError ?? null,
            canImport: Boolean(record.metadata),
            mapped: this.recordMappingStats(record, state.mappings),
        };
    }

    private toRecordDetail(record: ImportRecord, state: ImportState) {
        return {
            ...this.toRecordSummary(record, state),
            parserTitle: record.parserTitle,
            metadata: record.metadata,
            parserEpisodes: record.parserEpisodes,
            manualReview: record.manualReview
                ? {
                      source: record.manualReview.source ?? null,
                      playlistError: record.manualReview.playlistError ?? null,
                      categories: this.reviewCategories(record),
                      problems: record.manualReview.problems ?? [],
                      ambiguity: record.manualReview.ambiguity ?? [],
                      teamHints: record.manualReview.teamHints ?? [],
                      blocks: record.manualReview.blocks ?? [],
                      ashdiVideoCount: this.manualVideos(record).length,
                      reviewDone: Boolean(record.episodeReviewDone),
                      // Detail view must receive the complete unresolved review set.
                      // Capping this to 500 made large titles (One Piece has 2400+
                      // concrete ASHDI videos) impossible to resolve correctly: the
                      // client preview validated only the first page while the backend
                      // applied the rule to every video and then failed on hidden
                      // fractional/SPECIAL labels or duplicates later in the list.
                      unresolvedVideos: this.manualVideos(record)
                          .filter((video) => !new Set(record.manualHandledVideoIds).has(this.videoKey(video)))
                          .map((video) => ({ ...video, key: this.videoKey(video) })),
                  }
                : null,
        };
    }

    private async autoMapKnownLabels(state: ImportState) {
        const trustedPlayers = new Set<string>();
        const trustedTeams = new Set<string>();
        for (const record of state.records) {
            for (const episode of record.parserEpisodes) {
                if (episode.source !== 'main' && episode.source !== 'review') continue;
                const player = this.cleanText(episode.player);
                const team = this.cleanText(episode.dubteam);
                if (player) trustedPlayers.add(player);
                if (team) trustedTeams.add(team);
            }
        }

        // main.json and manual-review.resolvedEpisodes are already normalized by
        // the parser. Their labels are safe to materialize once and reuse.
        for (const title of trustedPlayers) {
            let entity = await this.prisma.player.findFirst({
                where: { title: { equals: title, mode: 'insensitive' } },
                select: { id: true, title: true },
            });
            if (!entity) {
                try {
                    entity = await this.prisma.player.create({
                        data: { title },
                        select: { id: true, title: true },
                    });
                } catch {
                    entity = await this.prisma.player.findFirst({
                        where: { title: { equals: title, mode: 'insensitive' } },
                        select: { id: true, title: true },
                    });
                }
            }
            if (entity) state.mappings.players[title] = Number(entity.id);
        }

        for (const title of trustedTeams) {
            let entity = await this.prisma.dubTeam.findFirst({
                where: { title: { equals: title, mode: 'insensitive' } },
                select: { id: true, title: true },
            });
            if (!entity) {
                try {
                    entity = await this.prisma.dubTeam.create({
                        data: { title },
                        select: { id: true, title: true },
                    });
                } catch {
                    entity = await this.prisma.dubTeam.findFirst({
                        where: { title: { equals: title, mode: 'insensitive' } },
                        select: { id: true, title: true },
                    });
                }
            }
            if (entity) state.mappings.dubTeams[title] = Number(entity.id);
        }

        const [players, dubTeams] = await Promise.all([
            this.prisma.player.findMany({ select: { id: true, title: true } }),
            this.prisma.dubTeam.findMany({ select: { id: true, title: true } }),
        ]);
        const playerByName = new Map<string, number>(
            players.map((item) => [this.normalizeSearch(item.title), Number(item.id)] as [string, number]),
        );
        const teamByName = new Map<string, number>(
            dubTeams.map((item) => [this.normalizeSearch(item.title), Number(item.id)] as [string, number]),
        );
        for (const record of state.records) {
            for (const episode of record.parserEpisodes) {
                if (episode.player && !state.mappings.players[episode.player]) {
                    const id = playerByName.get(this.normalizeSearch(episode.player));
                    if (id) state.mappings.players[episode.player] = id;
                }
                if (episode.dubteam && !state.mappings.dubTeams[episode.dubteam]) {
                    const id = teamByName.get(this.normalizeSearch(episode.dubteam));
                    if (id) state.mappings.dubTeams[episode.dubteam] = id;
                }
            }
        }
    }

    private getEpisodeMappings(state: ImportState) {
        const players = new Map<string, number>();
        const dubTeams = new Map<string, number>();
        for (const record of state.records) {
            for (const episode of record.parserEpisodes) {
                if (episode.player) players.set(episode.player, (players.get(episode.player) ?? 0) + 1);
                if (episode.dubteam) dubTeams.set(episode.dubteam, (dubTeams.get(episode.dubteam) ?? 0) + 1);
            }
        }
        return {
            players: [...players.entries()]
                .map(([label, count]) => ({ label, count, id: state.mappings.players[label] ?? null }))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
            dubTeams: [...dubTeams.entries()]
                .map(([label, count]) => ({ label, count, id: state.mappings.dubTeams[label] ?? null }))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        };
    }

    private recordMappingStats(record: ImportRecord, mappings: ImportState['mappings']) {
        let unresolvedPlayers = 0;
        let unresolvedDubTeams = 0;
        for (const episode of record.parserEpisodes) {
            if (!episode.playerId && (!episode.player || !mappings.players[episode.player])) unresolvedPlayers += 1;
            if (!episode.dubTeamId && (!episode.dubteam || !mappings.dubTeams[episode.dubteam])) unresolvedDubTeams += 1;
        }
        return { unresolvedPlayers, unresolvedDubTeams };
    }

    private countStatuses(records: ImportRecord[]) {
        const counts: Record<ImportRecordStatus, number> = {
            PENDING: 0,
            READY: 0,
            REVIEW: 0,
            UNRESOLVED: 0,
            IMPORTED: 0,
            FAILED: 0,
        };
        for (const record of records) counts[record.status] += 1;
        return counts;
    }

    private effectiveReviewBlockRoles(
        blocks: any[],
        overrides: Record<string, ReviewBlockRole | null>,
    ): Record<string, ReviewBlockRole | null> {
        const result: Record<string, ReviewBlockRole | null> = {};
        for (const block of blocks) {
            const key = String(block.index);
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                const value = overrides[key];
                result[key] = value && ['type', 'team', 'player', 'range', 'ignore'].includes(value) ? value : null;
                continue;
            }
            if (this.looksLikeEpisodeRangeBlock(block)) {
                result[key] = 'range';
                continue;
            }
            const parserRole = String(block?.role ?? '').toLowerCase();
            const confidence = Number(block?.confidence ?? 0);
            result[key] =
                confidence >= 0.75 && ['type', 'team', 'player'].includes(parserRole)
                    ? (parserRole as ReviewBlockRole)
                    : null;
        }

        // missing-type / missing-team cases often contain one role that the parser
        // knows very confidently. If several blocks claim the same role, keep only
        // the highest-confidence one unless the user explicitly assigned them.
        for (const role of ['type', 'team', 'player'] as const) {
            const matching = blocks
                .filter((block) => result[String(block.index)] === role)
                .sort((a, b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0));
            if (matching.length <= 1) continue;
            const explicit = matching.filter((block) => overrides[String(block.index)] === role);
            if (explicit.length) continue;
            for (const block of matching.slice(1)) result[String(block.index)] = null;
        }
        return result;
    }

    private looksLikeEpisodeRangeBlock(block: any): boolean {
        const labels = (Array.isArray(block?.options) ? block.options : [])
            .map((option: any) => String(option?.label ?? '')
                .normalize('NFKC')
                .replace(/[\u00A0\u202F]/g, ' ')
                .replace(/[\u200B-\u200D\uFEFF]/g, '')
                .replace(/[‐‑‒–—―−﹘﹣－]/g, '-')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase())
            .filter(Boolean);
        if (labels.length < 2) return false;

        const episodeWord = String.raw`(?:сер(?:\p{L}+)?\.?|епізод(?:\p{L}+)?\.?|episode(?:s)?\.?|ep\.?)`;
        const rangePattern = new RegExp(String.raw`^\d{1,4}\s*-\s*\d{1,4}(?:\s*${episodeWord})?$`, 'iu');
        const singlePattern = new RegExp(String.raw`^\d{1,4}\s*${episodeWord}$`, 'iu');
        const rangeCount = labels.filter((label: string) => rangePattern.test(label)).length;
        const matching = labels.filter((label: string) => rangePattern.test(label) || singlePattern.test(label)).length;
        return rangeCount >= 3 || matching >= Math.max(2, Math.ceil(labels.length * 0.45));
    }

    private normalizeDubType(value: unknown): DubType | null {
        const normalized = String(value ?? '').trim().toUpperCase();
        if (normalized === 'DUB') return DubType.DUB;
        if (normalized === 'SUB') return DubType.SUB;
        return null;
    }

    private classifyReviewTypeLabel(label: unknown): DubType | null {
        const normalized = this.normalizeSearch(String(label ?? ''))
            .replace(/[()\[\]{}.,:;!?"'`]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!normalized) return null;
        const dubLabels = new Set([
            'озвучення', 'озвучка', 'дубляж', 'дуб', 'dub', 'dubbed', 'voice', 'озвучення українською',
        ]);
        const subLabels = new Set([
            'субтитри', 'субтитры', 'субтитр', 'sub', 'subs', 'subtitle', 'subtitles', 'українські субтитри',
        ]);
        if (dubLabels.has(normalized)) return DubType.DUB;
        if (subLabels.has(normalized)) return DubType.SUB;
        return null;
    }

    private reviewOptionKey(blockIndex: unknown, optionId: unknown) {
        return `${Number(blockIndex)}:${String(optionId ?? '')}`;
    }

    private findVideoBlockOption(video: ManualVideo, block: any): any | null {
        const blockIndex = Number(block?.index);
        const ancestors = Array.isArray(video?.ancestors) ? video.ancestors : [];
        const ancestor = ancestors.find((item: any) => Number(item?.blockIndex) === blockIndex);
        if (ancestor?.optionId) {
            const exact = (Array.isArray(block?.options) ? block.options : []).find(
                (option: any) => String(option?.id) === String(ancestor.optionId),
            );
            if (exact) return exact;
            return { id: ancestor.optionId, label: ancestor.label ?? ancestor.optionId };
        }

        const videoId = String(video?.id ?? '');
        if (!videoId) return null;
        const options = (Array.isArray(block?.options) ? block.options : [])
            .filter((option: any) => {
                const id = String(option?.id ?? '');
                return Boolean(id) && (videoId === id || videoId.startsWith(`${id}_`));
            })
            .sort((a: any, b: any) => String(b?.id ?? '').length - String(a?.id ?? '').length);
        return options[0] ?? null;
    }

    private extractManualEpisodeNumber(label: unknown): number | null {
        const text = String(label ?? '').replace(/\u00a0/g, ' ').trim();
        if (!text) return null;

        // Never truncate fractional/special/range labels to the first integer.
        // `1004.5 серія` must not become 1004, `1061,5` must not become 1061,
        // and navigation labels such as `602-625` are not episode numbers.
        if (/\d+[.,]\d+/u.test(text)) return null;
        if (/^\d{1,5}\s*[-–—−]\s*\d{1,5}(?:\s+.*)?$/u.test(text)) return null;
        if (/\b(?:special|ova|ona|movie)\b/iu.test(text)) return null;

        const match = text.match(/^(\d{1,5})(?=\s|$)/u);
        if (!match) return null;
        const value = Number(match[1]);
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    private async ensurePlayerByTitle(titleValue: unknown) {
        const title = this.cleanText(titleValue);
        if (!title) throw new BadRequestException('Порожня назва плеєра.');
        let entity = await this.prisma.player.findFirst({
            where: { title: { equals: title, mode: 'insensitive' } },
            select: { id: true, title: true },
        });
        if (!entity) {
            try {
                entity = await this.prisma.player.create({
                    data: { title },
                    select: { id: true, title: true },
                });
            } catch {
                entity = await this.prisma.player.findFirst({
                    where: { title: { equals: title, mode: 'insensitive' } },
                    select: { id: true, title: true },
                });
            }
        }
        if (!entity) throw new BadRequestException(`Не вдалося створити плеєр «${title}».`);
        return { id: Number(entity.id), title: entity.title };
    }

    private async resolvePlayerReference(idValue?: number | null, titleValue?: string | null) {
        const id = this.asPositiveInt(idValue);
        if (id) {
            const entity = await this.prisma.player.findUnique({ where: { id }, select: { id: true, title: true } });
            if (entity) return { id: Number(entity.id), title: entity.title };
        }
        const title = this.cleanText(titleValue);
        return title ? this.ensurePlayerByTitle(title) : null;
    }

    private async resolveDubTeamReference(idValue?: number | null, titleValue?: string | null) {
        const id = this.asPositiveInt(idValue);
        if (id) {
            const entity = await this.prisma.dubTeam.findUnique({ where: { id }, select: { id: true, title: true } });
            if (entity) return { id: Number(entity.id), title: entity.title };
        }
        const title = this.cleanText(titleValue);
        if (!title) return null;
        let entity = await this.prisma.dubTeam.findFirst({
            where: { title: { equals: title, mode: 'insensitive' } },
            select: { id: true, title: true },
        });
        if (!entity) {
            try {
                entity = await this.prisma.dubTeam.create({
                    data: { title },
                    select: { id: true, title: true },
                });
            } catch {
                entity = await this.prisma.dubTeam.findFirst({
                    where: { title: { equals: title, mode: 'insensitive' } },
                    select: { id: true, title: true },
                });
            }
        }
        if (!entity) throw new BadRequestException(`Не вдалося створити команду «${title}».`);
        return { id: Number(entity.id), title: entity.title };
    }

    private remainingManualVideos(record: ImportRecord) {
        const handled = new Set(record.manualHandledVideoIds ?? []);
        return this.manualVideos(record).filter((video) => !handled.has(this.videoKey(video))).length;
    }

    private manualVideos(record: ImportRecord): ManualVideo[] {
        const videos = record.manualReview?.ashdiVideos;
        // Keep only review items that can become ordinary numbered episodes.
        // Navigation placeholders without a concrete /vod/<id> endpoint are not
        // playable variants. Likewise OVA/ONA/SPECIAL/fractional/range/other labels
        // for which we cannot determine a normal integer episode number are dropped
        // completely instead of forcing the admin to number them manually. Labels
        // such as `1 серія (ч.1)` are preserved because they still have a clear base
        // episode number and can be handled by the per-track part renumbering UI.
        return Array.isArray(videos)
            ? videos.filter((video) =>
                  this.isConcreteAshdiVodUrl(video?.file) &&
                  this.extractManualEpisodeNumber(video?.label) !== null,
              )
            : [];
    }

    private isConcreteAshdiVodUrl(value: unknown) {
        const url = String(value ?? '').trim();
        return /^https?:\/\/(?:www\.)?ashdi\.vip\/vod\/\d+(?:[/?#].*)?$/iu.test(url);
    }

    private videoKey(video: ManualVideo) {
        const file = this.normalizeUrl(String(video.file ?? ''));
        if (file) return file;
        return String(`${video.id ?? ''}:${video.label ?? ''}:${JSON.stringify(video.ancestors ?? '')}`);
    }

    private migrateManualVideoKeys(record: ImportRecord) {
        const handled = new Set((record.manualHandledVideoIds ?? []).map(String));
        const videos = this.manualVideos(record);

        // v5 and older used ashdiVideos[].id as the handled key. AniTube can reuse
        // that id for several episode URLs, so expanding an ambiguous legacy id
        // would silently hide several videos. Only migrate an id when it identifies
        // exactly one video. Exact manual episode URLs are always safe to migrate.
        const videosByLegacyId = new Map<string, ManualVideo[]>();
        for (const video of videos) {
            if (video.id === undefined || video.id === null) continue;
            const legacyId = String(video.id);
            const group = videosByLegacyId.get(legacyId) ?? [];
            group.push(video);
            videosByLegacyId.set(legacyId, group);
        }
        for (const [legacyId, group] of videosByLegacyId) {
            if (handled.has(legacyId) && group.length === 1) handled.add(this.videoKey(group[0]));
        }

        const manualLinks = new Set(
            (record.parserEpisodes ?? [])
                .filter((episode) => episode.source === 'manual')
                .map((episode) => this.normalizeUrl(episode.link))
                .filter(Boolean),
        );
        for (const video of videos) {
            const file = this.normalizeUrl(String(video.file ?? ''));
            if (file && manualLinks.has(file)) handled.add(this.videoKey(video));
        }

        record.manualHandledVideoIds = [...handled];
    }

    private videoSearchText(video: ManualVideo) {
        return `${video.label ?? ''} ${JSON.stringify(video.ancestors ?? '')}`;
    }

    private hydrateResolvedParserEpisodes(record: ImportRecord) {
        const resolved = this.normalizeParserEpisodes(
            Array.isArray(record.manualReview?.resolvedEpisodes)
                ? record.manualReview.resolvedEpisodes
                : [],
            'review',
        );
        if (!resolved.length) return;

        record.parserEpisodes = this.mergeParserEpisodes(record.parserEpisodes ?? [], resolved);

        // manual-review contains every ASHDI video for diagnostics. Only videos
        // whose URL is absent from resolvedEpisodes should remain in the manual queue.
        const resolvedLinks = new Set(
            resolved.map((episode) => this.normalizeUrl(episode.link)).filter(Boolean),
        );
        const handled = new Set(record.manualHandledVideoIds ?? []);
        for (const video of this.manualVideos(record)) {
            const file = this.normalizeUrl(String(video.file ?? ''));
            if (file && resolvedLinks.has(file)) handled.add(this.videoKey(video));
        }
        record.manualHandledVideoIds = [...handled];
    }

    private normalizeParserEpisodes(input: unknown[], source: ParserEpisode['source'] = 'main'): ParserEpisode[] {
        if (!Array.isArray(input)) return [];
        return input
            .map((item: any) => ({
                source: item?.source ?? source,
                episode: Math.max(1, Number(item?.episode) || 0),
                type: String(item?.type).toUpperCase() === 'SUB' ? 'SUB' as const : 'DUB' as const,
                link: String(item?.link ?? '').trim(),
                player: this.cleanText(item?.player),
                dubteam: this.cleanText(item?.dubteam),
                playerId: this.asPositiveInt(item?.playerId),
                dubTeamId: this.asPositiveInt(item?.dubTeamId),
            }))
            .filter((item) => item.episode > 0 && item.link);
    }

    private mergeParserEpisodes(first: ParserEpisode[], second: ParserEpisode[]) {
        const map = new Map<string, ParserEpisode>();
        for (const item of [...second, ...first]) {
            const key = `${item.episode}:${item.type}:${item.playerId ?? item.player ?? ''}:${item.dubTeamId ?? item.dubteam ?? ''}`;
            const existing = map.get(key);
            if (!existing || item.source === 'main' || (item.source === 'manual' && existing.source === 'review')) {
                map.set(key, item);
            }
        }
        return [...map.values()].sort((a, b) => a.episode - b.episode);
    }

    private normalizeLoadedState(data: any): ImportState | null {
        if (data?.version !== 1 || !Array.isArray(data.records)) return null;
        data.mappings ??= { players: {}, dubTeams: {} };
        data.mappings.players ??= {};
        data.mappings.dubTeams ??= {};
        data.uploadedAt ??= null;
        data.updatedAt ??= new Date().toISOString();
        data.sourceFilename ??= null;
        for (const record of data.records as ImportRecord[]) {
            record.episodeIssues ??= [];
            record.issues ??= [];
            record.warnings ??= [];
            record.resolution ??= {};
            record.parserEpisodes ??= [];
            record.manualHandledVideoIds ??= [];
            record.episodeReviewDone ??= false;
            if (record.metadata?.description) {
                record.metadata.description = this.cleanDescription(record.metadata.description);
            }
            const oldResolvedLinks = new Set(
                Array.isArray(record.manualReview?.resolvedEpisodes)
                    ? record.manualReview.resolvedEpisodes
                          .map((episode: any) => this.normalizeUrl(String(episode?.link ?? '')))
                          .filter(Boolean)
                    : [],
            );
            record.parserEpisodes = (record.parserEpisodes ?? []).map((episode) => ({
                ...episode,
                source:
                    episode.source ??
                    (oldResolvedLinks.has(this.normalizeUrl(String(episode.link ?? '')))
                        ? 'review'
                        : 'main'),
            }));
            record.resolverVersion ??= 0;
            this.migrateManualVideoKeys(record);
            this.hydrateResolvedParserEpisodes(record);
            if (record.status !== 'FAILED') {
                this.recalculateRecord(record, data.mappings);
            }
        }
        return data as ImportState;
    }

    private readStateFromStorageZip(buffer: Buffer, filename: string): ImportState {
        let entries: Map<string, Buffer>;
        try {
            entries = this.readZipEntries(buffer);
        } catch (error) {
            throw new BadRequestException(`${filename}: ${this.errorText(error)}`);
        }
        const candidates = [...entries.entries()]
            .filter(([name]) => /(?:^|\/)anime-import(?:\.backup|\.pre-v6)?\.json$/i.test(name))
            .sort(([a], [b]) => this.storageStateCandidateRank(a) - this.storageStateCandidateRank(b));
        if (!candidates.length) {
            throw new BadRequestException('У storage ZIP не знайдено anime-import.json.');
        }
        for (const [, contents] of candidates) {
            try {
                const parsed = JSON.parse(contents.toString('utf8').replace(/^\uFEFF/, ''));
                const state = this.normalizeLoadedState(parsed);
                if (state) return state;
            } catch {
                // Try backup candidate if present.
            }
        }
        throw new BadRequestException('anime-import.json у storage ZIP пошкоджений або має невідомий формат.');
    }

    private async loadState(): Promise<ImportState> {
        // A status request can arrive while processPending is persisting a large
        // queue. Wait for our own writer so JSON is never read mid-write.
        await this.stateSaveQueue.catch(() => undefined);

        for (const source of [this.statePath, this.stateBackupPath]) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    const parsed = JSON.parse(await readFile(source, 'utf8'));
                    const data = this.normalizeLoadedState(parsed);
                    if (data) {
                        if (source === this.stateBackupPath) {
                            this.logger.warn('Primary anime-import.json was unreadable; recovered from anime-import.backup.json');
                        }
                        return data;
                    }
                    break;
                } catch (error) {
                    if (String((error as NodeJS.ErrnoException)?.code ?? '') === 'ENOENT') break;
                    if (attempt < 2) await this.delay(30 * (attempt + 1));
                }
            }
        }

        return {
            version: 1,
            uploadedAt: null,
            updatedAt: new Date().toISOString(),
            sourceFilename: null,
            mappings: { players: {}, dubTeams: {} },
            records: [],
        };
    }

    private async saveState(state: ImportState) {
        await mkdir(this.storageDir, { recursive: true });
        state.updatedAt = new Date().toISOString();

        // Serialize the snapshot before enqueueing it: callers may continue mutating
        // their in-memory state while an earlier disk write is still finishing.
        const stateJson = `${JSON.stringify(state, null, 2)}\n`;
        const unresolved = state.records
            .filter((record) => ['UNRESOLVED', 'REVIEW', 'FAILED'].includes(record.status))
            .map((record) => ({
                key: record.key,
                link: record.link,
                originalTitle: record.originalTitle,
                status: record.status,
                issues: record.issues,
                warnings: record.warnings,
                resolution: record.resolution,
                lastError: record.lastError ?? null,
            }));
        const unresolvedJson = `${JSON.stringify(unresolved, null, 2)}\n`;

        const write = this.stateSaveQueue
            .catch(() => undefined)
            .then(async () => {
                await this.ensurePreV6Backup();
                await this.persistFileSafely(this.statePath, stateJson);
                // Backup contains the latest *completed* snapshot. If Windows or
                // the process interrupts a future overwrite, loadState can recover.
                await this.persistFileSafely(this.stateBackupPath, stateJson).catch((error) => {
                    this.logger.warn(`Could not update import-state backup: ${this.errorText(error)}`);
                });
                await this.persistFileSafely(this.unresolvedPath, unresolvedJson);
            });

        this.stateSaveQueue = write;
        await write;
    }


    /**
     * The v6 schema is backward compatible, but the user's already-resolved queue is
     * expensive to rebuild. Before v6 performs its first write, preserve the exact
     * pre-v6 primary state once. The file is never overwritten afterwards.
     */
    private async ensurePreV6Backup() {
        try {
            await readFile(this.preV6BackupPath, 'utf8');
            return;
        } catch (error) {
            if (String((error as NodeJS.ErrnoException)?.code ?? '') !== 'ENOENT') {
                this.logger.warn(`Could not inspect pre-v6 backup: ${this.errorText(error)}`);
                return;
            }
        }

        try {
            const current = await readFile(this.statePath, 'utf8');
            // Do not freeze a corrupt snapshot as the recovery point.
            JSON.parse(current);
            await writeFile(this.preV6BackupPath, current, 'utf8');
            this.logger.log('Created storage/json/anime-import.pre-v6.json safety snapshot.');
        } catch (error) {
            const code = String((error as NodeJS.ErrnoException)?.code ?? '');
            if (code !== 'ENOENT') {
                this.logger.warn(`Could not create pre-v6 import-state backup: ${this.errorText(error)}`);
            }
        }
    }

    private storageStateCandidateRank(filename: string) {
        const normalized = filename.toLowerCase();
        if (normalized.endsWith('/anime-import.json') || normalized === 'anime-import.json') return 0;
        if (normalized.endsWith('/anime-import.backup.json') || normalized === 'anime-import.backup.json') return 1;
        return 2;
    }

    /**
     * Windows-safe persistence: do not rename over an existing file. rename()
     * is exactly what produced EPERM on the user's machine. Writes are already
     * serialized by stateSaveQueue, so a direct overwrite is sufficient here.
     */
    private async persistFileSafely(target: string, contents: string) {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                await writeFile(target, contents, 'utf8');
                return;
            } catch (error) {
                lastError = error;
                if (!this.isRetryableFileError(error) || attempt === 7) throw error;
                await this.delay(Math.min(75 * 2 ** attempt, 2_000));
            }
        }
        if (lastError) throw lastError;
    }

    private isRetryableFileError(error: unknown) {
        const code = String((error as NodeJS.ErrnoException)?.code ?? '');
        return ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code);
    }

    private delay(ms: number) {
        return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    private requireRecord(state: ImportState, key: string) {
        const record = state.records.find((item) => item.key === key);
        if (!record) throw new NotFoundException('Запис масового імпорту не знайдено.');
        return record;
    }

    private readJsonArray(entries: Map<string, Buffer>, filename: string, required: boolean) {
        const entry = [...entries.entries()].find(([name]) => name === filename || name.endsWith(`/${filename}`));
        if (!entry) {
            if (required) throw new BadRequestException(`У ZIP відсутній ${filename}.`);
            return [];
        }
        try {
            const value = JSON.parse(entry[1].toString('utf8').replace(/^\uFEFF/, ''));
            if (!Array.isArray(value)) throw new Error('not array');
            return value;
        } catch {
            throw new BadRequestException(`${filename} містить некоректний JSON.`);
        }
    }

    /** Minimal ZIP reader for store/deflate entries. It keeps the backend dependency-free. */
    private readZipEntries(buffer: Buffer) {
        const entries = new Map<string, Buffer>();
        let eocd = -1;
        for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
            if (buffer.readUInt32LE(i) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) throw new BadRequestException('Файл не схожий на ZIP-архів.');
        const totalEntries = buffer.readUInt16LE(eocd + 10);
        let offset = buffer.readUInt32LE(eocd + 16);
        for (let index = 0; index < totalEntries; index += 1) {
            if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
            const method = buffer.readUInt16LE(offset + 10);
            const compressedSize = buffer.readUInt32LE(offset + 20);
            const filenameLength = buffer.readUInt16LE(offset + 28);
            const extraLength = buffer.readUInt16LE(offset + 30);
            const commentLength = buffer.readUInt16LE(offset + 32);
            const localOffset = buffer.readUInt32LE(offset + 42);
            const filename = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8');
            if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
                throw new BadRequestException('Пошкоджений ZIP: local header не знайдено.');
            }
            const localNameLength = buffer.readUInt16LE(localOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localOffset + 28);
            const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
            if (!filename.endsWith('/')) {
                if (method === 0) entries.set(filename, Buffer.from(compressed));
                else if (method === 8) entries.set(filename, inflateRawSync(compressed));
                else throw new BadRequestException(`ZIP використовує непідтримуваний метод стиснення ${method}.`);
            }
            offset += 46 + filenameLength + extraLength + commentLength;
        }
        return entries;
    }

    private pickBestSearchResult(query: string, list: any[]) {
        const needle = this.normalizeSearch(query);
        const score = (item: any) => {
            const values = [item?.title_ua, item?.title_en, item?.title_ja, ...(Array.isArray(item?.synonyms) ? item.synonyms : [])]
                .map((value) => this.normalizeSearch(value ?? ''))
                .filter(Boolean);
            let best = 0;
            for (const value of values) {
                if (value === needle) best = Math.max(best, 100);
                else if (value.includes(needle) || needle.includes(value)) best = Math.max(best, 75);
                else {
                    const a = new Set(needle.split(' ').filter(Boolean));
                    const b = new Set(value.split(' ').filter(Boolean));
                    const common = [...a].filter((token) => b.has(token)).length;
                    const union = new Set([...a, ...b]).size || 1;
                    best = Math.max(best, Math.round((common / union) * 60));
                }
            }
            return best;
        };
        return [...list].sort((a, b) => score(b) - score(a))[0] ?? null;
    }

    private hikkaStudios(hikka: any): string[] {
        if (Array.isArray(hikka?.studios)) {
            return hikka.studios.map((item: any) => this.cleanText(item?.name)).filter(Boolean) as string[];
        }
        if (Array.isArray(hikka?.companies)) {
            return hikka.companies
                .filter((item: any) => String(item?.type).toLowerCase() === 'studio')
                .map((item: any) => this.cleanText(item?.company?.name))
                .filter(Boolean) as string[];
        }
        return [];
    }

    private mapType(value: unknown): AnimeType | null {
        const type = String(value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
        if (type === 'TV' || type === 'TVSERIES') return AnimeType.TV;
        if (type === 'MOVIE' || type === 'FILM') return AnimeType.MOVIE;
        if (type === 'OVA') return AnimeType.OVA;
        if (type === 'ONA') return AnimeType.ONA;
        if (type === 'SPECIAL' || type === 'TVSPECIAL') return AnimeType.SPECIAL;
        return null;
    }

    private mapStatus(value: unknown): AnimeStatus | null {
        const status = String(value ?? '').toLowerCase();
        if (['ongoing', 'releasing', 'currently airing'].some((part) => status.includes(part))) return AnimeStatus.ONGOING;
        if (['finished', 'finished airing', 'completed'].some((part) => status.includes(part))) return AnimeStatus.COMPLETED;
        if (['announced', 'not yet aired', 'not_yet_released'].some((part) => status.includes(part))) return AnimeStatus.ANNOUNCED;
        if (['cancelled', 'canceled', 'discontinued'].some((part) => status.includes(part))) return AnimeStatus.CANCELED;
        return null;
    }

    private mapRating(value: unknown): AnimeRating | null {
        const rating = String(value ?? '').toLowerCase().replace(/[^a-z0-9+]/g, '');
        if (rating.includes('pg13')) return AnimeRating.PG13;
        if (rating === 'g') return AnimeRating.G;
        if (rating === 'pg') return AnimeRating.PG;
        if (rating.includes('rplus') || rating === 'r+') return AnimeRating.RPlus;
        if (rating === 'r') return AnimeRating.R;
        if (rating.includes('rx')) return AnimeRating.Rx;
        return null;
    }

    private mapJikanRating(value: unknown): AnimeRating | null {
        const rating = String(value ?? '').toUpperCase();
        if (rating.startsWith('G ' ) || rating === 'G') return AnimeRating.G;
        if (rating.startsWith('PG-13')) return AnimeRating.PG13;
        if (rating.startsWith('PG ' ) || rating === 'PG') return AnimeRating.PG;
        if (rating.startsWith('R+')) return AnimeRating.RPlus;
        if (rating.startsWith('R -') || rating === 'R') return AnimeRating.R;
        if (rating.startsWith('RX')) return AnimeRating.Rx;
        return null;
    }

    private parseDuration(value: unknown) {
        const text = String(value ?? '');
        const hour = Number(text.match(/(\d+)\s*hr/i)?.[1] ?? 0);
        const min = Number(text.match(/(\d+)\s*min/i)?.[1] ?? 0);
        const total = hour * 60 + min;
        return total || null;
    }

    private timestampToIso(value: unknown) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return null;
        const millis = number < 10_000_000_000 ? number * 1000 : number;
        return new Date(millis).toISOString();
    }

    private fuzzyDateToIso(value: any) {
        if (!value?.year) return null;
        const month = Math.max(1, Math.min(12, Number(value.month) || 1));
        const day = Math.max(1, Math.min(28, Number(value.day) || 1));
        return new Date(Date.UTC(Number(value.year), month - 1, day)).toISOString();
    }

    private safeIso(value: unknown) {
        if (!value) return null;
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    private countryName(value: unknown) {
        const code = String(value ?? '').toUpperCase();
        const map: Record<string, string> = {
            JP: 'Японія', KR: 'Південна Корея', CN: 'Китай', TW: 'Тайвань',
            US: 'США', CA: 'Канада', GB: 'Велика Британія', FR: 'Франція',
        };
        return map[code] ?? (code || null);
    }

    private parseNumericRef(value?: string) {
        if (!value) return null;
        const match = String(value).match(/(?:anime\/)?(\d{1,12})(?:\D|$)/i);
        return match ? this.asPositiveInt(match[1]) : null;
    }

    private parseHikkaSlug(value?: string) {
        const text = this.cleanText(value);
        if (!text) return null;
        try {
            const url = new URL(text);
            const match = url.pathname.match(/\/anime\/([^/?#]+)/i);
            return match?.[1] ?? null;
        } catch {
            return text.replace(/^\/+|\/+$/g, '');
        }
    }

    private extractAniTubeId(value: string) {
        try {
            const pathname = new URL(value).pathname;
            return this.asPositiveInt(pathname.match(/\/(\d+)-[^/]+\.html$/i)?.[1]);
        } catch {
            return this.asPositiveInt(value.match(/(\d+)/)?.[1]);
        }
    }

    private normalizeUrl(value: string) {
        try {
            const url = new URL(value);
            url.hash = '';
            url.search = '';
            url.pathname = url.pathname.replace(/\/+$/, '');
            return url.href;
        } catch {
            return String(value ?? '').trim().replace(/\/+$/, '');
        }
    }

    private normalizeSearch(value: string) {
        return String(value ?? '')
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[’'`]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    private cleanText(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const text = value.replace(/\s+/g, ' ').trim();
        return text || null;
    }

    private cleanDescription(value: unknown): string | null {
        if (typeof value !== 'string') return null;

        let text = value
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/\&/g, '&');

        // Hikka descriptions often end with a Markdown attribution, e.g.
        // `Джерело [MyAnimeList](https://...)`. It is metadata, not synopsis.
        text = text.replace(
            /(?:^|\s)(?:Джерело|Источник|Source)\s*:?\s*(?:\[[^\]]+\]\(\s*(?:https?:\/\/|www\.)[^)]*\)|(?:https?:\/\/|www\.)\S+)\s*$/iu,
            '',
        );

        // Preserve the visible label of Markdown links while dropping the URL:
        // `[Акадза Акарі](https://hikka.io/...)` -> `Акадза Акарі`.
        text = text.replace(
            /\[([^\]\r\n]+)\]\(\s*(?:https?:\/\/|www\.)[^)]*\)/giu,
            '$1',
        );

        // Remove raw/autolink URLs that occasionally leak into source text.
        text = text
            .replace(/<\s*(?:https?:\/\/|www\.)[^>]+>/giu, '')
            .replace(/(?:https?:\/\/|www\.)[^\s)\]}]+/giu, '')
            .replace(/\(\s*\)/g, '');

        // If Hikka left a simple square-bracket label without a URL, keep the
        // text itself instead of forcing the whole description into review.
        text = text.replace(/\[([^\[\]\r\n]{1,160})\]/gu, '$1');

        // A malformed source suffix may become `Джерело MyAnimeList` after the
        // URL cleanup above. Remove only well-known attribution names at EOF.
        text = text.replace(
            /(?:^|\s)(?:Джерело|Источник|Source)\s*:?\s*(?:MyAnimeList|AniList|Hikka|AniDB|ANN)\s*$/iu,
            '',
        );

        return this.cleanText(text);
    }

    private uniqueStrings(values: Array<string | null | undefined>) {
        return [...new Set(values.map((value) => this.cleanText(value)).filter(Boolean) as string[])];
    }

    private asPositiveInt(value: unknown) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : null;
    }

    private asNonNegativeInt(value: unknown) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 ? number : null;
    }

    private errorText(error: unknown) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as { response?: { data?: unknown }; message?: string };
            const api = axiosError.response?.data as { message?: unknown; detail?: unknown } | undefined;
            return this.cleanText(api?.message ?? api?.detail ?? axiosError.message) ?? 'HTTP error';
        }
        return error instanceof Error ? error.message : String(error);
    }

    private async mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
        let next = 0;
        async function run() {
            while (true) {
                const index = next++;
                if (index >= items.length) return;
                await worker(items[index]);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    }
}
