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
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(1)
  username?: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({ enum: ['user', 'admin'], example: 'user' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @ApiPropertyOptional({
    description: 'Required only when role=admin.',
    example: 'ADMIN_SECRET_KEY_2026',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  adminCode?: string;
}
