const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../config/prisma');
const { sendSuccess, sendError } = require('../utils/responseHelpers');
const { logger } = require('../utils/logger');

const PLANS = {
  STARTER: {
    name: 'Starter',
    price: 14900, // cents
    priceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
    minutes: 300,
    features: ['300 minutes/month', 'AI lead qualification', 'Call recording', 'Email follow-ups', 'Basic analytics'],
  },
  GROWTH: {
    name: 'Growth',
    price: 39900,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID || 'price_growth',
    minutes: 1500,
    features: ['1,500 minutes/month', 'Everything in Starter', 'Advanced analytics', 'CRM integrations', 'Priority support', 'Custom voice'],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: null,
    priceId: null,
    minutes: -1,
    features: ['Unlimited minutes', 'Everything in Growth', 'Dedicated account manager', 'Custom AI training', 'SLA guarantee', 'White-label option'],
  },
};

const getPlans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const subscription = await prisma.subscription.findUnique({ where: { userId } });

    return sendSuccess(
      res,
      {
        plans: PLANS,
        current: {
          plan: subscription?.plan || 'STARTER',
          status: subscription?.status || 'ACTIVE',
          minutesUsed: subscription?.minutesUsed || 0,
          minutesLimit: subscription?.minutesLimit || 300,
          periodEnd: subscription?.currentPeriodEnd,
        },
      },
      'Plans retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const createCheckoutSession = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;

    if (!PLANS[plan] || !PLANS[plan].priceId || plan === 'ENTERPRISE') {
      return sendError(res, 'Invalid plan or contact sales for Enterprise', 400);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const subscription = await prisma.subscription.findUnique({ where: { userId } });

    let customerId = subscription?.stripeCustomerId;

    // Create or get Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId, companyName: user.companyName },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing?cancelled=true`,
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
    });

    return sendSuccess(res, { url: session.url, sessionId: session.id }, 'Checkout session created');
  } catch (error) {
    logger.error('Stripe checkout error:', error);
    next(error);
  }
};

const createPortalSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const subscription = await prisma.subscription.findUnique({ where: { userId } });

    if (!subscription?.stripeCustomerId) {
      return sendError(res, 'No billing account found', 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/billing`,
    });

    return sendSuccess(res, { url: session.url }, 'Portal session created');
  } catch (error) {
    next(error);
  }
};

const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, plan } = session.metadata;
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await prisma.subscription.upsert({
          where: { userId },
          update: {
            plan,
            status: 'ACTIVE',
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            minutesLimit: PLANS[plan]?.minutes || 300,
            minutesUsed: 0,
            currentPeriodEnd: periodEnd,
          },
          create: {
            userId,
            plan,
            status: 'ACTIVE',
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            minutesLimit: PLANS[plan]?.minutes || 300,
            currentPeriodEnd: periodEnd,
          },
        });

        await prisma.user.update({ where: { id: userId }, data: { plan } });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await prisma.subscription.update({
          where: { userId },
          data: {
            status: sub.status.toUpperCase(),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await prisma.subscription.update({
          where: { userId },
          data: { status: 'CANCELLED', plan: 'STARTER', minutesLimit: 300 },
        });
        await prisma.user.update({ where: { id: userId }, data: { plan: 'STARTER' } });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
        if (sub) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        }
        break;
      }
    }

    return res.json({ received: true });
  } catch (error) {
    logger.error('Webhook handler error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};

module.exports = { getPlans, createCheckoutSession, createPortalSession, handleWebhook };
