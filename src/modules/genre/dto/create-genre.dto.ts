import { IsOptional, IsString } from "class-validator";
import { IsImageRef } from "../../../common/decorators/is-image-ref.decorator";

export class CreateGenreDto {
    @IsString()
    title: string;

    @IsImageRef()
    @IsOptional()
    poster: string | number | null;
}
