// ==========================================
// API ROUTES - FIXED VERSION
// Main REST API endpoints using corrected controllers
// ==========================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const AppLogger = require('../utils/logger');

// Import the CORRECTED controller using the factory pattern
const { getNotificationController } = require('../controllers/notificationController');

// Import other controllers
let StatsController = null;
let HealthController = null;
let ConfigController = null;

try {
    StatsController = require('../controllers/statsController');
} catch (error) {
    console.warn('⚠️ StatsController not available:', error.message);
}

try {
    HealthController = require('../controllers/healthController');
} catch (error) {
    console.warn('⚠️ HealthController not available:', error.message);
}

try {
    ConfigController = require('../controllers/configController');
} catch (error) {
    console.warn('⚠️ ConfigController not available:', error.message);
}

const { requireRole } = require('../middleware/auth');
const { RATE_LIMITS, USER_ROLES } = require('../utils/constants');

const router = express.Router();
const logger = new AppLogger('APIRoutes');

// ==========================================
// INITIALIZE NOTIFICATION CONTROLLER
// ==========================================

let notificationController = null;

// Function to initialize controller with dependencies from app
function initializeControllerWithDependencies(app) {
    try {
        if (app && app.getNotificationController) {
            notificationController = app.getNotificationController();
            logger.info('✅ Notification controller obtained from app');
        } else {
            // Fallback to factory function without dependencies
            notificationController = getNotificationController();
            logger.warn('⚠️ Using notification controller without full dependencies');
        }
        return true;
    } catch (error) {
        logger.error('❌ Failed to initialize notification controller:', error);
        return false;
    }
}

// Export function to set controller from app
module.exports.setController = (controller) => {
    notificationController = controller;
    logger.info('✅ Notification controller set externally');
};

// Middleware to check if notification controller is available
const checkNotificationController = (req, res, next) => {
    if (!notificationController) {
        return res.status(503).json({
            success: false,
            error: 'Notification service temporarily unavailable',
            code: 'CONTROLLER_UNAVAILABLE',
            timestamp: new Date().toISOString()
        });
    }
    next();
};

// ==========================================
// RATE LIMITING
// ==========================================

const apiLimiter = rateLimit({
    windowMs: RATE_LIMITS?.API?.windowMs || 15 * 60 * 1000, // 15 minutes default
    max: RATE_LIMITS?.API?.max || 100,
    message: {
        success: false,
        error: RATE_LIMITS?.API?.message || 'Too many requests',
        retryAfter: Math.ceil((RATE_LIMITS?.API?.windowMs || 15 * 60 * 1000) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return req.path === '/health';
    }
});

const bulkLimiter = rateLimit({
    windowMs: RATE_LIMITS?.BULK?.windowMs || 60 * 60 * 1000, // 1 hour default
    max: RATE_LIMITS?.BULK?.max || 10,
    message: {
        success: false,
        error: RATE_LIMITS?.BULK?.message || 'Too many bulk requests',
        retryAfter: Math.ceil((RATE_LIMITS?.BULK?.windowMs || 60 * 60 * 1000) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

const testLimiter = rateLimit({
    windowMs: RATE_LIMITS?.TEST?.windowMs || 5 * 60 * 1000, // 5 minutes default
    max: RATE_LIMITS?.TEST?.max || 20,
    message: {
        success: false,
        error: RATE_LIMITS?.TEST?.message || 'Too many test requests',
        retryAfter: Math.ceil((RATE_LIMITS?.TEST?.windowMs || 5 * 60 * 1000) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply general rate limiting
router.use(apiLimiter);

// ==========================================
// HEALTH & STATUS ENDPOINTS
// ==========================================

router.get('/health', async (req, res) => {
    try {
        if (HealthController && HealthController.getHealth) {
            return await HealthController.getHealth(req, res);
        }
        
        // Fallback health check
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            controllers: {
                notification: !!notificationController,
                stats: !!StatsController,
                health: !!HealthController,
                config: !!ConfigController
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

if (HealthController && requireRole) {
    router.get('/health/detailed', requireRole(USER_ROLES?.ADMIN || 'admin'), HealthController.getDetailedHealth);
}

if (StatsController) {
    router.get('/status', StatsController.getSystemStatus);
}

// ==========================================
// NOTIFICATION ENDPOINTS - USING CORRECTED CONTROLLER
// ==========================================

// Send single notification
router.post('/notifications/send', checkNotificationController, (req, res, next) => {
    notificationController.sendNotification(req, res, next);
});

// Send bulk notifications  
router.post('/notifications/bulk', bulkLimiter, checkNotificationController, (req, res, next) => {
    notificationController.sendBulkNotifications(req, res, next);
});

// Send test notification
router.post('/notifications/test', testLimiter, checkNotificationController, (req, res, next) => {
    notificationController.testNotification(req, res, next);
});

// Get notification status
router.get('/notifications/:id', checkNotificationController, (req, res, next) => {
    notificationController.getNotificationStatus(req, res, next);
});

// Get notification details
router.get('/notifications/:id/details', checkNotificationController, (req, res, next) => {
    notificationController.getNotificationDetails(req, res, next);
});

// Cancel notification
router.post('/notifications/:id/cancel', checkNotificationController, (req, res, next) => {
    notificationController.cancelNotification(req, res, next);
});

// Retry notification
router.post('/notifications/:id/retry', checkNotificationController, (req, res, next) => {
    notificationController.retryNotification(req, res, next);
});

// List notifications - THIS WAS THE PROBLEMATIC ENDPOINT
router.get('/notifications', checkNotificationController, (req, res, next) => {
    notificationController.listNotifications(req, res, next);
});

// Get delivery report
router.get('/notifications/:id/delivery-report', checkNotificationController, (req, res, next) => {
    notificationController.getDeliveryReport(req, res, next);
});

// ==========================================
// TOKEN MANAGEMENT ENDPOINTS
// ==========================================

router.post('/tokens/validate', checkNotificationController, (req, res, next) => {
    notificationController.validateTokens(req, res, next);
});

// ==========================================
// STATISTICS ENDPOINTS
// ==========================================

if (StatsController) {
    router.get('/stats', StatsController.getStats);
    router.get('/stats/realtime', StatsController.getRealtimeStats);
    
    if (requireRole) {
        router.get('/stats/export', requireRole(USER_ROLES?.ADMIN || 'admin'), StatsController.exportStats);
    }
} else {
    // Fallback stats endpoint using notification controller
    router.get('/stats', checkNotificationController, (req, res, next) => {
        notificationController.getNotificationStats(req, res, next);
    });
}

// ==========================================
// QUEUE MANAGEMENT ENDPOINTS
// ==========================================

if (StatsController) {
    router.get('/queue/status', StatsController.getQueueStatus);
    
    if (requireRole) {
        router.post('/queue/pause', requireRole(USER_ROLES?.ADMIN || 'admin'), StatsController.pauseQueue);
        router.post('/queue/resume', requireRole(USER_ROLES?.ADMIN || 'admin'), StatsController.resumeQueue);
        router.post('/queue/clear', requireRole(USER_ROLES?.SUPER_ADMIN || 'super_admin'), StatsController.clearFailedJobs);
    }
} else {
    // Fallback queue status using notification controller
    router.get('/queue/status', checkNotificationController, (req, res, next) => {
        notificationController.getQueueStatus(req, res, next);
    });
}

// ==========================================
// CONFIGURATION ENDPOINTS (Admin Only)
// ==========================================

if (ConfigController && requireRole) {
    router.get('/config', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.getConfig);
    router.post('/config', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.updateConfig);
    router.get('/config/firebase', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.getFirebaseConfig);
    router.post('/config/test', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.testConfiguration);
    router.post('/webhooks/register', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.registerWebhook);
    router.get('/webhooks', requireRole(USER_ROLES?.ADMIN || 'admin'), ConfigController.listWebhooks);
}

// ==========================================
// SYSTEM MAINTENANCE ENDPOINTS
// ==========================================

if (StatsController && requireRole) {
    router.post('/maintenance/cleanup', requireRole(USER_ROLES?.ADMIN || 'admin'), StatsController.cleanupOldData);
    router.post('/maintenance/cache/clear', requireRole(USER_ROLES?.ADMIN || 'admin'), StatsController.clearCaches);
}

// ==========================================
// METRICS ENDPOINT (Prometheus compatible)
// ==========================================

if (StatsController) {
    router.get('/metrics', StatsController.getPrometheusMetrics);
} else {
    router.get('/metrics', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send('# Firebase Microservice Metrics\n# Metrics service not available\n');
    });
}

// ==========================================
// API DOCUMENTATION
// ==========================================

router.get('/docs/openapi.json', (req, res) => {
    res.json({
        openapi: '3.0.0',
        info: {
            title: 'Firebase Notification Microservice API',
            version: '1.0.0',
            description: 'REST API for Firebase push notification management'
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 3000}/api`,
                description: 'Development server'
            }
        ],
        paths: {
            '/notifications/send': {
                post: {
                    summary: 'Send notification',
                    description: 'Queue a notification for processing'
                }
            },
            '/notifications': {
                get: {
                    summary: 'List notifications',
                    description: 'Get paginated list of notifications'
                }
            },
            '/health': {
                get: {
                    summary: 'Health check',
                    description: 'Check service health'
                }
            }
        },
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key'
                }
            }
        }
    });
});

// API root endpoint
router.get('/', (req, res) => {
    res.json({
        service: 'Firebase Microservice API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            notifications: '/api/notifications',
            queue: '/api/queue/status', 
            stats: '/api/stats',
            health: '/api/health'
        },
        documentation: {
            interactive: '/docs',
            openapi: '/api/docs/openapi.json'
        },
        status: {
            notificationController: !!notificationController,
            controllers: {
                stats: !!StatsController,
                health: !!HealthController,
                config: !!ConfigController
            }
        }
    });
});

// ==========================================
// ERROR HANDLING
// ==========================================

// Handle 404 for API routes
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
            'GET /api/notifications',
            'POST /api/notifications/send',
            'GET /api/health',
            'GET /api/stats',
            'GET /api/queue/status'
        ]
    });
});

module.exports = router;