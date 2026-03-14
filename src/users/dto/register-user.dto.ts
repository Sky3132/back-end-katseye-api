import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email?: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'Username must be a string.' })
  @MinLength(1, { message: 'Username is required.' })
  username?: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString({ message: 'Password must be a string.' })
  @MinLength(6, { message: 'Password must be at least 6 characters.' })
  password!: string;

  @ApiPropertyOptional({ enum: ['user', 'admin'], example: 'user' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(['user', 'admin'], {
    message: 'Role must be either "user" or "admin".',
  })
  role?: 'user' | 'admin';

  @ApiPropertyOptional({
    description: 'Required only when role=admin.',
    example: 'ADMIN_SECRET_KEY_2026',
  })
  @IsOptional()
  @IsString({ message: 'Admin code must be a string.' })
  @MinLength(1, { message: 'Admin code is required for admin registration.' })
  adminCode?: string;
}
