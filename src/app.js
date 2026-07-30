const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();

// Security Middlewares & Headers
app.use(helmet());
app.use(compression()); // Gzip compression on response payloads
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')); // Morgan HTTP request logs

// CORS configuration
const allowedOrigins = [
  (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
  'http://localhost:5174',
  'http://localhost:5175'
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// JSON Parser & URL Encoding & Cookie Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Global URL Redirection Handler Middleware
const redirectMiddleware = require('./middleware/redirectMiddleware');
app.use(redirectMiddleware);

// General Rate Limiting (Prevent Denial-of-Service)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message: 'Too many requests from this IP, please try again later.',
  },
});
app.use('/api/', limiter);

// Stricter Rate Limiting for Authentication (Brute-Force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Max 15 login/signup actions per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime 
      ? new Date(req.rateLimit.resetTime).getTime() 
      : Date.now() + 15 * 60 * 1000;
    res.status(429).json({
      status: 429,
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
      resetTime
    });
  }
});
app.use('/api/v1/auth', authLimiter);

// Serve uploaded files statically with cache-control headers
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1y',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// SEO Dynamic Indexers
const seoController = require('./controllers/seoController');
app.get('/sitemap.xml', seoController.getSitemap);
app.get('/robots.txt', seoController.getRobotsTxt);

// Health Check API
const db = require('./config/db');
const redisCache = require('./config/redis');

app.use('/api/v1/health', async (req, res) => {
  const healthDetails = {
    status: 'success',
    serverTimestamp: new Date().toISOString(),
    uptime: `${Math.round(process.uptime())}s`,
    processMemory: process.memoryUsage(),
    checks: {
      database: 'unhealthy',
      redis: redisCache.isRedisConnected() ? 'healthy' : 'fallback_memory'
    }
  };

  try {
    // Audit MySQL connectivity
    await db.query('SELECT 1');
    healthDetails.checks.database = 'healthy';
    
    res.status(200).json(healthDetails);
  } catch (error) {
    healthDetails.status = 'error';
    healthDetails.checks.database = `unhealthy: ${error.message}`;
    res.status(500).json(healthDetails);
  }
});

// Auth Routes
const authRouter = require('./routes/auth');
app.use('/api/v1/auth', authRouter);

// PDF Routes
const pdfRouter = require('./routes/pdf');
app.use('/api/v1/pdf', pdfRouter);

// Tools Config Routes
const toolsRouter = require('./routes/tools');
app.use('/api/v1/tools', toolsRouter);

// Image Routes
const imageRouter = require('./routes/image');
app.use('/api/v1/image', imageRouter);

// Blog & CMS Routes
const blogRouter = require('./routes/blog');
app.use('/api/v1/blog', blogRouter);

// Admin Dashboard Routes
const adminDashboardRouter = require('./routes/admin');
app.use('/api/v1/admin/dashboard', adminDashboardRouter);

// Subscription & Payment Routes
const subscriptionRouter = require('./routes/subscription');
app.use('/api/v1/subscription', subscriptionRouter);

// Wildcard route error handler
app.use('*', (req, res, next) => {
  const err = new Error(`Route ${req.originalUrl} not found`);
  err.status = 404;
  next(err);
});

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = err.status || 500;
  
  // Mask sensitive SQL database structures in production mode
  let clientMessage = err.message || 'Internal Server Error';
  if (process.env.NODE_ENV === 'production' && (err.code?.startsWith('ER_') || err.sqlState)) {
    clientMessage = 'A database transaction error occurred. Please contact systems administrator.';
  }

  console.error(`[Error] ${statusCode} - ${err.message}`, err.stack);
  
  res.status(statusCode).json({
    status: 'error',
    message: clientMessage,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

module.exports = app;
