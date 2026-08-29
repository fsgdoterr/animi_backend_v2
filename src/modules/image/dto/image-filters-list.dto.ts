import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const imageUsageValues = [
    'all',
    'anime',
    'genre',
    'avatar',
    'unused',
] as const;
export type ImageUsage = (typeof imageUsageValues)[number];

export const imageSortValues = ['new', 'old'] as const;
export type ImageSort = (typeof imageSortValues)[number];

export class ImageFiltersListDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsIn([...imageUsageValues])
    usage?: ImageUsage;

    @IsOptional()
    @IsIn(['true', 'false'])
    avatarAllowed?: 'true' | 'false';

    @IsOptional()
    @IsIn([...imageSortValues])
    sort?: ImageSort;
}
