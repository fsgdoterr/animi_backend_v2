import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateCodeDto {
    @IsInt()
    @Min(1)
    animeId: number;

    @IsString()
    @MinLength(1)
    code: string;
}
