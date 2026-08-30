import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsInt,
    IsOptional,
    Min,
    ValidateNested,
} from 'class-validator';

export class HomeSliderItemDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    animeId: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    imageId?: number | null;
}

export class UpdateHomeSliderDto {
    @IsArray()
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => HomeSliderItemDto)
    items: HomeSliderItemDto[];
}
