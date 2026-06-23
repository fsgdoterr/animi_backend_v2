import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { CreateGenreDto } from './dto/create-genre.dto';
import { UpdateGenreDto } from './dto/update-genre.dto';
import { PrismaService } from '../../common/database/prisma/prisma.service';
import { GenreSelect } from '../../common/orm/genre.orm';
import slugify from 'slugify';
import { ImageService } from '../image/image.service';
import { prepareImage } from '../../common/helpers/prepare-image';
import { GenreFiltersDto } from './dto/genre-filters.dto';
import { Prisma } from '../../generated/prisma/client';
import { paginateById } from '../../common/pagination';

@Injectable()
export class GenreService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly imageService: ImageService,
    ) {}

    async create({ title, poster }: CreateGenreDto) {
        const existing = await this.prisma.genre.findFirst({
            where: {
                title: { equals: title, mode: 'insensitive' },
            },
        });

        if (existing)
            throw new BadRequestException('Жанр з такою назвою вже існує');

        let posterImage;

        try {
            const { image, imagePrismaObj } = await prepareImage({
                service: this.imageService,
                image: poster,
            });
            posterImage = image;

            const genre = await this.prisma.genre.create({
                data: {
                    slug: await this.generateUniqueSlug(title),
                    title,
                    poster: imagePrismaObj,
                },
                select: GenreSelect,
            });

            return genre;
        } catch (e) {
            if (posterImage) {
                this.imageService.deleteImageIfUnused(posterImage.id);
            }

            throw new InternalServerErrorException();
        }
    }

    async findAll(filters: GenreFiltersDto) {
        const where: Prisma.GenreWhereInput = {};

        if (filters.search) {
            where.OR = [
                { title: { contains: filters.search, mode: 'insensitive' } },
            ];
        }

        return paginateById({
            model: this.prisma.genre,
            pagination: filters,
            where,
            orderBy: [{ id: 'desc' }],
            select: GenreSelect,
        });
    }

    async findOne(id: number) {
        const genre = await this.prisma.genre.findFirst({
            where: { id },
            select: GenreSelect,
        });
        if (!genre) throw new NotFoundException('Не існує жанру з таким айді.');

        return genre;
    }

    async update(id: number, { title, poster }: UpdateGenreDto) {
        const existing = await this.prisma.genre.findFirst({
            where: { id },
            select: GenreSelect,
        });
        if (!existing)
            throw new NotFoundException('Не існує жанру з таким айді.');

        let posterImage;
        try {
            const { image, imagePrismaObj } = await prepareImage({
                service: this.imageService,
                image: poster,
            });
            posterImage = image;

            const updated = await this.prisma.genre.update({
                where: { id },
                data: {
                    title,
                    slug: title && (await this.generateUniqueSlug(title)),
                    poster: imagePrismaObj,
                },
                select: GenreSelect,
            });
            if (existing.poster) {
                this.imageService.deleteImageIfUnused(existing.poster.id);
            }

            return updated;
        } catch (e) {
            if (posterImage) {
                this.imageService.deleteImageIfUnused(posterImage.id);
            }

            throw new InternalServerErrorException();
        }
    }

    async remove(id: number) {
        const existing = await this.prisma.genre.findFirst({
            where: { id },
            select: GenreSelect,
        });
        if (!existing)
            throw new NotFoundException('Не існує жанру з таким айді.');

        await this.prisma.genre.delete({ where: { id } });
        if (existing.poster)
            await this.imageService.deleteImageIfUnused(existing.poster.id);

        return;
    }

    async generateUniqueSlug(title: string) {
        const baseSlug = slugify(title, {
            lower: true,
            strict: true,
            trim: true,
        });

        let slug = baseSlug;
        let counter = 2;

        while (true) {
            const existing = await this.prisma.genre.findUnique({
                where: { slug },
                select: { id: true },
            });

            if (!existing) {
                return slug;
            }

            slug = `${baseSlug}-${counter}`;
            counter++;
        }
    }
}
