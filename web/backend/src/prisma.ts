import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.DEBUG_PRISMA ? ["query", "warn", "error"] : ["warn", "error"],
});
