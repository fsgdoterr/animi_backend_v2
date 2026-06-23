import { IsOptional, IsString } from "class-validator";

export class CreatePlayerDto {
    @IsString()
    title: string;
}
