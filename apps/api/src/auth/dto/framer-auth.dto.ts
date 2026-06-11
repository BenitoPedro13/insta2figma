import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class FramerAuthDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  framerUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;
}
