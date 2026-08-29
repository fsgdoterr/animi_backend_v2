import { PartialType } from '@nestjs/mapped-types';
import { EpisodeInputDto } from './create-episode.dto';

export class UpdateEpisodeDto extends PartialType(EpisodeInputDto) {}
