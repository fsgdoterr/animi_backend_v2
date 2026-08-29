import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const playerSortValues = ['new', 'old', 'title', 'usage'] as const;
export type PlayerSort = (typeof playerSortValues)[number];

export class PlayerFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...playerSortValues])
    sort?: PlayerSort;
}
