import { IsIn, IsOptional, IsString } from 'class-validator';
import { SearchPaginationQueryDto } from '../../../common/pagination';

export const animeSortValues = [
    'new',
    'old',
    'title',
    'release',
    'views',
] as const;

export type AnimeSort = (typeof animeSortValues)[number];

export const animeIssueValues = [
    'missingPoster',
    'missingDescription',
    'withoutEpisodes',
    'withoutActiveVariant',
] as const;

export type AnimeIssue = (typeof animeIssueValues)[number];

export class AnimeFiltersDto extends SearchPaginationQueryDto {
    @IsOptional()
    @IsString()
    genres?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    type?: string;

    @IsOptional()
    @IsIn([...animeSortValues])
    sort?: AnimeSort;

    @IsOptional()
    @IsIn([...animeIssueValues])
    issue?: AnimeIssue;
}
