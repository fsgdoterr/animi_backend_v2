import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const userSortValues = ['new', 'old', 'username', 'views'] as const;
export type UserSort = (typeof userSortValues)[number];

export class UserFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...userSortValues])
    sort?: UserSort;
}
