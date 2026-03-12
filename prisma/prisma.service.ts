import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from 'dotenv';

config(); // loads your .env

@Injectable()
export class PrismaService extends PrismaClient {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaMariaDb({
        host: process.env.DATABASE_HOST!,
        user: process.env.DATABASE_USER!,
        password: process.env.DATABASE_PASSWORD!,
        database: process.env.DATABASE_NAME!,
        port: Number(process.env.DATABASE_PORT) || 3306,
        connectionLimit: 5,
      }),
    });

    this.logger.log(
      `DB config: host=${process.env.DATABASE_HOST} port=${process.env.DATABASE_PORT} name=${process.env.DATABASE_NAME}`,
    );
  }
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
