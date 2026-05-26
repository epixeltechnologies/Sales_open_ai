const express = require('express');
const router = express.Router();
const { getLeads, getLead, updateLead, deleteLead } = require('../controllers/leadsController');
const { authenticate } = require('../middleware/auth');
const { leadUpdateValidator, paginationValidator } = require('../middleware/validation');

router.get('/', authenticate, paginationValidator, getLeads);
router.get('/:id', authenticate, getLead);
router.patch('/:id', authenticate, leadUpdateValidator, updateLead);
router.delete('/:id', authenticate, deleteLead);

module.exports = router;
