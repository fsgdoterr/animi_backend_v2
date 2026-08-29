import { IsBoolean } from 'class-validator';

export class UpdateImageDto {
    @IsBoolean()
    isAvatarAllowed: boolean;
}
