import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateAddressDto } from './create-address.dto';

export class CheckoutOrderDto {
  @IsString()
  @MaxLength(100)
  payment_method!: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'paid'])
  status?: 'pending' | 'paid';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  address_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address?: CreateAddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  courier?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shipping_fee?: number;
}
