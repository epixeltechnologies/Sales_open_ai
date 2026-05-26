const express = require('express');
const router = express.Router();
const { getAnalytics } = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, getAnalytics);

module.exports = router;
