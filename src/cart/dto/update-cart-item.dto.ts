import { Transform, Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @Transform(({ value, obj }) => value ?? obj?.qty ?? obj?.count)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
