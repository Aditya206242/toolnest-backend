const db = require('../config/db');

// Try loading stripe and razorpay SDKs (wrapped in try-catch to support fallback graceful degradation)
let Stripe = null;
let Razorpay = null;

try {
  Stripe = require('stripe');
} catch (e) {
  console.log('Stripe SDK not installed or loaded. Fallback sandbox enabled.');
}

try {
  Razorpay = require('razorpay');
} catch (e) {
  console.log('Razorpay SDK not installed or loaded. Fallback sandbox enabled.');
}

// Initialize clients if secret variables are configured in .env
const stripeClient = (Stripe && process.env.STRIPE_SECRET_KEY) 
  ? new Stripe(process.env.STRIPE_SECRET_KEY) 
  : null;

const razorpayClient = (Razorpay && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

// Sandbox Coupons list
const VALID_COUPONS = {
  'SAVE20': { code: 'SAVE20', discount: 20, description: '20% off your subscription' },
  'WELCOME50': { code: 'WELCOME50', discount: 50, description: '50% off first purchase' },
  'FREEPASS': { code: 'FREEPASS', discount: 100, description: '100% off full premium access' }
};

// Standard plans metadata
const PLANS = {
  monthly: {
    id: 'plan_monthly',
    name: 'monthly',
    price: 199,
    currency: 'INR',
    interval: 'month'
  },
  yearly: {
    id: 'plan_yearly',
    name: 'yearly',
    price: 1999,
    currency: 'INR',
    interval: 'year'
  }
};

// Helper: Log user action to activity logs
const logUserAction = async (userId, action, details, ip = null) => {
  try {
    await db.query(
      'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, action, details, ip]
    );
  } catch (err) {
    console.error('Activity logging failed:', err.message);
  }
};

// 1. GET /api/v1/subscription/plans
exports.getPlans = (req, res) => {
  res.status(200).json({
    status: 'success',
    data: Object.values(PLANS)
  });
};

// 2. POST /api/v1/subscription/coupon/validate
exports.validateCoupon = (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ status: 'error', message: 'Coupon code required.' });
  }

  const coupon = VALID_COUPONS[code.toUpperCase()];
  if (!coupon) {
    return res.status(400).json({ status: 'error', message: 'Invalid or expired coupon code.' });
  }

  res.status(200).json({
    status: 'success',
    data: coupon
  });
};

// 3. POST /api/v1/subscription/checkout
exports.createCheckout = async (req, res, next) => {
  try {
    const { planName, provider, couponCode } = req.body;
    const userId = req.user.id;

    if (!['monthly', 'yearly'].includes(planName)) {
      return res.status(400).json({ status: 'error', message: 'Invalid plan selected.' });
    }

    if (!['stripe', 'razorpay'].includes(provider)) {
      return res.status(400).json({ status: 'error', message: 'Invalid payment provider selected.' });
    }

    const plan = PLANS[planName];
    let price = plan.price;
    let discountPercent = 0;

    // Apply Coupon calculation
    if (couponCode) {
      const coupon = VALID_COUPONS[couponCode.toUpperCase()];
      if (coupon) {
        discountPercent = coupon.discount;
        price = price - (price * discountPercent) / 100;
      }
    }

    const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // ----------------------------------------------------
    // STRIPE INTEGRATION
    // ----------------------------------------------------
    if (provider === 'stripe') {
      if (stripeClient) {
        try {
          const stripePriceId = planName === 'monthly' 
            ? process.env.STRIPE_MONTHLY_PRICE_ID 
            : process.env.STRIPE_YEARLY_PRICE_ID;

          const sessionParams = {
            payment_method_types: ['card'],
            line_items: [{
              price: stripePriceId || 'price_123_dummy',
              quantity: 1
            }],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pricing`,
            metadata: {
              userId: userId.toString(),
              planName,
              couponCode: couponCode || ''
            }
          };

          // Apply stripe coupon if valid
          if (discountPercent > 0 && discountPercent < 100) {
            // Note: In production you would create a Stripe coupon. 
            // For now, we rely on metadata for calculations or let Stripe handle custom coupon codes.
          }

          const session = await stripeClient.checkout.sessions.create(sessionParams);
          return res.status(200).json({
            status: 'success',
            data: {
              url: session.url,
              sessionId: session.id,
              provider: 'stripe'
            }
          });
        } catch (stripeErr) {
          console.warn('Stripe checkout generation failed, fallback to sandbox:', stripeErr.message);
        }
      }

      // Stripe Sandbox Mock Flow
      const mockCheckoutUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing?mock_provider=stripe&mock_status=succeeded&plan_name=${planName}&amount=${price}&txn_id=${txnId}&coupon=${couponCode || ''}`;
      return res.status(200).json({
        status: 'success',
        data: {
          url: mockCheckoutUrl,
          sessionId: `mock_stripe_${Date.now()}`,
          provider: 'stripe',
          sandbox: true
        }
      });
    }

    // ----------------------------------------------------
    // RAZORPAY INTEGRATION
    // ----------------------------------------------------
    if (provider === 'razorpay') {
      if (razorpayClient) {
        try {
          const razorpayPlanId = planName === 'monthly'
            ? process.env.RAZORPAY_MONTHLY_PLAN_ID
            : process.env.RAZORPAY_YEARLY_PLAN_ID;

          const subscriptionParams = {
            plan_id: razorpayPlanId || 'plan_dummy_123',
            total_count: planName === 'monthly' ? 12 : 1,
            quantity: 1,
            customer_notify: 1,
            notes: {
              userId: userId.toString(),
              planName,
              couponCode: couponCode || ''
            }
          };

          const subscription = await razorpayClient.subscriptions.create(subscriptionParams);
          return res.status(200).json({
            status: 'success',
            data: {
              subscriptionId: subscription.id,
              amount: price * 100, // paise
              currency: 'INR',
              key: process.env.RAZORPAY_KEY_ID,
              provider: 'razorpay'
            }
          });
        } catch (rzpErr) {
          console.warn('Razorpay checkout generation failed, fallback to sandbox:', rzpErr.message);
        }
      }

      // Razorpay Sandbox Mock Flow
      const mockCheckoutUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing?mock_provider=razorpay&mock_status=succeeded&plan_name=${planName}&amount=${price}&txn_id=${txnId}&coupon=${couponCode || ''}`;
      return res.status(200).json({
        status: 'success',
        data: {
          url: mockCheckoutUrl,
          subscriptionId: `mock_rzp_${Date.now()}`,
          provider: 'razorpay',
          sandbox: true
        }
      });
    }

  } catch (error) {
    next(error);
  }
};

// Helper: Activate Premium User locally in DB
const activatePremiumSubscription = async (userId, planName, customerId, subId, provider, amount, txnId, coupon) => {
  const currentPeriodStart = new Date();
  const currentPeriodEnd = new Date();
  
  if (planName === 'yearly') {
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
  } else {
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
  }

  // 1. Create/Update Subscription Row
  const [subRows] = await db.query(
    'SELECT id FROM subscriptions WHERE user_id = ? AND status = ?',
    [userId, 'active']
  );

  let subscriptionId = null;

  if (subRows.length > 0) {
    subscriptionId = subRows[0].id;
    await db.query(
      `UPDATE subscriptions SET 
        plan_name = ?, 
        stripe_customer_id = ?,
        stripe_subscription_id = ?,
        razorpay_subscription_id = ?,
        status = 'active',
        current_period_start = ?,
        current_period_end = ?,
        cancel_at_period_end = FALSE
      WHERE id = ?`,
      [
        planName,
        provider === 'stripe' ? customerId : null,
        provider === 'stripe' ? subId : null,
        provider === 'razorpay' ? subId : null,
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionId
      ]
    );
  } else {
    const [insertResult] = await db.query(
      `INSERT INTO subscriptions 
        (user_id, stripe_customer_id, stripe_subscription_id, razorpay_subscription_id, plan_name, status, current_period_start, current_period_end)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        userId,
        provider === 'stripe' ? customerId : null,
        provider === 'stripe' ? subId : null,
        provider === 'razorpay' ? subId : null,
        planName,
        currentPeriodStart,
        currentPeriodEnd
      ]
    );
    subscriptionId = insertResult.insertId;
  }

  // 2. Promote User role to premium
  await db.query("UPDATE users SET role = 'premium' WHERE id = ? AND role != 'admin'", [userId]);

  // 3. Log Payment receipt
  await db.query(
    `INSERT INTO payments 
      (user_id, subscription_id, provider, transaction_id, amount, currency, status, invoice_url)
     VALUES (?, ?, ?, ?, ?, 'INR', 'succeeded', ?)`,
    [
      userId,
      subscriptionId,
      provider,
      txnId,
      amount,
      `/api/v1/subscription/invoice/${txnId}` // Generated PDF link
    ]
  );

  // 4. Log event
  await logUserAction(
    userId,
    'SUBSCRIPTION_ACTIVATED',
    `Subscribed to ${planName} plan via ${provider}. Txn ID: ${txnId} (Coupon: ${coupon || 'none'})`
  );
};

// 4. POST /api/v1/subscription/webhooks/stripe
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  if (stripeClient && process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      event = stripeClient.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Stripe webhook verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Unverified/dev mode webhook fallback
    event = req.body;
  }

  try {
    const session = event.data?.object;

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
      const metadata = session.metadata;
      
      if (metadata && metadata.userId) {
        const userId = parseInt(metadata.userId);
        const planName = metadata.planName;
        const coupon = metadata.couponCode;
        const subId = session.subscription || `sub_str_${Date.now()}`;
        const customerId = session.customer || `cus_str_${Date.now()}`;
        const amount = session.amount_total ? session.amount_total / 100 : 199;
        const txnId = session.payment_intent || session.id;

        await activatePremiumSubscription(userId, planName, customerId, subId, 'stripe', amount, txnId, coupon);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subId = session.id;
      // Downgrade subscription
      const [subs] = await db.query('SELECT id, user_id FROM subscriptions WHERE stripe_subscription_id = ?', [subId]);
      if (subs.length > 0) {
        const sub = subs[0];
        await db.query("UPDATE subscriptions SET status = 'canceled' WHERE id = ?", [sub.id]);
        await db.query("UPDATE users SET role = 'user' WHERE id = ? AND role != 'admin'", [sub.user_id]);
        await logUserAction(sub.user_id, 'SUBSCRIPTION_TERMINATED', `Stripe subscription ${subId} deleted or expired.`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe Webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// 5. POST /api/v1/subscription/webhooks/razorpay
exports.razorpayWebhook = async (req, res) => {
  // Simple signature validation if secret is configured
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  if (webhookSecret && razorpayClient) {
    const signature = req.headers['x-razorpay-signature'];
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ status: 'error', message: 'Signature verification failed.' });
    }
  }

  try {
    const event = req.body.event;
    const payload = req.body.payload;

    if (event === 'subscription.charged') {
      const subObj = payload.subscription.entity;
      const paymentObj = payload.payment.entity;
      const notes = subObj.notes;

      if (notes && notes.userId) {
        const userId = parseInt(notes.userId);
        const planName = notes.planName;
        const coupon = notes.couponCode;
        const subId = subObj.id;
        const amount = paymentObj.amount ? paymentObj.amount / 100 : 199;
        const txnId = paymentObj.id;

        await activatePremiumSubscription(userId, planName, null, subId, 'razorpay', amount, txnId, coupon);
      }
    }

    if (event === 'subscription.cancelled') {
      const subObj = payload.subscription.entity;
      const subId = subObj.id;

      const [subs] = await db.query('SELECT id, user_id FROM subscriptions WHERE razorpay_subscription_id = ?', [subId]);
      if (subs.length > 0) {
        const sub = subs[0];
        await db.query("UPDATE subscriptions SET status = 'canceled' WHERE id = ?", [sub.id]);
        await db.query("UPDATE users SET role = 'user' WHERE id = ? AND role != 'admin'", [sub.user_id]);
        await logUserAction(sub.user_id, 'SUBSCRIPTION_TERMINATED', `Razorpay subscription ${subId} deleted or expired.`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Razorpay Webhook error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// 6. POST /api/v1/subscription/mock-checkout-success (Bypasses webhooks in sandbox dev environment)
exports.mockCheckoutSuccess = async (req, res, next) => {
  try {
    const { planName, provider, amount, txnId, coupon } = req.body;
    const userId = req.user.id;

    const subId = `mock_sub_${Date.now()}`;
    const cusId = `mock_cus_${Date.now()}`;

    await activatePremiumSubscription(userId, planName, cusId, subId, provider, parseFloat(amount || 199), txnId, coupon);

    res.status(200).json({
      status: 'success',
      message: 'Sandbox transaction recorded and role promoted to Premium.'
    });
  } catch (error) {
    next(error);
  }
};

// 7. GET /api/v1/subscription/status
exports.getSubscriptionStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch active subscription details
    const [subs] = await db.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    // Fetch billing transaction history
    const [payments] = await db.query(
      `SELECT id, provider, transaction_id, amount, currency, status, invoice_url, created_at
       FROM payments 
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.status(200).json({
      status: 'success',
      data: {
        subscription: subs.length > 0 ? subs[0] : null,
        payments
      }
    });
  } catch (error) {
    next(error);
  }
};

// 8. POST /api/v1/subscription/cancel
exports.cancelSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [subs] = await db.query(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'",
      [userId]
    );

    if (subs.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No active subscription found.' });
    }

    const sub = subs[0];

    // Live Stripe cancellation
    if (sub.stripe_subscription_id && stripeClient) {
      try {
        await stripeClient.subscriptions.update(sub.stripe_subscription_id, {
          cancel_at_period_end: true
        });
      } catch (stripeErr) {
        console.warn('Stripe cancellation failed, updating DB locally:', stripeErr.message);
      }
    }

    // Live Razorpay cancellation
    if (sub.razorpay_subscription_id && razorpayClient) {
      try {
        await razorpayClient.subscriptions.cancel(sub.razorpay_subscription_id);
      } catch (rzpErr) {
        console.warn('Razorpay cancellation failed, updating DB locally:', rzpErr.message);
      }
    }

    // Update status in local database
    await db.query(
      `UPDATE subscriptions SET 
        status = 'canceled',
        cancel_at_period_end = TRUE 
      WHERE id = ?`,
      [sub.id]
    );

    // Downgrade account role instantly to user
    await db.query("UPDATE users SET role = 'user' WHERE id = ? AND role != 'admin'", [userId]);

    await logUserAction(userId, 'SUBSCRIPTION_CANCELED', `Cancelled subscription plan ${sub.plan_name}`);

    res.status(200).json({
      status: 'success',
      message: 'Subscription cancelled successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// 9. POST /api/v1/subscription/change-plan (Upgrade/Downgrade)
exports.changePlan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { newPlanName } = req.body;

    if (!['monthly', 'yearly'].includes(newPlanName)) {
      return res.status(400).json({ status: 'error', message: 'Invalid plan selected.' });
    }

    const [subs] = await db.query(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'",
      [userId]
    );

    if (subs.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No active subscription to change.' });
    }

    const sub = subs[0];
    if (sub.plan_name === newPlanName) {
      return res.status(400).json({ status: 'error', message: `You are already on the ${newPlanName} plan.` });
    }

    // Update billing model
    const currentPeriodEnd = new Date();
    if (newPlanName === 'yearly') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    await db.query(
      `UPDATE subscriptions SET 
        plan_name = ?, 
        current_period_end = ?
      WHERE id = ?`,
      [newPlanName, currentPeriodEnd, sub.id]
    );

    await logUserAction(
      userId,
      'SUBSCRIPTION_PLAN_CHANGED',
      `Swapped plan from ${sub.plan_name} to ${newPlanName}`
    );

    res.status(200).json({
      status: 'success',
      message: `Subscription successfully updated to ${newPlanName}.`
    });
  } catch (error) {
    next(error);
  }
};

// 10. GET /api/v1/subscription/invoice/:txnId
exports.getInvoice = async (req, res, next) => {
  try {
    const { txnId } = req.params;
    
    // Fetch transaction detail
    const [payments] = await db.query(
      `SELECT p.*, u.full_name, u.email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       WHERE p.transaction_id = ?`,
      [txnId]
    );

    if (payments.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Invoice not found.' });
    }

    const payment = payments[0];

    // Simple HTML content rendering acting as an invoice view page (easy to download or print)
    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice #${payment.transaction_id}</title>
        <style>
          body { font-family: system-ui, sans-serif; color: #1e293b; padding: 40px; max-width: 600px; margin: auto; }
          .border { border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; }
          .amount { font-size: 24px; font-weight: 800; color: #7c3aed; }
          .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          .table th, .table td { text-align: left; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
          .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="border">
          <div class="header">
            <div>
              <h1 style="margin:0; font-size:20px; color:#4f46e5;">ToolNest Premium</h1>
              <span style="font-size:11px; color:#64748b;">Receipt Voucher</span>
            </div>
            <div style="text-align:right;">
              <span class="amount">₹${payment.amount}</span>
              <div style="font-size:10px; color:#64748b;">${payment.currency}</div>
            </div>
          </div>

          <table class="table">
            <tr><th>Client Name</th><td>${payment.full_name}</td></tr>
            <tr><th>Email</th><td>${payment.email}</td></tr>
            <tr><th>Transaction ID</th><td style="font-family:monospace;">${payment.transaction_id}</td></tr>
            <tr><th>Method</th><td style="text-transform:uppercase;">${payment.provider}</td></tr>
            <tr><th>Status</th><td style="color:#10b981; font-weight:700;">${payment.status.toUpperCase()}</td></tr>
            <tr><th>Date</th><td>${new Date(payment.created_at).toLocaleDateString()}</td></tr>
          </table>

          <div class="footer">
            Thank you for supporting ToolNest. For questions, contact billing@toolnest.com
            <br/><br/>
            <button onclick="window.print()" style="padding:6px 12px; border-radius:6px; border:1px solid #d1d5db; background:#fff; cursor:pointer;">Print Invoice</button>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    next(error);
  }
};
