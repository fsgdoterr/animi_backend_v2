import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { CommentReactionType } from '../../../../generated/prisma/enums';

export class CreatePublicCommentDto {
    @IsString()
    @MaxLength(4000)
    text: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    parentId?: number;
}

export class RatePublicAnimeDto {
    @IsInt()
    @Min(1)
    @Max(5)
    rating: number;
}

export class ReactPublicCommentDto {
    @IsEnum(CommentReactionType)
    type: CommentReactionType;
}
