import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationMode } from './pagination.types';

export class PaginationQueryDto {
    @IsOptional()
    @IsEnum(PaginationMode)
    mode?: PaginationMode;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    cursor?: number;
}

export class SearchPaginationQueryDto extends PaginationQueryDto {
    @IsString()
    @IsOptional()
    search?: string;
}
