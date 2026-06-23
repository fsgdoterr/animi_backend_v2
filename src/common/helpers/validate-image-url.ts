import { BadRequestException } from '@nestjs/common';

export const validateImageUrl = (rawUrl: string): URL => {
    let url: URL;

    try {
        url = new URL(rawUrl);
    } catch {
        throw new BadRequestException('Invalid image url');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadRequestException('Only HTTP and HTTPS urls are allowed');
    }

    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

    if (blockedHosts.includes(url.hostname)) {
        throw new BadRequestException('This host is not allowed');
    }

    return url;
};
