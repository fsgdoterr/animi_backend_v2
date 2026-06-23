export enum PaginationMode {
    Page = 'page',
    Cursor = 'cursor',
}

export type PaginationPageInfo = {
    hasMore: boolean;
    nextCursor: number | null;
};

export type PaginationPageMeta = {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
};

export type PaginatedResult<T> = {
    items: T[];
    pageInfo: PaginationPageInfo;
    pageMeta: PaginationPageMeta | null;
};
