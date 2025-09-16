// ==========================================
// RATE LIMITING MIDDLEWARE
// Advanced rate limiting with multiple strategies
// ==========================================

const rateLimit = require('express-rate-limit');
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const AppLogger = require('../utils/logger');
const { HTTP_STATUS, ERROR_TYPES, RATE_LIMITS } = require('../utils/constants');
const config = require('../config');

class RateLimitMiddleware {
    constructor() {
        this.logger = new AppLogger('RateLimit');
        this.rateLimiters = new Map();
        this.memoryLimiters = new Map();
        this.redisClient = null;
        this.initialized = false;
    }

    /**
     * Initialize rate limiting
     */
    async initialize() {
        try {
            this.logger.info('🚦 Initializing rate limiting...');
            
            // Setup Redis client if available
            await this.setupRedisClient();
            
            // Create rate limiters
            this.createRateLimiters();
            
            this.initialized = true;
            this.logger.info('✅ Rate limiting initialized');
            
        } catch (error) {
            this.logger.error('❌ Rate limiting initialization failed:', error);
            // Continue without Redis - use memory-based limiting
            this.createMemoryRateLimiters();
            this.initialized = true;
        }
    }

    /**
     * Setup Redis client for distributed rate limiting
     */
    async setupRedisClient() {
        const redisConfig = config.get('redis');
        
        if (!redisConfig || !redisConfig.enabled) {
            this.logger.info('📝 Redis not configured, using memory-based rate limiting');
            return;
        }

        try {
            const Redis = require('ioredis');
            this.redisClient = new Redis({
                host: redisConfig.host,
                port: redisConfig.port,
                password: redisConfig.password,
                db: redisConfig.db || 2, // Use different DB for rate limiting
                retryDelayOnFailover: 100,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 3,
                lazyConnect: true
            });

            await this.redisClient.connect();
            this.logger.info('🔗 Redis connected for rate limiting');
            
        } catch (error) {
            this.logger.warn('⚠️ Redis connection failed, using memory-based rate limiting:', error.message);
            this.redisClient = null;
        }
    }

    /**
     * Create rate limiters
     */
    createRateLimiters() {
        if (this.redisClient) {
            this.createRedisRateLimiters();
        } else {
            this.createMemoryRateLimiters();
        }
    }

    /**
     * Create Redis-based rate limiters
     */
    createRedisRateLimiters() {
        // API rate limiter
        this.rateLimiters.set('api', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_api',
            points: RATE_LIMITS.API.max,
            duration: Math.floor(RATE_LIMITS.API.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.API.windowMs / 1000),
            execEvenly: true
        }));

        // Bulk operations limiter
        this.rateLimiters.set('bulk', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_bulk',
            points: RATE_LIMITS.BULK.max,
            duration: Math.floor(RATE_LIMITS.BULK.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.BULK.windowMs / 1000),
            execEvenly: true
        }));

        // Test notifications limiter
        this.rateLimiters.set('test', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_test',
            points: RATE_LIMITS.TEST.max,
            duration: Math.floor(RATE_LIMITS.TEST.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.TEST.windowMs / 1000),
            execEvenly: true
        }));

        // Admin operations limiter
        this.rateLimiters.set('admin', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_admin',
            points: RATE_LIMITS.ADMIN.max,
            duration: Math.floor(RATE_LIMITS.ADMIN.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.ADMIN.windowMs / 1000),
            execEvenly: true
        }));

        // Login attempts limiter
        this.rateLimiters.set('login', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_login',
            points: 5, // 5 attempts
            duration: 900, // per 15 minutes
            blockDuration: 900, // block for 15 minutes
        }));

        // Failed authentication limiter
        this.rateLimiters.set('auth_fail', new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: 'rl_auth_fail',
            points: 10, // 10 failed attempts
            duration: 3600, // per hour
            blockDuration: 3600, // block for 1 hour
        }));

        this.logger.info('🔗 Redis rate limiters created');
    }

    /**
     * Create memory-based rate limiters
     */
    createMemoryRateLimiters() {
        // API rate limiter
        this.memoryLimiters.set('api', new RateLimiterMemory({
            keyPrefix: 'rl_api',
            points: RATE_LIMITS.API.max,
            duration: Math.floor(RATE_LIMITS.API.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.API.windowMs / 1000),
            execEvenly: true
        }));

        // Bulk operations limiter
        this.memoryLimiters.set('bulk', new RateLimiterMemory({
            keyPrefix: 'rl_bulk',
            points: RATE_LIMITS.BULK.max,
            duration: Math.floor(RATE_LIMITS.BULK.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.BULK.windowMs / 1000),
            execEvenly: true
        }));

        // Test notifications limiter
        this.memoryLimiters.set('test', new RateLimiterMemory({
            keyPrefix: 'rl_test',
            points: RATE_LIMITS.TEST.max,
            duration: Math.floor(RATE_LIMITS.TEST.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.TEST.windowMs / 1000),
            execEvenly: true
        }));

        // Admin operations limiter
        /*this.memoryLimiters.set('admin', new RateLimiterMemory({
            keyPrefix: 'rl_admin',
            points: RATE_LIMITS.ADMIN.max,
            duration: Math.floor(RATE_LIMITS.ADMIN.windowMs / 1000),
            blockDuration: Math.floor(RATE_LIMITS.ADMIN.windowMs / 1000),
            execEvenly: true
        }));*/

        // Login attempts limiter
        this.memoryLimiters.set('login', new RateLimiterMemory({
            keyPrefix: 'rl_login',
            points: 5,
            duration: 900,
            blockDuration: 900
        }));

        // Failed authentication limiter
        this.memoryLimiters.set('auth_fail', new RateLimiterMemory({
            keyPrefix: 'rl_auth_fail',
            points: 10,
            duration: 3600,
            blockDuration: 3600
        }));

        this.logger.info('💾 Memory rate limiters created');
    }

    /**
     * Generic rate limiter middleware
     */
    createLimiter(limiterName, options = {}) {
        return async (req, res, next) => {
            try {
                // Skip if rate limiting is disabled
                if (!config.get('rateLimiting.enabled', true)) {
                    return next();
                }

                const limiter = this.getRateLimiter(limiterName);
                if (!limiter) {
                    this.logger.warn(`⚠️ Rate limiter '${limiterName}' not found`);
                    return next();
                }

                const key = this.getKey(req, options);
                
                // Consume a point
                const result = await limiter.consume(key);
                
                // Add rate limit headers
                this.addRateLimitHeaders(res, result, limiterName);
                
                next();

            } catch (rateLimiterRes) {
                // Rate limit exceeded
                this.handleRateLimitExceeded(req, res, rateLimiterRes, limiterName);
            }
        };
    }

    /**
     * API rate limiter
     */
    apiLimiter = rateLimit({
        windowMs: RATE_LIMITS.API.windowMs,
        max: RATE_LIMITS.API.max,
        message: {
            success: false,
            error: RATE_LIMITS.API.message,
            code: ERROR_TYPES.RATE_LIMIT_ERROR,
            retryAfter: Math.ceil(RATE_LIMITS.API.windowMs / 1000)
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            // Skip rate limiting for health checks
            return req.path === '/health' || req.path === '/metrics';
        },
        keyGenerator: (req) => {
            // Use API key if available, otherwise IP
            return req.headers['x-api-key'] || req.ip;
        },
        /*onLimitReached: (req, res, options) => {
            this.logger.warn('🚦 API rate limit reached', {
                ip: req.ip,
                path: req.path,
                method: req.method,
                apiKey: req.headers['x-api-key'] ? this.maskApiKey(req.headers['x-api-key']) : null,
                timestamp: new Date().toISOString()
            });
        }*/
    });

    /**
     * Bulk operations limiter
     */
    bulkLimiter = this.createLimiter('bulk', {
        keyField: 'x-api-key',
        fallbackToIp: true
    });

    /**
     * Test notifications limiter
     */
    testLimiter = this.createLimiter('test', {
        keyField: 'x-api-key',
        fallbackToIp: true
    });

    /**
     * Admin operations limiter
     */
    adminLimiter = this.createLimiter('admin', {
        keyField: 'user.id',
        fallbackToIp: true
    });

    /**
     * Login attempts limiter
     */
    loginLimiter = this.createLimiter('login', {
        keyField: 'body.username',
        fallbackToIp: true
    });

    /**
     * Authentication failure limiter
     */
    authFailureLimiter = async (req, res, next) => {
        try {
            const limiter = this.getRateLimiter('auth_fail');
            if (!limiter) return next();

            const key = req.ip;
            
            // Check current limit
            const result = await limiter.get(key);
            
            if (result && result.remainingPoints <= 0) {
                return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
                    success: false,
                    error: 'Too many failed authentication attempts',
                    code: ERROR_TYPES.RATE_LIMIT_ERROR,
                    retryAfter: Math.round(result.msBeforeNext / 1000),
                    timestamp: new Date().toISOString()
                });
            }

            next();

        } catch (error) {
            this.logger.error('❌ Auth failure limiter error:', error);
            next(); // Continue on error
        }
    };

    /**
     * Record authentication failure
     */
    recordAuthFailure = async (req) => {
        try {
            const limiter = this.getRateLimiter('auth_fail');
            if (!limiter) return;

            const key = req.ip;
            await limiter.consume(key);

            this.logger.warn('🔒 Authentication failure recorded', {
                ip: req.ip,
                path: req.path,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to record auth failure:', error);
        }
    };

    /**
     * Progressive rate limiter for suspicious activity
     */
    createProgressiveLimiter(baseLimiter, escalationFactor = 2) {
        return async (req, res, next) => {
            try {
                const key = this.getKey(req);
                const suspiciousKey = `suspicious_${key}`;
                
                // Check if this key has been marked as suspicious
                const suspiciousLimiter = this.getRateLimiter('auth_fail');
                let multiplier = 1;
                
                if (suspiciousLimiter) {
                    const suspiciousResult = await suspiciousLimiter.get(suspiciousKey);
                    if (suspiciousResult && suspiciousResult.totalHits > 0) {
                        multiplier = Math.min(escalationFactor ** suspiciousResult.totalHits, 10);
                    }
                }

                // Apply rate limit with multiplier
                const limiter = this.getRateLimiter(baseLimiter);
                if (limiter) {
                    const adjustedPoints = Math.max(1, Math.floor(limiter.points / multiplier));
                    
                    // Create temporary limiter with adjusted points
                    const tempLimiter = new (this.redisClient ? RateLimiterRedis : RateLimiterMemory)({
                        storeClient: this.redisClient,
                        keyPrefix: `${baseLimiter}_progressive`,
                        points: adjustedPoints,
                        duration: limiter.duration,
                        blockDuration: limiter.blockDuration * multiplier
                    });

                    await tempLimiter.consume(key);
                }

                next();

            } catch (rateLimiterRes) {
                this.handleRateLimitExceeded(req, res, rateLimiterRes, `${baseLimiter}_progressive`);
            }
        };
    }

    /**
     * Get appropriate rate limiter
     */
    getRateLimiter(name) {
        return this.rateLimiters.get(name) || this.memoryLimiters.get(name);
    }

    /**
     * Generate rate limiting key
     */
    getKey(req, options = {}) {
        const { keyField, fallbackToIp = true } = options;

        // Try to get key from specified field
        if (keyField) {
            const keys = keyField.split('.');
            let value = req;
            
            for (const key of keys) {
                if (value && typeof value === 'object' && key in value) {
                    value = value[key];
                } else {
                    value = null;
                    break;
                }
            }

            if (value) {
                return String(value);
            }
        }

        // Fallback to IP if specified
        if (fallbackToIp) {
            return req.ip || req.connection?.remoteAddress || 'unknown';
        }

        return 'default';
    }

    /**
     * Add rate limit headers to response
     */
    addRateLimitHeaders(res, result, limiterName) {
        res.set({
            'X-RateLimit-Limit': result.totalHits,
            'X-RateLimit-Remaining': result.remainingPoints,
            'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString(),
            'X-RateLimit-Policy': limiterName
        });
    }

    /**
     * Handle rate limit exceeded
     */
    handleRateLimitExceeded(req, res, rateLimiterRes, limiterName) {
        const retryAfter = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;

        // Log rate limit violation
        this.logger.warn('🚦 Rate limit exceeded', {
            limiter: limiterName,
            ip: req.ip,
            path: req.path,
            method: req.method,
            remaining: rateLimiterRes.remainingPoints,
            retryAfter,
            timestamp: new Date().toISOString()
        });

        // Add headers
        res.set({
            'Retry-After': retryAfter,
            'X-RateLimit-Limit': rateLimiterRes.totalHits,
            'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
            'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString()
        });

        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            success: false,
            error: 'Rate limit exceeded',
            code: ERROR_TYPES.RATE_LIMIT_ERROR,
            retryAfter,
            limit: rateLimiterRes.totalHits,
            remaining: rateLimiterRes.remainingPoints,
            resetTime: new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Mask API key for logging
     */
    maskApiKey(apiKey) {
        if (!apiKey || apiKey.length < 8) {
            return '***';
        }
        return apiKey.substring(0, 8) + '...';
    }

    /**
     * Get rate limit status for key
     */
    async getRateLimitStatus(limiterName, key) {
        try {
            const limiter = this.getRateLimiter(limiterName);
            if (!limiter) {
                return null;
            }

            const result = await limiter.get(key);
            return result ? {
                limit: result.totalHits,
                remaining: result.remainingPoints,
                resetTime: new Date(Date.now() + result.msBeforeNext).toISOString(),
                blocked: result.remainingPoints <= 0
            } : null;

        } catch (error) {
            this.logger.error(`❌ Failed to get rate limit status for ${limiterName}:`, error);
            return null;
        }
    }

    /**
     * Clear rate limit for key
     */
    async clearRateLimit(limiterName, key) {
        try {
            const limiter = this.getRateLimiter(limiterName);
            if (!limiter) {
                return false;
            }

            await limiter.delete(key);
            this.logger.info(`🧹 Rate limit cleared for ${limiterName}:${key}`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Failed to clear rate limit for ${limiterName}:`, error);
            return false;
        }
    }

    /**
     * Get rate limiting statistics
     */
    async getStats() {
        const stats = {
            enabled: config.get('rateLimiting.enabled', true),
            redis: !!this.redisClient,
            limiters: {
                redis: this.rateLimiters.size,
                memory: this.memoryLimiters.size
            },
            timestamp: new Date().toISOString()
        };

        return stats;
    }

    /**
     * Health check
     */
    async healthCheck() {
        const health = {
            healthy: this.initialized,
            redis: this.redisClient ? 'connected' : 'not_available',
            limiters: this.rateLimiters.size + this.memoryLimiters.size,
            timestamp: new Date().toISOString()
        };

        // Test Redis connection if available
        if (this.redisClient) {
            try {
                await this.redisClient.ping();
                health.redis = 'healthy';
            } catch (error) {
                health.redis = 'error';
                health.redisError = error.message;
            }
        }

        return health;
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.logger.info('🧹 Cleaning up rate limiting...');
        
        if (this.redisClient) {
            await this.redisClient.disconnect();
        }
        
        this.rateLimiters.clear();
        this.memoryLimiters.clear();
        this.initialized = false;
        
        this.logger.info('✅ Rate limiting cleaned up');
    }
}

// Create singleton instance
const rateLimitMiddleware = new RateLimitMiddleware();

module.exports = {
    initialize: rateLimitMiddleware.initialize.bind(rateLimitMiddleware),
    apiLimiter: rateLimitMiddleware.apiLimiter,
    bulkLimiter: rateLimitMiddleware.bulkLimiter,
    testLimiter: rateLimitMiddleware.testLimiter,
    adminLimiter: rateLimitMiddleware.adminLimiter,
    loginLimiter: rateLimitMiddleware.loginLimiter,
    authFailureLimiter: rateLimitMiddleware.authFailureLimiter,
    recordAuthFailure: rateLimitMiddleware.recordAuthFailure.bind(rateLimitMiddleware),
    createLimiter: rateLimitMiddleware.createLimiter.bind(rateLimitMiddleware),
    createProgressiveLimiter: rateLimitMiddleware.createProgressiveLimiter.bind(rateLimitMiddleware),
    getRateLimitStatus: rateLimitMiddleware.getRateLimitStatus.bind(rateLimitMiddleware),
    clearRateLimit: rateLimitMiddleware.clearRateLimit.bind(rateLimitMiddleware),
    getStats: rateLimitMiddleware.getStats.bind(rateLimitMiddleware),
    healthCheck: rateLimitMiddleware.healthCheck.bind(rateLimitMiddleware),
    cleanup: rateLimitMiddleware.cleanup.bind(rateLimitMiddleware),
    rateLimitMiddleware
};