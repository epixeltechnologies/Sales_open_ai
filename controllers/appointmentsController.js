const prisma = require('../config/prisma');
const { sendSuccess, sendError, sendPaginated } = require('../utils/responseHelpers');

const getAppointments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { userId };
    if (status) where.status = status;

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { scheduledAt: 'desc' },
        include: { lead: { select: { name: true, phone: true, email: true, company: true } } },
      }),
      prisma.appointment.count({ where }),
    ]);

    return sendPaginated(res, appointments, total, page, limit, 'Appointments retrieved');
  } catch (error) {
    next(error);
  }
};

const updateAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { status, notes, scheduledAt } = req.body;

    const existing = await prisma.appointment.findFirst({ where: { id, userId } });
    if (!existing) return sendError(res, 'Appointment not found', 404);

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(notes && { notes }),
        ...(scheduledAt && { scheduledAt: new Date(scheduledAt) }),
      },
      include: { lead: { select: { name: true, phone: true } } },
    });

    return sendSuccess(res, appointment, 'Appointment updated');
  } catch (error) {
    next(error);
  }
};

module.exports = { getAppointments, updateAppointment };
