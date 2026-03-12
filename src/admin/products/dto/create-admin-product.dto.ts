import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateProductVariantDto } from './create-product-variant.dto';

export class CreateAdminProductDto {
  @ValidateIf((o) => !o.product_name)
  @IsString()
  @MaxLength(150)
  title?: string;

  @ValidateIf((o) => !o.title)
  @IsString()
  @MaxLength(150)
  product_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  image_url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return trimmed
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      }
    }
    return value;
  })
  images?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imgsrc?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ValidateIf((o) => o.current_stock == null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ValidateIf((o) => o.stock == null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  current_stock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];
}
