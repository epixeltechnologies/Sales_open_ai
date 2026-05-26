const express = require('express');
const router = express.Router();
const {
  handleInboundCall,
  handleGather,
  handleCallStatus,
  handleVapiWebhook,
  getCall,
  getCalls,
} = require('../controllers/callController');
const { authenticate } = require('../middleware/auth');

// Twilio webhooks (no auth - validated by signature)
router.post('/webhook', handleInboundCall);
router.post('/gather', handleGather);
router.post('/status', handleCallStatus);
router.post('/vapi-webhook', handleVapiWebhook);

// Authenticated routes
router.get('/', authenticate, getCalls);
router.get('/:id', authenticate, getCall);

module.exports = router;
