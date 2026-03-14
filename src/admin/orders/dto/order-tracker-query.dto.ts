import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const ORDER_TRACKER_TABS = [
  'new',
  'in_progress',
  'awaiting_pickup',
  'dispatched',
  'completed',
  'cancelled',
  'all',
] as const;

export type OrderTrackerTab = (typeof ORDER_TRACKER_TABS)[number];

export class OrderTrackerQueryDto {
  @IsOptional()
  @IsIn(ORDER_TRACKER_TABS)
  tab?: OrderTrackerTab;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}

