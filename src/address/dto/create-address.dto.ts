import { IsEmail, IsString, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @MaxLength(150)
  full_name!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MaxLength(100)
  country!: string;

  @IsString()
  @MaxLength(100)
  region!: string;

  @IsString()
  @MaxLength(100)
  province!: string;

  @IsString()
  @MaxLength(100)
  city!: string;

  @IsString()
  @MaxLength(100)
  barangay!: string;

  @IsString()
  @MaxLength(20)
  zip_code!: string;

  @IsString()
  @MaxLength(255)
  street!: string;
}
