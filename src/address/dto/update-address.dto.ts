import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateAddressDto {
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  full_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barangay?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  province_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  city_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  district_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zip_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  street?: string;
}
