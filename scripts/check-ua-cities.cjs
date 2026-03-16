require('dotenv/config');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DATABASE_HOST,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      port: Number(process.env.DATABASE_PORT) || 3306,
      connectionLimit: 5,
    }),
  });

  try {
    const regionName = process.argv[2] ?? 'Chernivetska';
    const region = await prisma.place.findFirst({
      where: { country_code: 'UA', type: 'region', name: { contains: regionName } },
      select: { id: true, name: true },
    });
    console.log('region', region);
    if (!region) return;
    const cities = await prisma.place.findMany({
      where: { country_code: 'UA', type: 'city', parent_id: region.id },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    console.log('citiesCountSample', cities.length);
    console.log(cities);
    const total = await prisma.place.count({
      where: { country_code: 'UA', type: 'city', parent_id: region.id },
    });
    console.log('citiesCountTotal', total);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

