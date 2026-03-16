import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

type IsoMap = Record<string, string>;
type CallingCodeRow = {
  country_code: string;
  country_name?: string;
  calling_code: string;
};

function dataPath(fileName: string) {
  return path.join(__dirname, 'data', fileName);
}

function tryReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function normalizeCountryCode(value: unknown) {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

function normalizeCallingCode(value: unknown) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  // Normalize "+1-242" -> "+1242" for prefix matching on frontend.
  return s.replace(/[\s\-]/g, '');
}

export async function seedLocations(prisma: PrismaClient) {
  // Requires these tables to exist in the DB:
  // - place
  // - location_schema
  // - calling_code
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM \`place\` LIMIT 1`);
    await prisma.$queryRaw(
      Prisma.sql`SELECT 1 FROM \`location_schema\` LIMIT 1`,
    );
    await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM \`calling_code\` LIMIT 1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown database error';
    throw new Error(
      `Locations seed failed: required tables are missing. Run \`node scripts/apply_locations_and_snapshots.js\` (if present) or apply migrations. Root error: ${msg}`,
    );
  }

  const isoMap = tryReadJson<IsoMap>(dataPath('iso3166-alpha2.json')) ?? {};
  const countries = Object.entries(isoMap)
    .map(([code, name]) => ({
      country_code: normalizeCountryCode(code),
      name: String(name ?? '').trim(),
    }))
    .filter((c) => c.country_code && c.name);

  for (const c of countries) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`place\`
          (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
        VALUES
          (${c.country_code}, 'country', NULL, ${c.country_code}, ${c.name}, NULL, 1, 0)
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

  const phLevels = {
    levels: [
      { type: 'region', label: 'Region', required: true },
      { type: 'province', label: 'Province', required: true },
      { type: 'city', label: 'City', required: true },
      { type: 'district', label: 'Barangay', required: false },
    ],
  };
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO \`location_schema\` (\`country_code\`, \`levels\`)
      VALUES ('PH', ${JSON.stringify(phLevels)})
      ON DUPLICATE KEY UPDATE \`levels\`=VALUES(\`levels\`)
    `,
  );

  // Seed a simplified PH hierarchy (5 macro-regions) so the dropdown is short.
  // id format is arbitrary; only parent_id chain and type must be consistent.
  const phRegions: Array<{ id: string; name: string; sort_order: number }> = [
    { id: 'PH-REG-NCR', name: 'Metro Manila', sort_order: 1 },
    { id: 'PH-REG-NL', name: 'North Luzon', sort_order: 2 },
    { id: 'PH-REG-SL', name: 'South Luzon', sort_order: 3 },
    { id: 'PH-REG-VIS', name: 'Visayas', sort_order: 4 },
    { id: 'PH-REG-MIN', name: 'Mindanao', sort_order: 5 },
  ];

  // Remove older PH region rows so the dropdown stays short.
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM \`place\`
      WHERE \`country_code\`='PH'
        AND \`type\`='region'
        AND \`parent_id\`='PH'
        AND \`id\` NOT IN (${Prisma.join(phRegions.map((r) => r.id))})
    `,
  );

  for (const r of phRegions) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`place\`
          (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
        VALUES
          (${r.id}, 'region', 'PH', 'PH', ${r.name}, NULL, 1, ${r.sort_order})
        ON DUPLICATE KEY UPDATE
          \`type\`='region',
          \`parent_id\`='PH',
          \`country_code\`='PH',
          \`name\`=VALUES(\`name\`),
          \`has_children\`=VALUES(\`has_children\`),
          \`sort_order\`=VALUES(\`sort_order\`)
      `,
    );
  }

  // Provinces: keep NCR/Visayas examples, and seed Mindanao provinces more completely.
  const phProvinces = [
    { id: 'PH-PROV-NCR', name: 'Metro Manila', parent_id: 'PH-REG-NCR', sort_order: 1 },
    // Visayas (sample provinces; add more later if needed)
    { id: 'PH-PROV-CEB', name: 'Cebu', parent_id: 'PH-REG-VIS', sort_order: 2 },
    { id: 'PH-PROV-BOH', name: 'Bohol', parent_id: 'PH-REG-VIS', sort_order: 3 },
    { id: 'PH-PROV-ILO', name: 'Iloilo', parent_id: 'PH-REG-VIS', sort_order: 4 },
    { id: 'PH-PROV-LEY', name: 'Leyte', parent_id: 'PH-REG-VIS', sort_order: 5 },
    { id: 'PH-PROV-NEGO', name: 'Negros Occidental', parent_id: 'PH-REG-VIS', sort_order: 6 },
    { id: 'PH-PROV-NEGE', name: 'Negros Oriental', parent_id: 'PH-REG-VIS', sort_order: 7 },
    { id: 'PH-PROV-AKL', name: 'Aklan', parent_id: 'PH-REG-VIS', sort_order: 8 },
    { id: 'PH-PROV-WSA', name: 'Western Samar', parent_id: 'PH-REG-VIS', sort_order: 9 },

    // North Luzon (sample provinces)
    { id: 'PH-PROV-ILN', name: 'Ilocos Norte', parent_id: 'PH-REG-NL', sort_order: 40 },
    { id: 'PH-PROV-ILS', name: 'Ilocos Sur', parent_id: 'PH-REG-NL', sort_order: 41 },
    { id: 'PH-PROV-LUN', name: 'La Union', parent_id: 'PH-REG-NL', sort_order: 42 },
    { id: 'PH-PROV-PAN', name: 'Pangasinan', parent_id: 'PH-REG-NL', sort_order: 43 },
    { id: 'PH-PROV-CAG', name: 'Cagayan', parent_id: 'PH-REG-NL', sort_order: 44 },
    { id: 'PH-PROV-ISA', name: 'Isabela', parent_id: 'PH-REG-NL', sort_order: 45 },
    { id: 'PH-PROV-BEN', name: 'Benguet', parent_id: 'PH-REG-NL', sort_order: 46 },

    // South Luzon (sample provinces)
    { id: 'PH-PROV-CAV', name: 'Cavite', parent_id: 'PH-REG-SL', sort_order: 60 },
    { id: 'PH-PROV-LAG', name: 'Laguna', parent_id: 'PH-REG-SL', sort_order: 61 },
    { id: 'PH-PROV-BTG', name: 'Batangas', parent_id: 'PH-REG-SL', sort_order: 62 },
    { id: 'PH-PROV-QUE', name: 'Quezon', parent_id: 'PH-REG-SL', sort_order: 63 },
    { id: 'PH-PROV-RIZ', name: 'Rizal', parent_id: 'PH-REG-SL', sort_order: 64 },
    { id: 'PH-PROV-ALB', name: 'Albay', parent_id: 'PH-REG-SL', sort_order: 65 },
    { id: 'PH-PROV-CAMS', name: 'Camarines Sur', parent_id: 'PH-REG-SL', sort_order: 66 },

    // Mindanao provinces (connected under PH-REG-MIN)
    { id: 'PH-PROV-AGN', name: 'Agusan del Norte', parent_id: 'PH-REG-MIN', sort_order: 10 },
    { id: 'PH-PROV-AGS', name: 'Agusan del Sur', parent_id: 'PH-REG-MIN', sort_order: 11 },
    { id: 'PH-PROV-BAS', name: 'Basilan', parent_id: 'PH-REG-MIN', sort_order: 12 },
    { id: 'PH-PROV-BUK', name: 'Bukidnon', parent_id: 'PH-REG-MIN', sort_order: 13 },
    { id: 'PH-PROV-CAM', name: 'Camiguin', parent_id: 'PH-REG-MIN', sort_order: 14 },
    { id: 'PH-PROV-DAVO', name: 'Davao de Oro', parent_id: 'PH-REG-MIN', sort_order: 15 },
    { id: 'PH-PROV-DAVN', name: 'Davao del Norte', parent_id: 'PH-REG-MIN', sort_order: 16 },
    { id: 'PH-PROV-DAVS', name: 'Davao del Sur', parent_id: 'PH-REG-MIN', sort_order: 17 },
    { id: 'PH-PROV-DAVW', name: 'Davao Occidental', parent_id: 'PH-REG-MIN', sort_order: 18 },
    { id: 'PH-PROV-DAVE', name: 'Davao Oriental', parent_id: 'PH-REG-MIN', sort_order: 19 },
    { id: 'PH-PROV-DIN', name: 'Dinagat Islands', parent_id: 'PH-REG-MIN', sort_order: 20 },
    { id: 'PH-PROV-LAN', name: 'Lanao del Norte', parent_id: 'PH-REG-MIN', sort_order: 21 },
    { id: 'PH-PROV-LAS', name: 'Lanao del Sur', parent_id: 'PH-REG-MIN', sort_order: 22 },
    { id: 'PH-PROV-MGN', name: 'Maguindanao del Norte', parent_id: 'PH-REG-MIN', sort_order: 23 },
    { id: 'PH-PROV-MGS', name: 'Maguindanao del Sur', parent_id: 'PH-REG-MIN', sort_order: 24 },
    { id: 'PH-PROV-MOC', name: 'Misamis Occidental', parent_id: 'PH-REG-MIN', sort_order: 25 },
    { id: 'PH-PROV-MOR', name: 'Misamis Oriental', parent_id: 'PH-REG-MIN', sort_order: 26 },
    { id: 'PH-PROV-NCO', name: 'Cotabato', parent_id: 'PH-REG-MIN', sort_order: 27 },
    { id: 'PH-PROV-SAR', name: 'Sarangani', parent_id: 'PH-REG-MIN', sort_order: 28 },
    { id: 'PH-PROV-SCO', name: 'South Cotabato', parent_id: 'PH-REG-MIN', sort_order: 29 },
    { id: 'PH-PROV-SUK', name: 'Sultan Kudarat', parent_id: 'PH-REG-MIN', sort_order: 30 },
    { id: 'PH-PROV-SUL', name: 'Sulu', parent_id: 'PH-REG-MIN', sort_order: 31 },
    { id: 'PH-PROV-SUN', name: 'Surigao del Norte', parent_id: 'PH-REG-MIN', sort_order: 32 },
    { id: 'PH-PROV-SUS', name: 'Surigao del Sur', parent_id: 'PH-REG-MIN', sort_order: 33 },
    { id: 'PH-PROV-TWT', name: 'Tawi-Tawi', parent_id: 'PH-REG-MIN', sort_order: 34 },
    { id: 'PH-PROV-ZAN', name: 'Zamboanga del Norte', parent_id: 'PH-REG-MIN', sort_order: 35 },
    { id: 'PH-PROV-ZAS', name: 'Zamboanga del Sur', parent_id: 'PH-REG-MIN', sort_order: 36 },
    { id: 'PH-PROV-ZSI', name: 'Zamboanga Sibugay', parent_id: 'PH-REG-MIN', sort_order: 37 },
  ];
  for (const p of phProvinces) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`place\`
          (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
        VALUES
          (${p.id}, 'province', ${p.parent_id}, 'PH', ${p.name}, NULL, 1, ${p.sort_order})
        ON DUPLICATE KEY UPDATE
          \`type\`='province',
          \`parent_id\`=VALUES(\`parent_id\`),
          \`country_code\`='PH',
          \`name\`=VALUES(\`name\`),
          \`has_children\`=VALUES(\`has_children\`),
          \`sort_order\`=VALUES(\`sort_order\`)
      `,
    );
  }

  // Cities: at least one per province so the cascade always works.
  const phCities = [
    { id: 'PH-CITY-MNL', name: 'Manila', parent_id: 'PH-PROV-NCR', sort_order: 1 },
    { id: 'PH-CITY-QC', name: 'Quezon City', parent_id: 'PH-PROV-NCR', sort_order: 2 },
    { id: 'PH-CITY-CEBU', name: 'Cebu City', parent_id: 'PH-PROV-CEB', sort_order: 3 },
    // Visayas samples
    { id: 'PH-CITY-TAGB', name: 'Tagbilaran City', parent_id: 'PH-PROV-BOH', sort_order: 4 },
    { id: 'PH-CITY-ILOILO', name: 'Iloilo City', parent_id: 'PH-PROV-ILO', sort_order: 5 },
    { id: 'PH-CITY-TAC', name: 'Tacloban City', parent_id: 'PH-PROV-LEY', sort_order: 6 },
    { id: 'PH-CITY-BACOLOD', name: 'Bacolod City', parent_id: 'PH-PROV-NEGO', sort_order: 7 },
    { id: 'PH-CITY-DUMAG', name: 'Dumaguete City', parent_id: 'PH-PROV-NEGE', sort_order: 8 },
    { id: 'PH-CITY-KALIBO', name: 'Kalibo', parent_id: 'PH-PROV-AKL', sort_order: 9 },
    { id: 'PH-CITY-CALBAY', name: 'Calbayog City', parent_id: 'PH-PROV-WSA', sort_order: 10 },

    // North Luzon samples
    { id: 'PH-CITY-LAOAG', name: 'Laoag City', parent_id: 'PH-PROV-ILN', sort_order: 20 },
    { id: 'PH-CITY-VIGAN', name: 'Vigan City', parent_id: 'PH-PROV-ILS', sort_order: 21 },
    { id: 'PH-CITY-SFLU', name: 'San Fernando City (La Union)', parent_id: 'PH-PROV-LUN', sort_order: 22 },
    { id: 'PH-CITY-DAGUP', name: 'Dagupan City', parent_id: 'PH-PROV-PAN', sort_order: 23 },
    { id: 'PH-CITY-TUG', name: 'Tuguegarao City', parent_id: 'PH-PROV-CAG', sort_order: 24 },
    { id: 'PH-CITY-ILAGAN', name: 'Ilagan City', parent_id: 'PH-PROV-ISA', sort_order: 25 },
    { id: 'PH-CITY-BAGUIO', name: 'Baguio City', parent_id: 'PH-PROV-BEN', sort_order: 26 },

    // South Luzon samples
    { id: 'PH-CITY-DASMA', name: 'Dasmarinas City', parent_id: 'PH-PROV-CAV', sort_order: 30 },
    { id: 'PH-CITY-CALAM', name: 'Calamba City', parent_id: 'PH-PROV-LAG', sort_order: 31 },
    { id: 'PH-CITY-BATC', name: 'Batangas City', parent_id: 'PH-PROV-BTG', sort_order: 32 },
    { id: 'PH-CITY-LUCENA', name: 'Lucena City', parent_id: 'PH-PROV-QUE', sort_order: 33 },
    { id: 'PH-CITY-ANTIP', name: 'Antipolo City', parent_id: 'PH-PROV-RIZ', sort_order: 34 },
    { id: 'PH-CITY-LEGA', name: 'Legazpi City', parent_id: 'PH-PROV-ALB', sort_order: 35 },
    { id: 'PH-CITY-NAGA', name: 'Naga City', parent_id: 'PH-PROV-CAMS', sort_order: 36 },

    // Mindanao capitals / common cities
    { id: 'PH-CITY-BUTUAN', name: 'Butuan City', parent_id: 'PH-PROV-AGN', sort_order: 10 },
    { id: 'PH-CITY-PROS', name: 'Prosperidad', parent_id: 'PH-PROV-AGS', sort_order: 11 },
    { id: 'PH-CITY-ISAB', name: 'Isabela City', parent_id: 'PH-PROV-BAS', sort_order: 12 },
    { id: 'PH-CITY-MLB', name: 'Malaybalay City', parent_id: 'PH-PROV-BUK', sort_order: 13 },
    { id: 'PH-CITY-MAMB', name: 'Mambajao', parent_id: 'PH-PROV-CAM', sort_order: 14 },
    { id: 'PH-CITY-NABU', name: 'Nabunturan', parent_id: 'PH-PROV-DAVO', sort_order: 15 },
    { id: 'PH-CITY-TAGUM', name: 'Tagum City', parent_id: 'PH-PROV-DAVN', sort_order: 16 },
    { id: 'PH-CITY-DAVAO', name: 'Davao City', parent_id: 'PH-PROV-DAVS', sort_order: 17 },
    { id: 'PH-CITY-MATI', name: 'Mati City', parent_id: 'PH-PROV-DAVE', sort_order: 18 },
    { id: 'PH-CITY-MALITA', name: 'Malita', parent_id: 'PH-PROV-DAVW', sort_order: 19 },
    { id: 'PH-CITY-SJSI', name: 'San Jose', parent_id: 'PH-PROV-DIN', sort_order: 20 },
    { id: 'PH-CITY-TUBOD', name: 'Tubod', parent_id: 'PH-PROV-LAN', sort_order: 21 },
    { id: 'PH-CITY-MARAWI', name: 'Marawi City', parent_id: 'PH-PROV-LAS', sort_order: 22 },
    { id: 'PH-CITY-DAKRA', name: 'Datu Odin Sinsuat', parent_id: 'PH-PROV-MGN', sort_order: 23 },
    { id: 'PH-CITY-BULUAN', name: 'Buluan', parent_id: 'PH-PROV-MGS', sort_order: 24 },
    { id: 'PH-CITY-OROQ', name: 'Oroquieta City', parent_id: 'PH-PROV-MOC', sort_order: 25 },
    { id: 'PH-CITY-CAGAYAN', name: 'Cagayan de Oro City', parent_id: 'PH-PROV-MOR', sort_order: 26 },
    { id: 'PH-CITY-KIDAP', name: 'Kidapawan City', parent_id: 'PH-PROV-NCO', sort_order: 27 },
    { id: 'PH-CITY-ALABEL', name: 'Alabel', parent_id: 'PH-PROV-SAR', sort_order: 28 },
    { id: 'PH-CITY-KORON', name: 'Koronadal City', parent_id: 'PH-PROV-SCO', sort_order: 29 },
    { id: 'PH-CITY-ISUL', name: 'Isulan', parent_id: 'PH-PROV-SUK', sort_order: 30 },
    { id: 'PH-CITY-JOLO', name: 'Jolo', parent_id: 'PH-PROV-SUL', sort_order: 31 },
    { id: 'PH-CITY-SURIGAO', name: 'Surigao City', parent_id: 'PH-PROV-SUN', sort_order: 32 },
    { id: 'PH-CITY-TANDAG', name: 'Tandag City', parent_id: 'PH-PROV-SUS', sort_order: 33 },
    { id: 'PH-CITY-BONGAO', name: 'Bongao', parent_id: 'PH-PROV-TWT', sort_order: 34 },
    { id: 'PH-CITY-DAPITAN', name: 'Dapitan City', parent_id: 'PH-PROV-ZAN', sort_order: 35 },
    { id: 'PH-CITY-PAGAD', name: 'Pagadian City', parent_id: 'PH-PROV-ZAS', sort_order: 36 },
    { id: 'PH-CITY-IPIL', name: 'Ipil', parent_id: 'PH-PROV-ZSI', sort_order: 37 },
  ];

  // Expand Davao del Norte to include its major cities/municipalities.
  const davaoDelNorteCities = [
    { id: 'PH-CITY-PANABO', name: 'Panabo City', parent_id: 'PH-PROV-DAVN', sort_order: 160 },
    { id: 'PH-CITY-SAMAL', name: 'Island Garden City of Samal', parent_id: 'PH-PROV-DAVN', sort_order: 161 },
    { id: 'PH-CITY-CARMEN-DAVN', name: 'Carmen', parent_id: 'PH-PROV-DAVN', sort_order: 162 },
    { id: 'PH-CITY-KAPALONG', name: 'Kapalong', parent_id: 'PH-PROV-DAVN', sort_order: 163 },
    { id: 'PH-CITY-NEWCORELLA', name: 'New Corella', parent_id: 'PH-PROV-DAVN', sort_order: 164 },
    { id: 'PH-CITY-SANISIDRO-DAVN', name: 'San Isidro', parent_id: 'PH-PROV-DAVN', sort_order: 165 },
    { id: 'PH-CITY-SANTOTOMAS-DAVN', name: 'Santo Tomas', parent_id: 'PH-PROV-DAVN', sort_order: 166 },
    { id: 'PH-CITY-TALAINGOD', name: 'Talaingod', parent_id: 'PH-PROV-DAVN', sort_order: 167 },
    { id: 'PH-CITY-DUJALI', name: 'Braulio E. Dujali', parent_id: 'PH-PROV-DAVN', sort_order: 168 },
  ];

  const davaoDelNorteCityIds = ['PH-CITY-TAGUM', ...davaoDelNorteCities.map((c) => c.id)];
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM \`place\`
      WHERE \`country_code\`='PH'
        AND \`type\`='city'
        AND \`parent_id\`='PH-PROV-DAVN'
        AND \`id\` NOT IN (${Prisma.join(davaoDelNorteCityIds)})
    `,
  );

  for (const c of davaoDelNorteCities) {
    phCities.push(c);
  }
  for (const c of phCities) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`place\`
          (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
        VALUES
          (${c.id}, 'city', ${c.parent_id}, 'PH', ${c.name}, NULL, 1, ${c.sort_order})
        ON DUPLICATE KEY UPDATE
          \`type\`='city',
          \`parent_id\`=VALUES(\`parent_id\`),
          \`country_code\`='PH',
          \`name\`=VALUES(\`name\`),
          \`has_children\`=VALUES(\`has_children\`),
          \`sort_order\`=VALUES(\`sort_order\`)
      `,
    );
  }

  // Districts/barangays: keep minimal entries so the dropdown is not empty.
  // This is NOT a full PH barangay dataset.
  const phDistricts = [
    { id: 'PH-DIST-MNL-001', name: 'Barangay 1', parent_id: 'PH-CITY-MNL', sort_order: 1 },
    { id: 'PH-DIST-QC-001', name: 'Barangay 1', parent_id: 'PH-CITY-QC', sort_order: 1 },
    { id: 'PH-DIST-CEBU-001', name: 'Lahug', parent_id: 'PH-CITY-CEBU', sort_order: 1 },
    { id: 'PH-DIST-TAGUM-001', name: 'Visayan Village', parent_id: 'PH-CITY-TAGUM', sort_order: 1 },
    { id: 'PH-DIST-DAVAO-001', name: 'Buhangin', parent_id: 'PH-CITY-DAVAO', sort_order: 1 },
    { id: 'PH-DIST-CAGAYAN-001', name: 'Carmen', parent_id: 'PH-CITY-CAGAYAN', sort_order: 1 },
    // Visayas samples
    { id: 'PH-DIST-TAGB-001', name: 'Cogon', parent_id: 'PH-CITY-TAGB', sort_order: 1 },
    { id: 'PH-DIST-ILOILO-001', name: 'Jaro', parent_id: 'PH-CITY-ILOILO', sort_order: 1 },
    { id: 'PH-DIST-TAC-001', name: 'Downtown', parent_id: 'PH-CITY-TAC', sort_order: 1 },
    { id: 'PH-DIST-BACOLOD-001', name: 'Singcang-Airport', parent_id: 'PH-CITY-BACOLOD', sort_order: 1 },
    { id: 'PH-DIST-DUMAG-001', name: 'Barangay 1', parent_id: 'PH-CITY-DUMAG', sort_order: 1 },
    { id: 'PH-DIST-KALIBO-001', name: 'Poblacion', parent_id: 'PH-CITY-KALIBO', sort_order: 1 },
    { id: 'PH-DIST-CALBAY-001', name: 'West District', parent_id: 'PH-CITY-CALBAY', sort_order: 1 },

    // North Luzon samples
    { id: 'PH-DIST-LAOAG-001', name: 'Barangay 1 San Lorenzo', parent_id: 'PH-CITY-LAOAG', sort_order: 1 },
    { id: 'PH-DIST-VIGAN-001', name: 'Poblacion', parent_id: 'PH-CITY-VIGAN', sort_order: 1 },
    { id: 'PH-DIST-SFLU-001', name: 'Poblacion', parent_id: 'PH-CITY-SFLU', sort_order: 1 },
    { id: 'PH-DIST-DAGUP-001', name: 'Poblacion Oeste', parent_id: 'PH-CITY-DAGUP', sort_order: 1 },
    { id: 'PH-DIST-TUG-001', name: 'Ugac Sur', parent_id: 'PH-CITY-TUG', sort_order: 1 },
    { id: 'PH-DIST-ILAGAN-001', name: 'Poblacion', parent_id: 'PH-CITY-ILAGAN', sort_order: 1 },
    { id: 'PH-DIST-BAGUIO-001', name: 'Session Road', parent_id: 'PH-CITY-BAGUIO', sort_order: 1 },

    // South Luzon samples
    { id: 'PH-DIST-DASMA-001', name: 'Salitran', parent_id: 'PH-CITY-DASMA', sort_order: 1 },
    { id: 'PH-DIST-CALAM-001', name: 'Real', parent_id: 'PH-CITY-CALAM', sort_order: 1 },
    { id: 'PH-DIST-BATC-001', name: 'Poblacion', parent_id: 'PH-CITY-BATC', sort_order: 1 },
    { id: 'PH-DIST-LUCENA-001', name: 'Barangay 1', parent_id: 'PH-CITY-LUCENA', sort_order: 1 },
    { id: 'PH-DIST-ANTIP-001', name: 'San Roque', parent_id: 'PH-CITY-ANTIP', sort_order: 1 },
    { id: 'PH-DIST-LEGA-001', name: 'Poblacion', parent_id: 'PH-CITY-LEGA', sort_order: 1 },
    { id: 'PH-DIST-NAGA-001', name: 'Triangulo', parent_id: 'PH-CITY-NAGA', sort_order: 1 },
  ];

  // Add a few barangays per Davao del Norte city/municipality so the dropdown connects.
  const davaoDelNorteBarangays = [
    // Tagum City
    { id: 'PH-DIST-TAGUM-002', name: 'Apokon', parent_id: 'PH-CITY-TAGUM', sort_order: 2 },
    { id: 'PH-DIST-TAGUM-003', name: 'Mankilam', parent_id: 'PH-CITY-TAGUM', sort_order: 3 },
    { id: 'PH-DIST-TAGUM-004', name: 'Magugpo Poblacion', parent_id: 'PH-CITY-TAGUM', sort_order: 4 },

    // Panabo City
    { id: 'PH-DIST-PANABO-001', name: 'Gredu (Poblacion)', parent_id: 'PH-CITY-PANABO', sort_order: 1 },
    { id: 'PH-DIST-PANABO-002', name: 'New Pandan', parent_id: 'PH-CITY-PANABO', sort_order: 2 },

    // Samal
    { id: 'PH-DIST-SAMAL-001', name: 'Peñaplata', parent_id: 'PH-CITY-SAMAL', sort_order: 1 },
    { id: 'PH-DIST-SAMAL-002', name: 'Babak', parent_id: 'PH-CITY-SAMAL', sort_order: 2 },

    // Carmen
    { id: 'PH-DIST-CARMEN-DAVN-001', name: 'Poblacion', parent_id: 'PH-CITY-CARMEN-DAVN', sort_order: 1 },

    // Kapalong
    { id: 'PH-DIST-KAPALONG-001', name: 'Capungagan', parent_id: 'PH-CITY-KAPALONG', sort_order: 1 },

    // New Corella
    { id: 'PH-DIST-NEWCORELLA-001', name: 'Poblacion', parent_id: 'PH-CITY-NEWCORELLA', sort_order: 1 },

    // San Isidro
    { id: 'PH-DIST-SANISIDRO-DAVN-001', name: 'Sabangan', parent_id: 'PH-CITY-SANISIDRO-DAVN', sort_order: 1 },

    // Santo Tomas
    { id: 'PH-DIST-SANTOTOMAS-DAVN-001', name: 'Poblacion', parent_id: 'PH-CITY-SANTOTOMAS-DAVN', sort_order: 1 },

    // Talaingod
    { id: 'PH-DIST-TALAINGOD-001', name: 'Poblacion', parent_id: 'PH-CITY-TALAINGOD', sort_order: 1 },

    // Braulio E. Dujali
    { id: 'PH-DIST-DUJALI-001', name: 'Magupising', parent_id: 'PH-CITY-DUJALI', sort_order: 1 },
  ];

  const davaoDelNorteBarangayCityIds = davaoDelNorteCityIds;
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM \`place\`
      WHERE \`country_code\`='PH'
        AND \`type\`='district'
        AND \`parent_id\` IN (${Prisma.join(davaoDelNorteBarangayCityIds)})
        AND \`id\` NOT IN (${Prisma.join(davaoDelNorteBarangays.map((b) => b.id))})
    `,
  );

  for (const b of davaoDelNorteBarangays) {
    phDistricts.push(b);
  }
  for (const d of phDistricts) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`place\`
          (\`id\`, \`type\`, \`parent_id\`, \`country_code\`, \`name\`, \`code\`, \`has_children\`, \`sort_order\`)
        VALUES
          (${d.id}, 'district', ${d.parent_id}, 'PH', ${d.name}, NULL, 0, ${d.sort_order})
        ON DUPLICATE KEY UPDATE
          \`type\`='district',
          \`parent_id\`=VALUES(\`parent_id\`),
          \`country_code\`='PH',
          \`name\`=VALUES(\`name\`),
          \`has_children\`=VALUES(\`has_children\`),
          \`sort_order\`=VALUES(\`sort_order\`)
      `,
    );
  }

  const callingCodesFromFile =
    tryReadJson<CallingCodeRow[]>(dataPath('calling-codes.json')) ?? null;
  const callingCodes: CallingCodeRow[] =
    callingCodesFromFile && Array.isArray(callingCodesFromFile)
      ? callingCodesFromFile
      : [
          {
            country_code: 'PH',
            country_name: 'Philippines',
            calling_code: '+63',
          },
          {
            country_code: 'US',
            country_name: 'United States',
            calling_code: '+1',
          },
        ];

  for (const row of callingCodes) {
    const countryCode = normalizeCountryCode(row.country_code);
    const callingCode = normalizeCallingCode(row.calling_code);
    if (!countryCode || !callingCode) continue;

    const countryName =
      (row.country_name ?? isoMap[countryCode] ?? '').toString().trim() || null;

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO \`calling_code\` (\`country_code\`, \`calling_code\`, \`country_name\`)
        VALUES (${countryCode}, ${callingCode}, ${countryName})
        ON DUPLICATE KEY UPDATE
          \`calling_code\`=VALUES(\`calling_code\`),
          \`country_name\`=VALUES(\`country_name\`)
      `,
    );
  }
}
