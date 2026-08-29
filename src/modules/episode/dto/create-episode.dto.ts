import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import {
    DubType,
    EpisodeSourceType,
} from '../../../generated/prisma/enums';

export class CreateEpisodeVariantDto {
    @IsEnum(EpisodeSourceType)
    sourceType: EpisodeSourceType;

    @IsString()
    endpoint: string;

    @IsEnum(DubType)
    dubType: DubType;

    @IsInt()
    @Min(1)
    dubTeamId: number;

    @IsInt()
    @Min(1)
    playerId: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}

export class EpisodeInputDto {
    @IsInt()
    @Min(1)
    number: number;

    @IsString()
    @IsOptional()
    title?: string | null;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateEpisodeVariantDto)
    @IsOptional()
    variants?: CreateEpisodeVariantDto[];
}

export class CreateEpisodeDto extends EpisodeInputDto {
    @IsInt()
    @Min(1)
    animeId: number;
}

export class ReplaceAnimeEpisodesDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => EpisodeInputDto)
    episodes: EpisodeInputDto[];
}
