import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { join } from 'node:path';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'node:stream';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { ImageFiltersListDto } from './dto/image-filters-list.dto';
import { Image, Prisma } from '../../generated/prisma/client';
import { ImageAdminSelect } from '../../common/orm/image.orm';
import { paginateById } from '../../common/pagination';
import { validateImageUrl } from '../../common/helpers/validate-image-url';
import { normalizeHeader } from '../../common/helpers/normalize-header';
import { CreateImageDto } from './dto/create-image.dto';
import { UpdateImageDto } from './dto/update-image.dto';

const IMAGE_MIME_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
};

interface ProxiedImage {
    stream: Readable;
    contentType?: string;
}

export type PreparedImage = {
    id: number;
    created: boolean;
};

@Injectable()
export class ImageService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly httpService: HttpService,
    ) {}

    async findAll(filters: ImageFiltersListDto) {
        const where: Prisma.ImageWhereInput = {};

        if (filters.search) {
            const search = filters.search.trim();
            const text = { contains: search, mode: 'insensitive' as const };
            const animeSearchWhere = {
                OR: [{ title: text }, { originalTitle: text }, { engTitle: text }],
            };
            const userSearchWhere = {
                OR: [
                    { username: text },
                    { email: text },
                    { displayName: text },
                ],
            };

            const searchConditions: Prisma.ImageWhereInput[] = [
                { path: text },
                { sourceUrl: text },
                { animes: { some: animeSearchWhere } },
                { animeAdditionalImages: { some: animeSearchWhere } },
                { genres: { some: { title: text } } },
                { avatars: { some: userSearchWhere } },
                { playlistCovers: { some: { title: text } } },
            ];

            if (/^\d+$/.test(search)) {
                searchConditions.unshift({ id: Number(search) });
            }

            where.OR = searchConditions;
        }

        if (filters.avatarAllowed !== undefined) {
            where.isAvatarAllowed = filters.avatarAllowed === 'true';
        }

        switch (filters.usage) {
            case 'anime':
                where.AND = [
                    {
                        OR: [
                            { animes: { some: {} } },
                            { animeAdditionalImages: { some: {} } },
                        ],
                    },
                ];
                break;
            case 'genre':
                where.genres = { some: {} };
                break;
            case 'avatar':
                where.avatars = { some: {} };
                break;
            case 'unused':
                where.AND = [
                    ...(Array.isArray(where.AND) ? where.AND : []),
                    { animes: { none: {} } },
                    { animeAdditionalImages: { none: {} } },
                    { genres: { none: {} } },
                    { avatars: { none: {} } },
                    { playlistCovers: { none: {} } },
                ];
                break;
        }

        return paginateById({
            model: this.prisma.image,
            pagination: filters,
            where,
            orderBy: [{ id: filters.sort === 'old' ? 'asc' : 'desc' }],
            select: ImageAdminSelect,
        });
    }

    async createManagedImage(dto: CreateImageDto) {
        const image = await this.createImage(
            dto.url,
            dto.isAvatarAllowed ?? false,
        );

        const createdImage = await this.prisma.image.findUnique({
            where: { id: image.id },
            select: ImageAdminSelect,
        });

        if (!createdImage) {
            throw new InternalServerErrorException('Не вдалося завантажити створене зображення.');
        }

        return createdImage;
    }

    async update(id: number, dto: UpdateImageDto) {
        const existing = await this.prisma.image.findUnique({
            where: { id },
            select: { id: true, isAvatarAllowed: true },
        });
        if (!existing) {
            throw new NotFoundException('Не існує зображення з таким айді.');
        }

        if (!dto.isAvatarAllowed && existing.isAvatarAllowed) {
            await this.prisma.$transaction([
                this.prisma.user.updateMany({
                    where: { avatarId: id },
                    data: { avatarId: null },
                }),
                this.prisma.image.update({
                    where: { id },
                    data: { isAvatarAllowed: false },
                }),
            ]);
        } else {
            await this.prisma.image.update({
                where: { id },
                data: { isAvatarAllowed: dto.isAvatarAllowed },
            });
        }

        const updatedImage = await this.prisma.image.findUnique({
            where: { id },
            select: ImageAdminSelect,
        });

        if (!updatedImage) {
            throw new InternalServerErrorException('Не вдалося завантажити оновлене зображення.');
        }

        return updatedImage;
    }

    async createImage(
        url: string,
        isAvatarAllowed = false,
    ): Promise<Image> {
        let imagePath: string | undefined;
        const uploadDir = join(process.cwd(), 'uploads');

        try {
            imagePath = await this.downloadImageByUrl(url, uploadDir);

            const image = await this.prisma.image.create({
                data: {
                    path: imagePath,
                    sourceUrl: url,
                    isAvatarAllowed,
                },
            });
            return image;
        } catch (e) {
            console.log('Load image error', e);
            if (imagePath) {
                await this.deleteImageByFileName(imagePath, uploadDir);
            }
            if (e instanceof BadRequestException) throw e;
            throw new InternalServerErrorException();
        }
    }

    async deleteImage(id: number): Promise<boolean> {
        const existing = await this.prisma.image.findUnique({
            where: { id },
            select: { id: true, path: true },
        });
        if (!existing) {
            throw new NotFoundException('Не існує зображення з таким айді.');
        }

        try {
            await this.prisma.image.delete({ where: { id } });
            await this.deleteImageByFileName(
                existing.path,
                join(process.cwd(), 'uploads'),
            );
            return true;
        } catch (e) {
            console.log('Delete image error', e);
            throw new InternalServerErrorException();
        }
    }

    async deleteImageIfUnused(id: number) {
        const img = await this.prisma.image.findFirst({
            where: { id },
            include: {
                _count: {
                    select: {
                        animes: true,
                        animeAdditionalImages: true,
                        avatars: true,
                        genres: true,
                        playlistCovers: true,
                    },
                },
            },
        });
        if (!img) return false;

        if (img.isAvatarAllowed) return false;
        if (Object.values(img._count).some((count) => count > 0)) return false;

        return await this.deleteImage(id);
    }

    async getProxyImage(url: string): Promise<ProxiedImage> {
        const parsedUrl = validateImageUrl(url);

        try {
            const response = await firstValueFrom(
                this.httpService.get<Readable>(parsedUrl.toString(), {
                    responseType: 'stream',
                    timeout: 15_000,
                    maxRedirects: 5,
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        Referer: `${parsedUrl.protocol}//${parsedUrl.hostname}/`,
                    },
                }),
            );

            const contentType = normalizeHeader(
                response.headers['content-type'],
            );

            return {
                stream: response.data,
                contentType,
            };
        } catch (e: any) {
            console.log('Proxy image error:', e?.message);
            throw new InternalServerErrorException('Помилка на сервері.');
        }
    }

    private async downloadImageByUrl(
        imageUrl: string,
        uploadDir: string,
    ): Promise<string> {
        const url = validateImageUrl(imageUrl);

        await fs.mkdir(uploadDir, { recursive: true });

        let response;
        try {
            response = await firstValueFrom(
                this.httpService.get<ArrayBuffer>(url.toString(), {
                    responseType: 'arraybuffer',
                    timeout: 15_000,
                    maxRedirects: 5,
                    validateStatus: (status) => status >= 200 && status < 300,
                    headers: {
                        // A number of image CDNs (including Wikimedia) reject the
                        // default axios user agent even though the same URL opens in
                        // a browser. Fetch external images like a normal browser.
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        Referer: `${url.protocol}//${url.hostname}/`,
                    },
                }),
            );
        } catch (error) {
            throw this.createImageFetchException(imageUrl, error);
        }

        const contentTypeRaw =
            typeof response.headers.get === 'function'
                ? response.headers.get('content-type')
                : response.headers['content-type'];

        const contentType =
            typeof contentTypeRaw === 'string'
                ? contentTypeRaw.split(';')[0].trim().toLowerCase()
                : undefined;

        let ext: string | undefined;

        if (contentType) {
            if (!contentType.startsWith('image/')) {
                throw this.createImageFetchException(
                    imageUrl,
                    undefined,
                    'За вказаним URL сервер повернув не зображення.',
                );
            }

            ext = IMAGE_MIME_EXT[contentType];
        }

        if (!ext) {
            ext = path.extname(url.pathname).replace('.', '').toLowerCase();
        }

        if (!ext) {
            ext = 'jpg';
        }

        const buffer = Buffer.from(response.data);
        if (buffer.length > 20 * 1024 * 1024) {
            throw this.createImageFetchException(
                imageUrl,
                undefined,
                'Зображення завелике. Максимальний розмір — 20 МБ.',
            );
        }

        const fileName = `${randomUUID()}.${ext}`;
        const filePath = path.join(uploadDir, fileName);

        await fs.writeFile(filePath, buffer);

        return fileName;
    }

    private createImageFetchException(
        imageUrl: string,
        error?: unknown,
        customMessage?: string,
    ) {
        let message =
            customMessage ??
            'Не вдалося отримати зображення за вказаним URL.';

        if (!customMessage && typeof error === 'object' && error !== null) {
            const requestError = error as {
                code?: unknown;
                response?: { status?: unknown };
            };
            const code =
                typeof requestError.code === 'string'
                    ? requestError.code
                    : undefined;
            const status =
                typeof requestError.response?.status === 'number'
                    ? requestError.response.status
                    : undefined;

            if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
                message =
                    'Не вдалося отримати зображення: віддалений сервер не відповів вчасно.';
            } else if (status) {
                message = `Не вдалося отримати зображення: віддалений сервер відповів HTTP ${status}.`;
            }
        }

        return new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'IMAGE_FETCH_FAILED',
            message,
            imageUrl,
        });
    }

    private async deleteImageByFileName(
        fileName: string,
        uploadDir: string,
    ): Promise<boolean> {
        if (!fileName || !uploadDir) {
            return false;
        }

        const safeFileName = path.basename(fileName);
        const uploadDirPath = path.resolve(uploadDir);
        const filePath = path.resolve(uploadDirPath, safeFileName);

        if (!filePath.startsWith(uploadDirPath)) {
            throw new Error('Невірний шлях до файлу');
        }

        try {
            await fs.unlink(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
