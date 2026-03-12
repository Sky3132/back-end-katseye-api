import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(userId: number) {
    return this.prisma.address.findMany({
      where: { user_id: userId },
      orderBy: { address_id: 'desc' },
    });
  }

  createForUser(userId: number, dto: CreateAddressDto) {
    return this.prisma.address.create({
      data: {
        user_id: userId,
        full_name: dto.full_name,
        email: dto.email,
        country: dto.country,
        region: dto.region,
        province: dto.province,
        city: dto.city,
        barangay: dto.barangay,
        zip_code: dto.zip_code,
        street: dto.street,
      },
    });
  }
}

