import { IsString, MinLength } from 'class-validator';

export class LinkFramerDto {
  @IsString()
  @MinLength(1)
  framerUserId!: string;
}
