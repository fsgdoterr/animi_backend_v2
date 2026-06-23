import { IsString } from "class-validator";

export class CreateDubteamDto {
    @IsString()
    title: string;
}
