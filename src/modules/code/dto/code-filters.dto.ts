import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const codeSortValues = [
    'new',
    'old',
    'code',
    'anime',
    'views',
] as const;

export type CodeSort = (typeof codeSortValues)[number];

export class CodeFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...codeSortValues])
    sort?: CodeSort;
}
