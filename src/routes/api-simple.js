// ==========================================
// API ROUTES - OPTIMIZED VERSION
// Clean routes with proper error handling and validation
// ==========================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const AppLogger = require('../utils/logger');
const { asyncHandler, createServiceError } = require('../middleware/errorHandler');

const router = express.Router();
const logger = new AppLogger('APIRoutes');

// ==========================================
// CONTROLADOR DE NOTIFICACIONES
// ==========================================

let notificationController = null;

// Función para setear el controlador externamente
router.setController = (controller) => {
    notificationController = controller;
    logger.info('✅ Notification controller set');
};

// Enhanced middleware to check controller availability
const checkController = (req, res, next) => {
    if (!notificationController) {
        throw createServiceError('NotificationController', 'Controller not available');
    }
    next();
};

// ==========================================
// ENHANCED RATE LIMITING
// ==========================================

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: process.env.NODE_ENV === 'development' ? 10000 : 1000,
    message: {
        success: false,
        error: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return req.path === '/health' || req.path === '/status';
    },
    keyGenerator: (req) => {
        // Use API key if available, otherwise IP
        return req.headers['x-api-key'] || req.ip;
    }
});

// Apply rate limiting
router.use(apiLimiter);

// ==========================================
// ENHANCED HEALTH & STATUS ENDPOINTS
// ==========================================

router.get('/health', asyncHandler(async (req, res) => {
    try {
        // Enhanced health check with controller status
        const controllerHealth = notificationController ? 
            await notificationController.healthCheck() : 
            { status: 'unavailable' };

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            controller: controllerHealth,
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                usage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
            code: 'HEALTH_CHECK_FAILED'
        });
    }
}));

router.get('/status', asyncHandler(async (req, res) => {
    res.json({
        service: 'Firebase Notification Microservice',
        status: 'running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        components: {
            controller: !!notificationController,
            initialized: notificationController ? !!notificationController.notificationService : false
        }
    });
}));

// ==========================================
// ENHANCED NOTIFICATION ENDPOINTS
// ==========================================

// Enhanced test endpoint
router.post('/test', asyncHandler(async (req, res) => {
    logger.info('📤 Test endpoint called');
    
    // Simulate processing delay for testing
    if (req.body.delay) {
        await new Promise(resolve => setTimeout(resolve, parseInt(req.body.delay) || 100));
    }
    
    res.json({
        success: true,
        message: 'Test endpoint working',
        timestamp: new Date().toISOString(),
        echo: req.body,
        controller: {
            available: !!notificationController,
            serviceReady: notificationController ? !!notificationController.notificationService : false
        },
        system: {
            uptime: process.uptime(),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            environment: process.env.NODE_ENV
        }
    });
}));

// Send single notification
router.post('/notifications/send', checkController, asyncHandler(async (req, res) => {
    logger.info('📤 Send notification request received');
    await notificationController.sendNotification(req, res);
}));

// Send bulk notifications  
router.post('/notifications/bulk', checkController, asyncHandler(async (req, res) => {
    logger.info('📬 Bulk notification request received');
    await notificationController.sendBulkNotifications(req, res);
}));

// Send test notification
router.post('/notifications/test', checkController, asyncHandler(async (req, res) => {
    logger.info('🧪 Test notification request received');
    await notificationController.testNotification(req, res);
}));

// Get notification status
router.get('/notifications/:id', checkController, asyncHandler(async (req, res) => {
    logger.info(`📋 Get notification status: ${req.params.id}`);
    await notificationController.getNotificationStatus(req, res);
}));

// Get notification details
router.get('/notifications/:id/details', checkController, async (req, res) => {
    try {
        logger.info(`📋 Get notification details: ${req.params.id}`);
        await notificationController.getNotificationDetails(req, res);
    } catch (error) {
        logger.error('❌ Get notification details error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// List notifications
router.get('/notifications', checkController, asyncHandler(async (req, res) => {
    logger.info('📋 List notifications request received');
    await notificationController.listNotifications(req, res);
}));

// Cancel notification
router.post('/notifications/:id/cancel', checkController, async (req, res) => {
    try {
        logger.info(`❌ Cancel notification: ${req.params.id}`);
        await notificationController.cancelNotification(req, res);
    } catch (error) {
        logger.error('❌ Cancel notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Retry notification
router.post('/notifications/:id/retry', checkController, async (req, res) => {
    try {
        logger.info(`🔄 Retry notification: ${req.params.id}`);
        await notificationController.retryNotification(req, res);
    } catch (error) {
        logger.error('❌ Retry notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// TOKEN MANAGEMENT ENDPOINTS
// ==========================================

router.post('/tokens/validate', checkController, async (req, res) => {
    try {
        logger.info('🔍 Validate tokens request received');
        await notificationController.validateTokens(req, res);
    } catch (error) {
        logger.error('❌ Validate tokens error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// ENHANCED STATISTICS ENDPOINTS
// ==========================================

router.get('/stats', checkController, asyncHandler(async (req, res) => {
    logger.info('📊 Stats request received');
    await notificationController.getNotificationStats(req, res);
}));

// ==========================================
// ENHANCED QUEUE MANAGEMENT ENDPOINTS
// ==========================================

router.get('/queue/status', checkController, asyncHandler(async (req, res) => {
    logger.info('📦 Queue status request received');
    await notificationController.getQueueStatus(req, res);
}));

// ==========================================
// ENHANCED API DOCUMENTATION
// ==========================================

router.get('/docs', asyncHandler(async (req, res) => {
    res.json({
        service: 'Firebase Notification Microservice API',
        version: '1.0.0',
        description: 'REST API for Firebase push notification management',
        documentation: 'https://github.com/your-org/firebase-microservice/docs',
        endpoints: {
            health: {
                path: '/api/health',
                method: 'GET',
                description: 'Check service health',
                auth: false
            },
            test: {
                path: '/api/test',
                method: 'POST',
                description: 'Test endpoint with echo functionality',
                auth: false
            },
            sendNotification: {
                path: '/api/notifications/send',
                method: 'POST',
                description: 'Send a single notification',
                auth: true,
                rateLimit: '1000/15min'
            },
            bulkNotifications: {
                path: '/api/notifications/bulk',
                method: 'POST',
                description: 'Send multiple notifications',
                auth: true,
                rateLimit: '10/hour'
            },
            listNotifications: {
                path: '/api/notifications',
                method: 'GET',
                description: 'List notifications with pagination and filtering',
                auth: true,
                parameters: ['page', 'limit', 'status', 'type', 'userId']
            },
            getNotification: {
                path: '/api/notifications/:id',
                method: 'GET',
                description: 'Get notification status by ID',
                auth: true
            },
            stats: {
                path: '/api/stats',
                method: 'GET',
                description: 'Get service statistics and metrics',
                auth: true,
                parameters: ['period', 'groupBy', 'type', 'status']
            },
            queueStatus: {
                path: '/api/queue/status',
                method: 'GET',
                description: 'Get queue status and worker information',
                auth: true
            }
        },
        authentication: {
            type: 'API Key',
            header: 'X-API-Key',
            description: 'Include your API key in the X-API-Key header'
        },
        rateLimit: {
            window: '15 minutes',
            max: process.env.NODE_ENV === 'development' ? '10000' : '1000',
            note: 'Rate limits are per API key or IP address'
        },
        timestamp: new Date().toISOString()
    });
}));

// Enhanced API root endpoint
router.get('/', asyncHandler(async (req, res) => {
    const controllerStatus = notificationController ? 
        await notificationController.healthCheck() : 
        { status: 'unavailable' };

    res.json({
        service: 'Firebase Microservice API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        status: 'running',
        uptime: process.uptime(),
        endpoints: {
            health: '/api/health',
            test: '/api/test',
            notifications: '/api/notifications',
            docs: '/api/docs',
            stats: '/api/stats',
            queue: '/api/queue/status'
        },
        system: {
            controller: controllerStatus,
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            environment: process.env.NODE_ENV || 'development'
        }
    });
}));

// ==========================================
// ENHANCED ERROR HANDLING
// ==========================================

// Handle 404 for API routes
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        code: 'ENDPOINT_NOT_FOUND',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        suggestion: 'Check the API documentation at /api/docs',
        availableEndpoints: [
            'GET /api/health',
            'GET /api/status',
            'POST /api/test',
            'GET /api/notifications',
            'POST /api/notifications/send',
            'POST /api/notifications/bulk',
            'GET /api/stats',
            'GET /api/queue/status',
            'GET /api/docs'
        ]
    });
});

module.exports = router;