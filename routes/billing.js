const express = require('express');
const router = express.Router();
const { getPlans, createCheckoutSession, createPortalSession, handleWebhook } = require('../controllers/billingController');
const { authenticate } = require('../middleware/auth');

router.get('/plans', authenticate, getPlans);
router.post('/checkout', authenticate, createCheckoutSession);
router.post('/portal', authenticate, createPortalSession);
router.post('/webhook', handleWebhook); // raw body middleware applied in server.js

module.exports = router;
