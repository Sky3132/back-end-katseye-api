import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { Prisma, PrismaClient } from '@prisma/client';

type CountryRow = { isoCode: string; name: string };
type StateRow = { countryCode: string; isoCode: string; name: string };
type CityRow = { countryCode: string; stateCode: string; name: string; latitude?: string; longitude?: string };

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DATABASE_HOST!,
      user: process.env.DATABASE_USER!,
      password: process.env.DATABASE_PASSWORD!,
      database: process.env.DATABASE_NAME!,
      port: Number(process.env.DATABASE_PORT) || 3306,
      connectionLimit: 5,
    }),
  });
}

function normalizeCountryCode(input: unknown) {
  const s = typeof input === 'string' ? input.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

function hash32Hex(input: string) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function regionId(countryCode: string, stateIso: string) {
  // place.id is VARCHAR(64)
  return `${countryCode}-${stateIso}`.slice(0, 64);
}

function cityId(countryCode: string, stateIso: string, city: CityRow) {
  const h = hash32Hex(
    `${city.name}|${city.latitude ?? ''}|${city.longitude ?? ''}`,
  );
  return `${countryCode}-${stateIso}-${h}`.slice(0, 64);
}

async function main() {
  // Lazy require so builds still work even if the package is not installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const csc = require('country-state-city') as {
    Country: { getAllCountries(): CountryRow[] };
    State: { getAllStates(): StateRow[] };
    City: { getAllCities(): CityRow[] };
  };

  const prisma = createPrismaClient();
  try {
    const countries = (csc.Country.getAllCountries() ?? [])
      .map((c) => ({ code: normalizeCountryCode(c.isoCode), name: String(c.name ?? '').trim() }))
      .filter((c) => c.code && c.name);

    // Countries already exist from iso3166 seed, but keep it idempotent.
    for (const c of countries) {
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO \`place\`
            (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
          VALUES
            (${c.code}, 'country', NULL, ${c.code}, ${c.name}, NULL, 1, 0)
          ON DUPLICATE KEY UPDATE
            \`type\`='country',
            \`parent_id\`=NULL,
            \`country_code\`=VALUES(\`country_code\`),
            \`name\`=VALUES(\`name\`),
            \`has_children\`=VALUES(\`has_children\`),
            \`sort_order\`=VALUES(\`sort_order\`)
        `,
      );
    }

    // Insert schema for countries (skip PH because it uses PSGC levels).
    const defaultLevels = {
      levels: [
        { type: 'region', label: 'State / Province', required: true },
        { type: 'city', label: 'City', required: true },
      ],
    };
    for (const c of countries) {
      if (c.code === 'PH') continue;
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO \`location_schema\` (\`country_code\`, \`levels\`)
          VALUES (${c.code}, ${JSON.stringify(defaultLevels)})
          ON DUPLICATE KEY UPDATE \`levels\`=\`levels\`
        `,
      );
    }

    const states = (csc.State.getAllStates() ?? [])
      .map((s) => ({
        countryCode: normalizeCountryCode(s.countryCode),
        stateIso: String(s.isoCode ?? '').trim().toUpperCase(),
        name: String(s.name ?? '').trim(),
      }))
      .filter((s) => s.countryCode && s.stateIso && s.name);

    for (const s of states) {
      if (s.countryCode === 'PH') continue;
      const id = regionId(s.countryCode, s.stateIso);
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO \`place\`
            (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
          VALUES
            (${id}, 'region', ${s.countryCode}, ${s.countryCode}, ${s.name}, NULL, 1, 0)
          ON DUPLICATE KEY UPDATE
            \`type\`='region',
            \`parent_id\`=VALUES(\`parent_id\`),
            \`country_code\`=VALUES(\`country_code\`),
            \`name\`=VALUES(\`name\`),
            \`has_children\`=VALUES(\`has_children\`),
            \`sort_order\`=VALUES(\`sort_order\`)
        `,
      );
    }

    const cities = (csc.City.getAllCities() ?? [])
      .map((c) => ({
        countryCode: normalizeCountryCode(c.countryCode),
        stateIso: String(c.stateCode ?? '').trim().toUpperCase(),
        name: String(c.name ?? '').trim(),
        latitude: c.latitude,
        longitude: c.longitude,
      }))
      .filter((c) => c.countryCode && c.stateIso && c.name);

    for (const c of cities) {
      if (c.countryCode === 'PH') continue;
      const parent = regionId(c.countryCode, c.stateIso);
      const id = cityId(c.countryCode, c.stateIso, {
        countryCode: c.countryCode,
        stateCode: c.stateIso,
        name: c.name,
        latitude: c.latitude,
        longitude: c.longitude,
      });
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO \`place\`
            (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
          VALUES
            (${id}, 'city', ${parent}, ${c.countryCode}, ${c.name}, NULL, 0, 0)
          ON DUPLICATE KEY UPDATE
            \`type\`='city',
            \`parent_id\`=VALUES(\`parent_id\`),
            \`country_code\`=VALUES(\`country_code\`),
            \`name\`=VALUES(\`name\`),
            \`has_children\`=VALUES(\`has_children\`),
            \`sort_order\`=VALUES(\`sort_order\`)
        `,
      );
    }

    console.log(`Seeded: ${countries.length} countries, ${states.length} states, ${cities.length} cities (excluding PH).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

