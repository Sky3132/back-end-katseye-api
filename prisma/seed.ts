import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/password';
import { seedLocations } from './seed-locations';

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

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  const prisma = createPrismaClient();
  try {
    await prisma.category.createMany({
      data: [
        { category_name: 'Cloth' },
        { category_name: 'Album' },
        { category_name: 'Accessories' },
      ],
      skipDuplicates: true,
    });

    await seedLocations(prisma);

    const existingAdminCount = await prisma.admin.count();
    if (existingAdminCount > 0) {
      console.log(
        'Admin seed skipped: an admin already exists. Categories and locations have been ensured.',
      );
      return;
    }

    if (!username || !password) {
      console.error(
        'Missing ADMIN_USERNAME / ADMIN_PASSWORD env vars (used to create the initial admin).',
      );
      process.exitCode = 1;
      return;
    }

    const existing = await prisma.admin.findUnique({ where: { username } });
    if (existing) {
      console.log(`Admin already exists: ${username}`);
      return;
    }

    const hashed = await hashPassword(password);
    await prisma.admin.create({
      data: {
        username,
        password: hashed,
        role: 'admin',
      },
    });

    console.log(`Created admin: ${username}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
