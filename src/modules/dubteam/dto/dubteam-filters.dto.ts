import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const dubTeamSortValues = ['new', 'old', 'title', 'usage'] as const;
export type DubTeamSort = (typeof dubTeamSortValues)[number];

export class DubTeamFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...dubTeamSortValues])
    sort?: DubTeamSort;
}
