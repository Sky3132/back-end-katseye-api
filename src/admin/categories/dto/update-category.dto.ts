import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'T-Shirts' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category_name?: string;

  @ApiPropertyOptional({
    example: 1,
    nullable: true,
    description:
      'Set to a category id to make it a subcategory; set null to make it a top-level category.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_category_id?: number | null;
}
