import {
    IsEmail,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { UserPermissions, UserRole } from '../../../generated/prisma/enums';
import { IsImageRef } from '../../../common/decorators/is-image-ref.decorator';

export class CreateUserDto {
    @IsString()
    @MinLength(4)
    @MaxLength(40)
    username: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    @MaxLength(40)
    password: string;

    @IsString()
    @IsOptional()
    displayName: string;

    @IsNumber()
    @IsOptional()
    avatar: number | null;

    @IsOptional()
    @IsEnum(UserRole)
    role: UserRole;
    
    @IsOptional()
    @IsEnum(UserPermissions, { each: true })
    permissions: UserPermissions[];
}
