import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { PaginationQueryDto } from './pagination.dto';
import { PaginatedResult, PaginationMode } from './pagination.types';

export const PAGINATION_EXPOSE_HEADERS =
    'X-Has-More, X-Next-Cursor, X-Page, X-Limit, X-Total-Count, X-TotalPages';

type NormalizedPagination = {
    mode: PaginationMode;
    limit: number;
    page: number;
    cursor?: number;
};

export function normalizePagination(
    pagination: PaginationQueryDto,
): NormalizedPagination {
    const limit = Math.min(pagination.limit ?? 20, 100);

    const mode =
        pagination.mode ??
        (pagination.cursor ? PaginationMode.Cursor : PaginationMode.Page);

    if (mode === PaginationMode.Page && pagination.cursor) {
        throw new BadRequestException(
            'cursor не можна використовувати разом з mode=page',
        );
    }

    if (mode === PaginationMode.Cursor && pagination.page) {
        throw new BadRequestException(
            'page не можна використовувати разом з mode=cursor',
        );
    }

    return {
        mode,
        limit,
        page: pagination.page ?? 1,
        cursor: pagination.cursor,
    };
}

export async function paginateById<TItem extends Record<string, any>>(params: {
    model: any;
    pagination: PaginationQueryDto;
    where: any;
    orderBy: any;
    select: any;
    cursorField?: keyof TItem & string;
}): Promise<PaginatedResult<TItem>> {
    const {
        model,
        pagination,
        where,
        orderBy,
        select,
        cursorField = 'id',
    } = params;

    const { mode, limit, page, cursor } = normalizePagination(pagination);

    if (mode === PaginationMode.Cursor) {
        const items = await model.findMany({
            where,
            orderBy,
            take: limit + 1,

            ...(cursor
                ? {
                      cursor: {
                          [cursorField]: cursor,
                      },
                      skip: 1,
                  }
                : {}),

            select,
        });

        const hasMore = items.length > limit;
        const slicedItems = hasMore ? items.slice(0, limit) : items;
        const lastItem = slicedItems.at(-1);
        const nextCursor = lastItem?.[cursorField] ?? null;

        return {
            items: slicedItems,

            pageInfo: {
                hasMore,
                nextCursor: hasMore ? Number(nextCursor) : null,
            },

            pageMeta: null,
        };
    }

    const skip = (page - 1) * limit;

    const [items, totalCount] = await Promise.all([
        model.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            select,
        }),

        model.count({
            where,
        }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const lastItem = items.at(-1);
    const nextCursor = lastItem?.[cursorField] ?? null;

    return {
        items,

        pageInfo: {
            hasMore,
            nextCursor: hasMore ? Number(nextCursor) : null,
        },

        pageMeta: {
            page,
            limit,
            totalCount,
            totalPages,
        },
    };
}

export function setPaginationHeaders<TItem>(
    res: Response,
    { pageInfo, pageMeta }: PaginatedResult<TItem>,
) {
    res.setHeader('X-Has-More', String(pageInfo.hasMore));
    res.setHeader('X-Next-Cursor', pageInfo.nextCursor ?? '');

    if (!pageMeta) return;

    res.setHeader('X-Page', String(pageMeta.page));
    res.setHeader('X-Limit', String(pageMeta.limit));
    res.setHeader('X-Total-Count', String(pageMeta.totalCount));
    res.setHeader('X-TotalPages', String(pageMeta.totalPages));
}
