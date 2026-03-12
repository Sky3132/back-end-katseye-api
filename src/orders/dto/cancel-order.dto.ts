import { IsIn, IsOptional, IsString } from 'class-validator';

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @IsIn(['cancelled'])
  status?: 'cancelled';
}

