import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MaxLength(150)
  product_name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

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

  @IsString()
  @MaxLength(1000)
  imgsrc?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;
}
