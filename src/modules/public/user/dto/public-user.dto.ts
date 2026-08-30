import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';

export class PublicUserActivityQueryDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(50)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(30)
    limit?: number;
}

export class PublicPlaylistImageQueryDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(30)
    limit?: number;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    search?: string;
}

export class CreatePublicPlaylistDto {
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    title: string;

    @IsOptional()
    @IsString()
    @MaxLength(1200)
    description?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    imageId?: number;

    @IsOptional()
    @IsBoolean()
    isPrivate?: boolean;
}

export class CreatePublicPlaylistItemDto {
    @IsInt()
    @Min(1)
    animeId: number;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsBoolean()
    removeFromBookmarks?: boolean;
}

export class UpdatePublicPlaylistDto {
    @IsOptional()
    @IsBoolean()
    isPrivate?: boolean;
}

export class UpdatePublicPlaylistItemDto {
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;
}

export class ReorderPublicPlaylistItemsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @IsInt({ each: true })
    orderedItemIds: number[];
}
