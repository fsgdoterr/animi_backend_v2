import { PartialType } from '@nestjs/mapped-types';
import { CreateDubteamDto } from './create-dubteam.dto';

export class UpdateDubteamDto extends PartialType(CreateDubteamDto) {}
