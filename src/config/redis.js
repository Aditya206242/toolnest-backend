const ioredis = require('ioredis');

let redisClient = null;
let isRedisAvailable = false;

// Fallback in-memory cache storage
const memoryCache = new Map();
const memoryCacheExpiries = new Map();

// Helper to clean expired memory cache entries
const cleanMemoryCache = (key) => {
  const expiry = memoryCacheExpiries.get(key);
  if (expiry && Date.now() > expiry) {
    memoryCache.delete(key);
    memoryCacheExpiries.delete(key);
    return true;
  }
  return false;
};

if (process.env.REDIS_URL) {
  try {
    redisClient = new ioredis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      showFriendlyErrorStack: false
    });

    redisClient.on('connect', () => {
      console.log('Redis connected successfully.');
      isRedisAvailable = true;
    });

    redisClient.on('error', (err) => {
      console.warn('Redis connection failed. Falling back to memory cache.');
      isRedisAvailable = false;
    });
  } catch (err) {
    console.warn('Redis initialization error. Falling back to memory cache.');
    isRedisAvailable = false;
  }
}

// Unified production-grade Cache interface with memory fallback
const cache = {
  get: async (key) => {
    if (isRedisAvailable && redisClient) {
      try {
        return await redisClient.get(key);
      } catch (err) {
        console.warn('Redis GET error, falling back to memory:', err.message);
      }
    }
    
    // Memory Cache GET
    if (cleanMemoryCache(key)) {
      return null;
    }
    return memoryCache.get(key) || null;
  },

  set: async (key, value, expirySeconds = null) => {
    if (isRedisAvailable && redisClient) {
      try {
        if (expirySeconds) {
          await redisClient.set(key, value, 'EX', expirySeconds);
        } else {
          await redisClient.set(key, value);
        }
        return true;
      } catch (err) {
        console.warn('Redis SET error, falling back to memory:', err.message);
      }
    }

    // Memory Cache SET
    memoryCache.set(key, value);
    if (expirySeconds) {
      memoryCacheExpiries.set(key, Date.now() + expirySeconds * 1000);
    }
    return true;
  },

  del: async (key) => {
    if (isRedisAvailable && redisClient) {
      try {
        await redisClient.del(key);
        return true;
      } catch (err) {
        console.warn('Redis DEL error, falling back to memory:', err.message);
      }
    }

    // Memory Cache DEL
    memoryCache.delete(key);
    memoryCacheExpiries.delete(key);
    return true;
  },

  isRedisConnected: () => isRedisAvailable
};

module.exports = cache;
