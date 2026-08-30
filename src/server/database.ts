import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  sfPrisma?: PrismaClient;
};

export const db = globalForPrisma.sfPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.sfPrisma = db;
}
