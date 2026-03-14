import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'T-Shirts' })
  @IsString()
  @MaxLength(100)
  category_name!: string;

  @ApiPropertyOptional({
    example: 1,
    nullable: true,
    description: 'Parent category id (for subcategories).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return value;
    if (value === '') return undefined;
    return Number(value);
  })
  @IsInt()
  @Min(1)
  parent_category_id?: number | null;
}
