import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../../common/pagination';

const publicAnimeSortValues = ['new', 'old', 'title', 'release', 'popular'] as const;
export type PublicAnimeSort = (typeof publicAnimeSortValues)[number];

const releaseBoundaryPattern = /^\d{4}(?:-\d{2}-\d{2})?$/;

export class PublicAnimeFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    type?: string;

    @IsOptional()
    @IsString()
    genres?: string;

    @IsOptional()
    @IsString()
    excludeGenres?: string;

    @IsOptional()
    @IsString()
    ratings?: string;

    @IsOptional()
    @IsString()
    countries?: string;

    @IsOptional()
    @IsString()
    studios?: string;

    @IsOptional()
    @IsString()
    producers?: string;

    @IsOptional()
    @IsString()
    dubTeams?: string;

    @IsOptional()
    @IsString()
    dubTypes?: string;

    // Accepts the old YYYY format as well as an exact UTC date boundary.
    // Full dates make it possible to filter by anime season without adding
    // season-specific columns to the database.
    @IsOptional()
    @IsString()
    @Matches(releaseBoundaryPattern)
    releaseFrom?: string;

    @IsOptional()
    @IsString()
    @Matches(releaseBoundaryPattern)
    releaseTo?: string;

    @IsOptional()
    @IsIn([...publicAnimeSortValues])
    sort?: PublicAnimeSort;
}
