import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class FigmaAuthDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  figmaUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;
}
