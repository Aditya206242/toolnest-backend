const express = require('express');
const subscriptionController = require('../controllers/subscriptionController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public webhook listener paths (no auth middleware to prevent payment providers lockout)
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), subscriptionController.stripeWebhook);
router.post('/webhooks/razorpay', subscriptionController.razorpayWebhook);

// Protected routes (Authentication required)
router.get('/plans', subscriptionController.getPlans);
router.post('/coupon/validate', authMiddleware, subscriptionController.validateCoupon);
router.post('/checkout', authMiddleware, subscriptionController.createCheckout);
router.post('/mock-checkout-success', authMiddleware, subscriptionController.mockCheckoutSuccess);
router.get('/status', authMiddleware, subscriptionController.getSubscriptionStatus);
router.post('/cancel', authMiddleware, subscriptionController.cancelSubscription);
router.post('/change-plan', authMiddleware, subscriptionController.changePlan);
router.get('/invoice/:txnId', subscriptionController.getInvoice);

module.exports = router;
