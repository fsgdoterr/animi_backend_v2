import { IsIn, IsOptional, IsString } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../../common/pagination';

const publicAnimeSortValues = ['new', 'old', 'title', 'release', 'views'] as const;
export type PublicAnimeSort = (typeof publicAnimeSortValues)[number];

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
    @IsIn([...publicAnimeSortValues])
    sort?: PublicAnimeSort;
}
