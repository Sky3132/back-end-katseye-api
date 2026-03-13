import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'T-Shirts' })
  @IsString()
  @MaxLength(100)
  category_name!: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Parent category id (for subcategories).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_category_id?: number;
}
