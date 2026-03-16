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
    const q = process.argv[2] ?? 'Lapu';
    const rows = await prisma.place.findMany({
      where: { country_code: 'PH', type: 'city', name: { contains: q } },
      take: 20,
      select: { id: true, name: true, parent_id: true },
    });
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

