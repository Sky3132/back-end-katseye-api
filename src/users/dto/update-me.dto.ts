import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Jane Dela Cruz' })
  @IsOptional()
  @IsString({ message: 'Full name must be a string.' })
  @MaxLength(150, { message: 'Full name is too long.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  full_name?: string;

  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString({ message: 'Name must be a string.' })
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(150, { message: 'Name is too long.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(150, { message: 'Email is too long.' })
  email?: string;

  @ApiPropertyOptional({ example: '+639123456789' })
  @IsOptional()
  @IsString({ message: 'Phone must be a string.' })
  @MaxLength(32, { message: 'Phone is too long.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phone_e164?: string;
}

