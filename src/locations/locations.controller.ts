import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('countries')
  listCountries() {
    return this.locations.listCountries();
  }

  @Get('schema')
  getSchema(@Query('country_code') countryCode?: string) {
    const normalized = String(countryCode ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
      throw new BadRequestException('country_code must be ISO-3166-1 alpha-2.');
    }
    return this.locations.getSchema(normalized);
  }

  @Get('children')
  listChildren(
    @Query('parent_id') parentId?: string,
    @Query('type') type?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const parent_id = String(parentId ?? '').trim();
    if (!parent_id) throw new BadRequestException('parent_id is required.');

    const t = String(type ?? '').trim().toLowerCase();
    if (!['region', 'province', 'city', 'district'].includes(t)) {
      throw new BadRequestException('type must be region|province|city|district.');
    }

    const limitParsed = Number(limitRaw ?? 5000);
    const limit = Number.isFinite(limitParsed)
      ? Math.min(Math.max(Math.trunc(limitParsed), 1), 5000)
      : 5000;

    return this.locations.listChildren({ parent_id, type: t as any, limit });
  }

  @Get('search')
  search(
    @Query('country_code') countryCode?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const normalizedCountry = String(countryCode ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
      throw new BadRequestException('country_code must be ISO-3166-1 alpha-2.');
    }
    const t = String(type ?? '').trim().toLowerCase();
    if (!['country', 'region', 'province', 'city', 'district'].includes(t)) {
      throw new BadRequestException('type must be country|region|province|city|district.');
    }
    const query = String(q ?? '').trim();
    if (!query) throw new BadRequestException('q is required.');
    const limitParsed = Number(limitRaw ?? 20);
    const limit = Number.isFinite(limitParsed)
      ? Math.min(Math.max(Math.trunc(limitParsed), 1), 50)
      : 20;

    return this.locations.search({
      country_code: normalizedCountry,
      type: t as any,
      q: query,
      limit,
    });
  }

  @Get('calling-codes')
  listCallingCodes() {
    return this.locations.listCallingCodes();
  }
}
