const prisma  = require('../config/prisma');
const { cacheGet, cacheSet } = require('../config/memoryStore');
const { sendSuccess }        = require('../utils/responseHelpers');

const getAnalytics = async (req, res, next) => {
  try {
    const userId   = req.user.id;
    const { period = '30' } = req.query;
    const days     = parseInt(period);
    const cacheKey = `analytics:${userId}:${days}`;

    const cached = cacheGet(cacheKey);
    if (cached) return sendSuccess(res, cached, 'Analytics retrieved');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [calls, leads, appointments, callsByStatus, leadsByStatus, subscription] = await Promise.all([
      prisma.call.findMany({
        where:   { userId, createdAt: { gte: since } },
        select:  { createdAt: true, status: true, duration: true, qualified: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.lead.findMany({
        where:   { userId, createdAt: { gte: since } },
        select:  { createdAt: true, status: true, score: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.appointment.count({ where: { userId, createdAt: { gte: since } } }),
      prisma.call.groupBy({ by: ['status'], where: { userId, createdAt: { gte: since } }, _count: { status: true } }),
      prisma.lead.groupBy({ by: ['status'], where: { userId }, _count: { status: true } }),
      prisma.subscription.findUnique({ where: { userId } }),
    ]);

    const totalCalls      = calls.length;
    const completedCalls  = calls.filter((c) => c.status === 'COMPLETED');
    const totalDuration   = completedCalls.reduce((s, c) => s + (c.duration || 0), 0);
    const avgDuration     = completedCalls.length ? Math.round(totalDuration / completedCalls.length) : 0;
    const qualifiedLeads  = leads.filter((l) => ['QUALIFIED', 'APPOINTMENT_BOOKED', 'CONVERTED'].includes(l.status)).length;
    const conversionRate  = totalCalls > 0 ? Math.round((qualifiedLeads / totalCalls) * 100) : 0;

    // Daily breakdown
    const dailyData = [];
    for (let i = days - 1; i >= 0; i--) {
      const date   = new Date();
      date.setDate(date.getDate() - i);
      const dayStr = date.toISOString().split('T')[0];

      const dayCalls = calls.filter((c) => c.createdAt.toISOString().split('T')[0] === dayStr);
      const dayLeads = leads.filter((l) => l.createdAt.toISOString().split('T')[0] === dayStr);
      const withDur  = dayCalls.filter((c) => c.duration);

      dailyData.push({
        date,
        calls:      dayCalls.length,
        leads:      dayLeads.length,
        qualified:  dayLeads.filter((l) => ['QUALIFIED', 'APPOINTMENT_BOOKED', 'CONVERTED'].includes(l.status)).length,
        avgDuration: withDur.length
          ? Math.round(withDur.reduce((s, c) => s + (c.duration || 0), 0) / withDur.length)
          : 0,
      });
    }

    // Duration buckets
    const durationBuckets = [
      { label: '< 1 min',  count: completedCalls.filter((c) => (c.duration || 0) < 60).length },
      { label: '1–3 min',  count: completedCalls.filter((c) => (c.duration || 0) >= 60  && (c.duration || 0) < 180).length },
      { label: '3–5 min',  count: completedCalls.filter((c) => (c.duration || 0) >= 180 && (c.duration || 0) < 300).length },
      { label: '5–10 min', count: completedCalls.filter((c) => (c.duration || 0) >= 300 && (c.duration || 0) < 600).length },
      { label: '> 10 min', count: completedCalls.filter((c) => (c.duration || 0) >= 600).length },
    ];

    const data = {
      summary: {
        totalCalls,
        totalLeads:       leads.length,
        totalAppointments: appointments,
        qualifiedLeads,
        conversionRate,
        avgCallDuration:  avgDuration,
        totalTalkTime:    totalDuration,
        minutesUsed:      subscription?.minutesUsed  ?? 0,
        minutesLimit:     subscription?.minutesLimit ?? 300,
        minutesRemaining: Math.max(0, (subscription?.minutesLimit ?? 300) - (subscription?.minutesUsed ?? 0)),
      },
      charts: {
        dailyData,
        callsByStatus: callsByStatus.map((c) => ({ status: c.status, count: c._count.status })),
        leadsByStatus: leadsByStatus.map((l) => ({ status: l.status, count: l._count.status })),
        durationBuckets,
      },
    };

    cacheSet(cacheKey, data, 300); // 5-minute cache
    return sendSuccess(res, data, 'Analytics retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = { getAnalytics };
