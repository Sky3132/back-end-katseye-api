import { Transform, Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class AddCartItemDto {
  @Transform(({ value, obj }) => value ?? obj?.productId ?? obj?.productID)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id!: number;

  @Transform(({ value, obj }) => value ?? obj?.qty ?? obj?.count)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
