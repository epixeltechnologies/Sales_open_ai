const prisma  = require('../config/prisma');
const { cacheDelPattern }    = require('../config/memoryStore');
const { sendSuccess, sendError, sendPaginated } = require('../utils/responseHelpers');

const getLeads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { userId };

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { email:   { contains: search, mode: 'insensitive' } },
        { phone:   { contains: search } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          calls: {
            select: { id: true, duration: true, status: true, recordingUrl: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          appointments: {
            select: { id: true, scheduledAt: true, status: true },
            orderBy: { scheduledAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return sendPaginated(res, leads, total, page, limit, 'Leads retrieved');
  } catch (error) {
    next(error);
  }
};

const getLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    const lead = await prisma.lead.findFirst({
      where: { id, userId },
      include: {
        calls: {
          orderBy: { createdAt: 'desc' },
          include: { callLogs: { orderBy: { timestamp: 'asc' } } },
        },
        appointments: { orderBy: { scheduledAt: 'desc' } },
      },
    });

    if (!lead) return sendError(res, 'Lead not found', 404);
    return sendSuccess(res, lead, 'Lead retrieved');
  } catch (error) {
    next(error);
  }
};

const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;
    const { status, notes, email, company, budget, painPoints, score } = req.body;

    const existing = await prisma.lead.findFirst({ where: { id, userId } });
    if (!existing) return sendError(res, 'Lead not found', 404);

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(status     !== undefined && { status }),
        ...(notes      !== undefined && { notes }),
        ...(email      !== undefined && { email }),
        ...(company    !== undefined && { company }),
        ...(budget     !== undefined && { budget }),
        ...(painPoints !== undefined && { painPoints }),
        ...(score      !== undefined && { score }),
      },
    });

    cacheDelPattern(`dashboard:${userId}`);
    return sendSuccess(res, lead, 'Lead updated');
  } catch (error) {
    next(error);
  }
};

const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    const existing = await prisma.lead.findFirst({ where: { id, userId } });
    if (!existing) return sendError(res, 'Lead not found', 404);

    await prisma.lead.delete({ where: { id } });
    cacheDelPattern(`dashboard:${userId}`);
    return sendSuccess(res, null, 'Lead deleted');
  } catch (error) {
    next(error);
  }
};

module.exports = { getLeads, getLead, updateLead, deleteLead };
