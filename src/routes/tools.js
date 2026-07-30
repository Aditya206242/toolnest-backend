const express = require('express');
const toolsController = require('../controllers/toolsController');
const softAuth = require('../middleware/softAuth');

const router = express.Router();

// POST /api/v1/tools/log - Log a tool execution (soft-auth resolved)
router.post('/log', softAuth, toolsController.logUsage);

// GET /api/v1/tools/limits - Check current user limits
router.get('/limits', softAuth, toolsController.checkLimits);

module.exports = router;
