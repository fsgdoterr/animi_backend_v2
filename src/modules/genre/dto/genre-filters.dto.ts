import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const genreSortValues = ['new', 'old', 'title', 'anime'] as const;
export type GenreSort = (typeof genreSortValues)[number];

export class GenreFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...genreSortValues])
    sort?: GenreSort;
}
