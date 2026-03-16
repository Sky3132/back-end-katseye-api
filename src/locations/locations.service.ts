import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PlaceType = 'country' | 'region' | 'province' | 'city' | 'district';

function normalizeCountryCode(value: unknown) {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

function safeJsonLevels(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  const levels = (value as any).levels;
  if (!Array.isArray(levels)) return [];
  return levels
    .map((l) => ({
      type: typeof l?.type === 'string' ? String(l.type) : '',
      label: typeof l?.label === 'string' ? String(l.label) : '',
      required: Boolean(l?.required),
    }))
    .filter((l) =>
      ['region', 'province', 'city', 'district'].includes(l.type) && l.label,
    );
}

function defaultSchemaLevels() {
  // For countries without a schema row, return no levels.
  // Frontend will then only show levels that actually have seeded children.
  return [];
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma) as any;
  }

  async listCountries() {
    const items = await this.client().place.findMany({
      where: { type: 'country' },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        country_code: true,
        name: true,
        type: true,
        has_children: true,
      },
    });

    return {
      items: (items ?? []).map((p: any) => ({
        id: p.id,
        country_code: p.country_code,
        name: p.name,
        type: p.type,
        has_children: Boolean(p.has_children),
      })),
    };
  }

  async getSchema(countryCode: string) {
    const normalized = normalizeCountryCode(countryCode);
    const row = normalized
      ? await this.client().location_schema.findUnique({
          where: { country_code: normalized },
          select: { country_code: true, levels: true },
        })
      : null;

    return {
      country_code: normalized || countryCode,
      levels: row ? safeJsonLevels(row.levels) : defaultSchemaLevels(),
    };
  }

  async listChildren(input: { parent_id: string; type: PlaceType; limit: number }) {
    const items = await this.client().place.findMany({
      where: { parent_id: input.parent_id, type: input.type },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      take: input.limit,
      select: { id: true, name: true, type: true, has_children: true },
    });

    return {
      items: (items ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        has_children: Boolean(p.has_children),
      })),
    };
  }

  async search(input: {
    country_code: string;
    type: PlaceType;
    q: string;
    limit: number;
  }) {
    const countryCode = normalizeCountryCode(input.country_code);
    const q = input.q.trim();
    const items =
      countryCode && q
        ? await this.client().place.findMany({
            where: {
              country_code: countryCode,
              type: input.type,
              name: { contains: q },
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            take: input.limit,
            select: { id: true, name: true, type: true },
          })
        : [];

    return {
      items: (items ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.type,
      })),
    };
  }

  async listCallingCodes() {
    const items = await this.client().calling_code.findMany({
      orderBy: [{ country_name: 'asc' }],
      select: {
        country_code: true,
        country_name: true,
        calling_code: true,
      },
    });

    return {
      items: (items ?? []).map((c: any) => ({
        country_code: c.country_code,
        country_name: c.country_name,
        calling_code: c.calling_code,
      })),
    };
  }

  async resolveAddressSnapshot(
    tx: Prisma.TransactionClient | undefined,
    input: {
      country_code: string;
      region_id?: string | null;
      province_id?: string | null;
      city_id?: string | null;
      district_id?: string | null;
    },
  ) {
    const countryCode = normalizeCountryCode(input.country_code);
    if (!countryCode) {
      return {
        country_code: null,
        country_name: null,
        region_name: null,
        province_name: null,
        city_name: null,
        district_name: null,
        region_id: null,
        province_id: null,
        city_id: null,
        district_id: null,
      };
    }

    const schema = await this.getSchema(countryCode);
    const required = new Set(
      (schema.levels ?? [])
        .filter((l: any) => l.required)
        .map((l: any) => l.type),
    );

    const ids = {
      region_id: (input.region_id ?? '').trim() || null,
      province_id: (input.province_id ?? '').trim() || null,
      city_id: (input.city_id ?? '').trim() || null,
      district_id: (input.district_id ?? '').trim() || null,
    };

    for (const level of ['region', 'province', 'city', 'district'] as const) {
      if (required.has(level) && !(ids as any)[`${level}_id`]) {
        throw new BadRequestException(
          `${level}_id is required for country ${countryCode}`,
        );
      }
    }

    const countryPlace = await this.client(tx).place.findFirst({
      where: { type: 'country', id: countryCode, country_code: countryCode },
      select: { id: true, name: true },
    });
    if (!countryPlace) {
      throw new BadRequestException(`Unknown country_code: ${countryCode}`);
    }

    const toFetch = Object.values(ids).filter(Boolean) as string[];
    const places = toFetch.length
      ? await this.client(tx).place.findMany({
          where: { id: { in: toFetch } },
          select: { id: true, type: true, parent_id: true, country_code: true, name: true },
        })
      : [];
    const byId = new Map<string, any>((places ?? []).map((p: any) => [p.id, p]));

    const chain: Array<{ type: PlaceType; id: string | null; parent: string }> = [
      { type: 'region', id: ids.region_id, parent: countryCode },
      { type: 'province', id: ids.province_id, parent: ids.region_id ?? '' },
      { type: 'city', id: ids.city_id, parent: ids.province_id ?? '' },
      { type: 'district', id: ids.district_id, parent: ids.city_id ?? '' },
    ];

    for (const link of chain) {
      if (!link.id) continue;
      const place = byId.get(link.id);
      if (!place) {
        throw new BadRequestException(
          `Unknown place id: ${link.id} (please re-select your address)`,
        );
      }
      if (place.type !== link.type) {
        throw new BadRequestException(
          `Place ${link.id} must be type=${link.type}`,
        );
      }
      if (place.country_code !== countryCode) {
        throw new BadRequestException(
          `Place ${link.id} is not in country_code=${countryCode}`,
        );
      }
      if (link.parent && place.parent_id !== link.parent) {
        throw new BadRequestException(
          `Place ${link.id} is not a child of ${link.parent}`,
        );
      }
    }

    return {
      country_code: countryCode,
      country_name: countryPlace.name,
      region_name: ids.region_id ? byId.get(ids.region_id)?.name ?? null : null,
      province_name: ids.province_id ? byId.get(ids.province_id)?.name ?? null : null,
      city_name: ids.city_id ? byId.get(ids.city_id)?.name ?? null : null,
      district_name: ids.district_id ? byId.get(ids.district_id)?.name ?? null : null,
      region_id: ids.region_id,
      province_id: ids.province_id,
      city_id: ids.city_id,
      district_id: ids.district_id,
    };
  }
}
