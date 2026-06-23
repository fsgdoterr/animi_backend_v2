import { Header } from '@nestjs/common';
import { PAGINATION_EXPOSE_HEADERS } from './pagination.helpers';

export const ExposePaginationHeaders = () =>
    Header('Access-Control-Expose-Headers', PAGINATION_EXPOSE_HEADERS);
