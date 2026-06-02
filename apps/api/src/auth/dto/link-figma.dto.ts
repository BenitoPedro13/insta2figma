import { IsString, MinLength } from 'class-validator';

export class LinkFigmaDto {
  @IsString()
  @MinLength(1)
  figmaUserId!: string;
}
