import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  listForUser(userId: number) {
    return this.prisma.address.findMany({
      where: { user_id: userId },
      orderBy: [{ is_default: 'desc' }, { address_id: 'desc' }],
    });
  }

  async createForUser(userId: number, dto: CreateAddressDto) {
    const snapshot = await this.locations.resolveAddressSnapshot(undefined, {
      country_code: dto.country_code,
      region_id: dto.region_id ?? null,
      province_id: dto.province_id ?? null,
      city_id: dto.city_id ?? null,
      district_id: dto.district_id ?? null,
    });

    const country = snapshot.country_name ?? dto.country ?? '';
    const province = snapshot.province_name ?? dto.province ?? '';
    const city = snapshot.city_name ?? dto.city ?? '';
    const region = snapshot.region_name ?? dto.region ?? null;
    const barangay = snapshot.district_name ?? dto.barangay ?? null;
    const phone_e164 = await this.normalizePhoneToE164(dto.phone, dto.country_code);

    const wantsDefault = dto.is_default === true;

    return this.prisma.$transaction(async (tx) => {
      const existingDefault = await tx.address.findFirst({
        where: { user_id: userId, is_default: true },
        select: { address_id: true },
      });

      const shouldBeDefault = wantsDefault || !existingDefault;
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { user_id: userId, is_default: true },
          data: { is_default: false },
        });
      }

      return tx.address.create({
        data: {
          user_id: userId,
          is_default: shouldBeDefault,
          full_name: dto.full_name,
          email: dto.email,
          phone_e164,
          country,
          region,
          province,
          city,
          barangay,
          zip_code: dto.zip_code,
          street: dto.street,
          country_code: dto.country_code,
          region_id: dto.region_id ?? null,
          province_id: dto.province_id ?? null,
          city_id: dto.city_id ?? null,
          district_id: dto.district_id ?? null,
        },
      });
    });
  }

  async updateForUser(userId: number, addressId: number, dto: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findUnique({
        where: { address_id: addressId },
      });

      if (!existing) {
        throw new NotFoundException('Address not found.');
      }
      if (existing.user_id !== userId) {
        throw new ForbiddenException('You do not have access to this address.');
      }

      const countryCode2 = dto.country_code ?? existing.country_code ?? null;

      const snapshot =
        dto.country_code ||
        dto.region_id ||
        dto.province_id ||
        dto.city_id ||
        dto.district_id
          ? await this.locations.resolveAddressSnapshot(undefined, {
              country_code: dto.country_code ?? existing.country_code ?? 'PH',
              region_id: dto.region_id ?? existing.region_id ?? null,
              province_id: dto.province_id ?? existing.province_id ?? null,
              city_id: dto.city_id ?? existing.city_id ?? null,
              district_id: dto.district_id ?? existing.district_id ?? null,
            })
          : null;

      const phone_e164 =
        dto.phone !== undefined
          ? await this.normalizePhoneToE164(dto.phone, countryCode2)
          : undefined;

      const wantsDefault = dto.is_default === true;
      const wantsNotDefault = dto.is_default === false;

      if (wantsDefault) {
        await tx.address.updateMany({
          where: { user_id: userId, is_default: true },
          data: { is_default: false },
        });
      }

      const updated = await tx.address.update({
        where: { address_id: addressId },
        data: {
          is_default: wantsDefault ? true : wantsNotDefault ? false : undefined,
          full_name: dto.full_name,
          email: dto.email,
          phone_e164,
          street: dto.street,
          zip_code: dto.zip_code,

          country_code: dto.country_code,
          region_id: dto.region_id,
          province_id: dto.province_id,
          city_id: dto.city_id,
          district_id: dto.district_id,

          country: snapshot?.country_name ?? dto.country,
          region: snapshot?.region_name ?? dto.region,
          province: snapshot?.province_name ?? dto.province,
          city: snapshot?.city_name ?? dto.city,
          barangay: snapshot?.district_name ?? dto.barangay,
        },
      });

      if (wantsNotDefault && existing.is_default) {
        const replacement = await tx.address.findFirst({
          where: { user_id: userId, address_id: { not: addressId } },
          orderBy: { address_id: 'desc' },
          select: { address_id: true },
        });
        if (replacement) {
          await tx.address.update({
            where: { address_id: replacement.address_id },
            data: { is_default: true },
          });
        }
      }

      return updated;
    });
  }

  async deleteForUser(userId: number, addressId: number) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findUnique({
        where: { address_id: addressId },
        select: { address_id: true, user_id: true, is_default: true },
      });

      if (!existing) {
        throw new NotFoundException('Address not found.');
      }
      if (existing.user_id !== userId) {
        throw new ForbiddenException('You do not have access to this address.');
      }

      await tx.address.delete({ where: { address_id: addressId } });

      if (existing.is_default) {
        const replacement = await tx.address.findFirst({
          where: { user_id: userId },
          orderBy: { address_id: 'desc' },
          select: { address_id: true },
        });
        if (replacement) {
          await tx.address.update({
            where: { address_id: replacement.address_id },
            data: { is_default: true },
          });
        }
      }

      return { message: 'Address deleted successfully.' };
    });
  }

  async setDefaultForUser(userId: number, addressId: number) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findUnique({
        where: { address_id: addressId },
        select: { address_id: true, user_id: true },
      });

      if (!existing) {
        throw new NotFoundException('Address not found.');
      }
      if (existing.user_id !== userId) {
        throw new ForbiddenException('You do not have access to this address.');
      }

      await tx.address.updateMany({
        where: { user_id: userId, is_default: true },
        data: { is_default: false },
      });

      return tx.address.update({
        where: { address_id: addressId },
        data: { is_default: true },
      });
    });
  }

  private async normalizePhoneToE164(
    input: string | null | undefined,
    countryCode2: string | null,
  ) {
    const value = (input ?? '').trim();
    if (value === '') return null;

    const compact = value.replace(/[^\d+]/g, '');
    if (compact === '' || compact === '+') {
      throw new BadRequestException('Phone number is invalid.');
    }

    if (compact.startsWith('+')) {
      const digits = compact.slice(1).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        throw new BadRequestException('Phone number is invalid.');
      }
      return `+${digits}`;
    }

    if (compact.startsWith('00')) {
      const digits = compact.slice(2).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        throw new BadRequestException('Phone number is invalid.');
      }
      return `+${digits}`;
    }

    const digitsOnly = compact.replace(/\D/g, '');
    if (digitsOnly.length < 6) {
      throw new BadRequestException('Phone number is invalid.');
    }

    const cc = (countryCode2 ?? '').trim().toUpperCase();
    const callingCode =
      cc.length === 2
        ? (await this.prisma.calling_code.findUnique({
            where: { country_code: cc },
            select: { calling_code: true },
          }))?.calling_code ?? null
        : null;

    if (!callingCode) {
      throw new BadRequestException(
        'Phone number must be in E.164 format (example: +639...).',
      );
    }

    let national = digitsOnly;
    if (national.startsWith('0')) national = national.slice(1);

    const e164Digits = `${callingCode}${national}`;
    if (e164Digits.length < 8 || e164Digits.length > 15) {
      throw new BadRequestException('Phone number is invalid.');
    }

    return `+${e164Digits}`;
  }
}
