const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const crypto        = require('crypto');
const prisma        = require('../config/prisma');
const { cacheSet, cacheGet, cacheDel } = require('../config/memoryStore');
const { sendEmail } = require('./emailService');
const { logger }    = require('../utils/logger');

const SALT_ROUNDS = 12;

/* ── helpers ─────────────────────────────────────────────── */

const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

/* ── signup ──────────────────────────────────────────────── */

const signup = async ({ name, email, password, companyName }) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error('An account with this email already exists');
    err.status = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: { name, email, password: hashedPassword, companyName, plan: 'STARTER' },
    });

    await tx.agentSettings.create({
      data: {
        userId: newUser.id,
        agentName: 'Alex',
        welcomeMessage: `Hello! Thank you for calling ${companyName}. My name is Alex — how can I help you today?`,
        qualificationQuestions: JSON.stringify([
          'What company are you with?',
          "What's your current budget for this type of solution?",
          'What are your main pain points?',
          "What's your timeline for making a decision?",
        ]),
        objectionHandling:
          'I completely understand your concern. Many of our successful clients had similar thoughts initially. Let me share how we helped them…',
        voice: 'rachel',
        temperature: 0.7,
      },
    });

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await tx.subscription.create({
      data: { userId: newUser.id, plan: 'STARTER', minutesLimit: 300, currentPeriodEnd: periodEnd },
    });

    return newUser;
  });

  await sendEmail({ to: email, template: 'welcome', data: { name, companyName } });

  const { accessToken, refreshToken } = generateTokens(user.id);
  // store refresh token for 7 days
  cacheSet(`refresh:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

  return {
    user: { id: user.id, name: user.name, email: user.email, companyName: user.companyName, plan: user.plan },
    accessToken,
    refreshToken,
  };
};

/* ── login ───────────────────────────────────────────────── */

const login = async ({ email, password }) => {
  console.log({ where: { email } });
  const user = await prisma.user.findUnique({ where: { 'email': email } });
  if (!user) {
    const err = new Error('Invalid email or password'); err.status = 401; throw err;
  }
  if (!user.isActive) {
    const err = new Error('Your account has been deactivated. Contact support.'); err.status = 403; throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const err = new Error('Invalid email or password'); err.status = 401; throw err;
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  cacheSet(`refresh:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

  return {
    user: { id: user.id, name: user.name, email: user.email, companyName: user.companyName, plan: user.plan },
    accessToken,
    refreshToken,
  };
};

/* ── refresh token ───────────────────────────────────────── */

const refreshToken = async (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    const err = new Error('Invalid refresh token'); err.status = 401; throw err;
  }

  const stored = cacheGet(`refresh:${decoded.userId}`);
  if (!stored || stored !== token) {
    const err = new Error('Refresh token not found or expired'); err.status = 401; throw err;
  }

  const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.userId);
  cacheSet(`refresh:${decoded.userId}`, newRefresh, 7 * 24 * 60 * 60);
  return { accessToken, refreshToken: newRefresh };
};

/* ── logout ──────────────────────────────────────────────── */

const logout = async (token, userId) => {
  // Blacklist the access token for its remaining lifetime (~15 min)
  cacheSet(`blacklist:${token}`, true, 15 * 60);
  cacheDel(`refresh:${userId}`);
  cacheDel(`user:${userId}`);
};

/* ── forgot password ─────────────────────────────────────── */

const forgotPassword = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond OK to prevent email enumeration
  if (!user) return { message: 'If an account exists, a reset email has been sent.' };

  const resetToken  = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // store for 1 hour
  cacheSet(`reset:${hashedToken}`, user.id, 60 * 60);

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  await sendEmail({ to: email, template: 'resetPassword', data: { name: user.name, resetUrl } });

  return { message: 'If an account exists, a reset email has been sent.' };
};

/* ── reset password ──────────────────────────────────────── */

const resetPassword = async (token, newPassword) => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const userId      = cacheGet(`reset:${hashedToken}`);

  if (!userId) {
    const err = new Error('Invalid or expired reset token'); err.status = 400; throw err;
  }

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

  cacheDel(`reset:${hashedToken}`);
  cacheDel(`refresh:${userId}`);
  cacheDel(`user:${userId}`);

  return { message: 'Password reset successfully' };
};

module.exports = { signup, login, refreshToken, logout, forgotPassword, resetPassword };
