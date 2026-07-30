const express = require('express');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');

const router = express.Router();

// Guard all dashboard routes: User must be logged in and possess role = 'admin'
router.use(authMiddleware);
router.use(roleMiddleware('admin'));

// Overview Stats, charts data, and activity timeline
router.get('/overview', adminController.getOverview);

// User Roles administration
router.get('/users', adminController.getUsers);
router.put('/users/:id/role', adminController.updateUserRole);

// Payments logs audit
router.get('/payments', adminController.getPayments);

// Feature Flags / Tools active state control
router.get('/tools', adminController.getTools);
router.put('/tools/:id/status', adminController.updateToolStatus);

// Permission matrix configuration
router.get('/permissions', adminController.getPermissions);
router.put('/permissions', adminController.updatePermissions);

// Live statistics metrics monitoring
router.get('/live-stats', adminController.getLiveStats);

// Audit trail logs listing
router.get('/logs', adminController.getActivityLogs);

module.exports = router;
