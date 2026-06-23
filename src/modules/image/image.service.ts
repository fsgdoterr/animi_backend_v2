import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { join } from 'node:path';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'node:stream';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { ImageFiltersListDto } from './dto/image-filters-list.dto';
import { Image, Prisma } from '../../generated/prisma/client';
import { ImageSelect } from '../../common/orm/image.orm';
import { paginateById } from '../../common/pagination';
import { validateImageUrl } from '../../common/helpers/validate-image-url';
import { normalizeHeader } from '../../common/helpers/normalize-header';

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
            const animeTitleFilter = filters.search
                ? {
                      contains: filters.search,
                      mode: 'insensitive' as const,
                  }
                : undefined;

            const animeSearchWhere = animeTitleFilter
                ? {
                      OR: [
                          { title: animeTitleFilter },
                          { originalTitle: animeTitleFilter },
                          { engTitle: animeTitleFilter },
                      ],
                  }
                : undefined;

            where.OR = animeSearchWhere
                ? [
                      {
                          animes: {
                              some: animeSearchWhere,
                          },
                      },
                      {
                          animeAdditionalImages: {
                              some: animeSearchWhere,
                          },
                      },
                  ]
                : [
                      {
                          animes: {
                              some: {},
                          },
                      },
                      {
                          animeAdditionalImages: {
                              some: {},
                          },
                      },
                  ];
        }

        return paginateById({
            model: this.prisma.image,
            pagination: filters,
            where,
            orderBy: [{ id: 'desc' }],
            select: ImageSelect,
        });
    }

    async createImage(url: string): Promise<Image> {
        let imagePath: string | undefined;
        const uploadDir = join(process.cwd(), 'uploads');

        try {
            imagePath = await this.downloadImageByUrl(url, uploadDir);

            const image = await this.prisma.image.create({
                data: {
                    path: imagePath,
                    sourceUrl: url,
                },
            });
            return image;
        } catch (e) {
            console.log('Load image error', e);
            if (imagePath) {
                await this.deleteImageByFileName(imagePath, uploadDir);
            }
            throw new InternalServerErrorException();
        }
    }

    async deleteImage(id: number): Promise<boolean> {
        try {
            const image = await this.prisma.image.delete({
                where: { id },
            });

            if (!image) return false;

            await this.deleteImageByFileName(
                image.path,
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
                    },
                },
            },
        });
        if (!img) return false;

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
        let url: URL;

        try {
            url = new URL(imageUrl);
        } catch {
            throw new Error('Невірний URL зображення');
        }

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Тільки HTTP/HTTPS URL дозволені');
        }

        await fs.mkdir(uploadDir, { recursive: true });

        const response = await axios.get<ArrayBuffer>(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 15_000,
            validateStatus: (status) => status >= 200 && status < 300,
        });

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
                throw new Error('URL не вказує на зображення');
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

        const fileName = `${randomUUID()}.${ext}`;
        const filePath = path.join(uploadDir, fileName);

        await fs.writeFile(filePath, buffer);

        return fileName;
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
        } catch (error: any) {
            return false;
        }
    }
}
