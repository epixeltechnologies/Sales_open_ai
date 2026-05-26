const express = require('express');
const router = express.Router();
const { getAppointments, updateAppointment } = require('../controllers/appointmentsController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, getAppointments);
router.patch('/:id', authenticate, updateAppointment);

module.exports = router;
