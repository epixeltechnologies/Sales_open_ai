const jwt    = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { cacheGet, cacheSet } = require('../config/memoryStore');
const { sendError }          = require('../utils/responseHelpers');
const { logger }             = require('../utils/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Access denied. No token provided.', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) return sendError(res, 'Access denied. Invalid token format.', 401);

    // Blacklist check
    if (cacheGet(`blacklist:${token}`)) {
      return sendError(res, 'Token has been invalidated. Please login again.', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // User cache (5 min)
    const cached = cacheGet(`user:${decoded.userId}`);
    if (cached) {
      req.user  = cached;
      req.token = token;
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, email: true, companyName: true, plan: true, isActive: true, createdAt: true },
    });

    if (!user)         return sendError(res, 'User not found.', 401);
    if (!user.isActive) return sendError(res, 'Account has been deactivated.', 403);

    cacheSet(`user:${user.id}`, user, 300);

    req.user  = user;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError')  return sendError(res, 'Token expired. Please refresh your token.', 401);
    if (error.name === 'JsonWebTokenError')  return sendError(res, 'Invalid token.', 401);
    logger.error('Auth middleware error:', error);
    return sendError(res, 'Authentication failed.', 500);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
    await authenticate(req, res, next);
  } catch {
    next();
  }
};

module.exports = { authenticate, optionalAuth };
