const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error'],
  });
} else {
  // Prevent multiple instances in development with hot reload
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }
  prisma = global.__prisma;
}

prisma.$connect()
  .then(() => logger.info('MongoDB connected via Prisma'))
  .catch((err) => logger.error('Prisma connection error:', err));

module.exports = prisma;
