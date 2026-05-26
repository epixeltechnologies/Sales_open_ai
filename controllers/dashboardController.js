const prisma  = require('../config/prisma');
const { cacheGet, cacheSet } = require('../config/memoryStore');
const { sendSuccess }        = require('../utils/responseHelpers');

const getDashboard = async (req, res, next) => {
  try {
    const userId  = req.user.id;
    const cacheKey = `dashboard:${userId}`;

    const cached = cacheGet(cacheKey);
    if (cached) return sendSuccess(res, cached, 'Dashboard data retrieved');

    const now           = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo  = new Date(now -  7 * 24 * 60 * 60 * 1000);

    const [
      totalCalls,
      totalLeads,
      totalAppointments,
      qualifiedLeads,
      recentCalls,
      callsLast30Days,
      callsLast7Days,
      leadsThisMonth,
      leadsByStatus,
      subscription,
    ] = await Promise.all([
      prisma.call.count({ where: { userId } }),
      prisma.lead.count({ where: { userId } }),
      prisma.appointment.count({ where: { userId } }),
      prisma.lead.count({ where: { userId, status: { in: ['QUALIFIED', 'APPOINTMENT_BOOKED', 'CONVERTED'] } } }),
      prisma.call.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { lead: { select: { name: true, phone: true } } },
      }),
      prisma.call.findMany({
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, status: true, duration: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.call.count({ where: { userId, createdAt: { gte: sevenDaysAgo } } }),
      prisma.lead.count({ where: { userId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.lead.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      }),
      prisma.subscription.findUnique({ where: { userId } }),
    ]);

    // Build calls-per-day for the last 30 days
    const callsPerDay = [];
    for (let i = 29; i >= 0; i--) {
      const date   = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStr = date.toISOString().split('T')[0];
      const count  = callsLast30Days.filter(
        (c) => c.createdAt.toISOString().split('T')[0] === dayStr
      ).length;
      callsPerDay.push({ date: dayStr, count });
    }

    const completedCalls = callsLast30Days.filter((c) => c.duration);
    const avgDuration    = completedCalls.length
      ? completedCalls.reduce((s, c) => s + (c.duration || 0), 0) / completedCalls.length
      : 0;

    const conversionRate = totalLeads > 0
      ? Math.round((qualifiedLeads / totalLeads) * 100)
      : 0;

    const data = {
      stats: {
        totalCalls,
        totalLeads,
        totalAppointments,
        conversionRate,
        callsThisWeek:    callsLast7Days,
        leadsThisMonth,
        avgCallDuration:  Math.round(avgDuration),
        minutesUsed:      subscription?.minutesUsed  ?? 0,
        minutesLimit:     subscription?.minutesLimit ?? 300,
      },
      charts: {
        callsPerDay,
        leadsByStatus: leadsByStatus.map((l) => ({ status: l.status, count: l._count.status })),
      },
      recentActivity: recentCalls.map((call) => ({
        id:        call.id,
        leadName:  call.lead?.name || 'Unknown Caller',
        phone:     call.fromNumber,
        status:    call.status,
        duration:  call.duration,
        createdAt: call.createdAt,
      })),
    };

    cacheSet(cacheKey, data, 120); // 2-minute cache
    return sendSuccess(res, data, 'Dashboard data retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard };
