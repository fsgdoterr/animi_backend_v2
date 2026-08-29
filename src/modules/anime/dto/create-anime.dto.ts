import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import {
    AnimeRating,
    AnimeStatus,
    AnimeType,
} from '../../../generated/prisma/enums';
import { IsImageRef } from '../../../common/decorators/is-image-ref.decorator';

export class CreateAnimeDto {
    @IsString()
    title: string;

    @IsString()
    @IsOptional()
    originalTitle?: string | null;

    @IsString()
    @IsOptional()
    engTitle?: string | null;

    @IsImageRef()
    @IsOptional()
    poster?: string | number | null;

    @IsImageRef({ each: true })
    @IsOptional()
    additionalImages?: (string | number | null)[];

    @IsEnum(AnimeRating)
    @IsOptional()
    rating?: AnimeRating | null;

    @IsString()
    @IsOptional()
    description?: string | null;

    @IsString()
    @IsOptional()
    country?: string | null;

    @IsString({ each: true })
    @IsOptional()
    genres?: string[];

    @IsString({ each: true })
    @IsOptional()
    producers?: string[];

    @IsInt()
    @Min(1)
    @IsOptional()
    relatedAnimeId?: number | null;

    @IsDateString()
    @IsOptional()
    releaseDate?: string | null;

    @IsDateString()
    @IsOptional()
    endDate?: string | null;

    @IsInt()
    @Min(0)
    @IsOptional()
    episodesTotal?: number | null;

    @IsInt()
    @Min(0)
    @IsOptional()
    seasonNumber?: number | null;

    @IsInt()
    @Min(0)
    @IsOptional()
    partNumber?: number | null;

    @IsInt()
    @Min(0)
    @IsOptional()
    duration?: number | null;

    @IsEnum(AnimeType)
    type: AnimeType;

    @IsEnum(AnimeStatus)
    @IsOptional()
    status?: AnimeStatus;

    @IsString()
    @IsOptional()
    studio?: string | null;

    @IsString()
    @IsOptional()
    mal?: string | null;

    @IsString()
    @IsOptional()
    al?: string | null;
}
