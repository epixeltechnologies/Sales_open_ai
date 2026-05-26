const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, getVoices } = require('../controllers/agentController');
const { authenticate } = require('../middleware/auth');
const { agentSettingsValidator } = require('../middleware/validation');

router.get('/settings', authenticate, getSettings);
router.post('/settings', authenticate, agentSettingsValidator, updateSettings);
router.get('/voices', authenticate, getVoices);

module.exports = router;
