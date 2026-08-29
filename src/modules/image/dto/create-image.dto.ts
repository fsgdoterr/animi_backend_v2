import { IsBoolean, IsOptional, IsUrl } from 'class-validator';

export class CreateImageDto {
    @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
    url: string;

    @IsOptional()
    @IsBoolean()
    isAvatarAllowed?: boolean;
}
