// ==========================================
// API ROUTES - VERSIÓN SIMPLIFICADA SIN AUTENTICACIÓN COMPLEJA
// Rutas básicas que funcionan sin problemas de auth
// ==========================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const AppLogger = require('../utils/logger');

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

// Middleware para verificar si el controlador está disponible
const checkController = (req, res, next) => {
    if (!notificationController) {
        return res.status(503).json({
            success: false,
            error: 'Notification service temporarily unavailable',
            code: 'CONTROLLER_UNAVAILABLE',
            message: 'The service is starting up. Please try again in a few moments.',
            timestamp: new Date().toISOString()
        });
    }
    next();
};

// ==========================================
// RATE LIMITING SIMPLIFICADO
// ==========================================

const simpleLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // Límite más alto
    message: {
        success: false,
        error: 'Too many requests, please try again later',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/status';
    }
});

// Aplicar rate limiting suave
router.use(simpleLimiter);

// ==========================================
// HEALTH & STATUS ENDPOINTS
// ==========================================

router.get('/health', (req, res) => {
    try {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            controllers: {
                notification: !!notificationController
            },
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
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

router.get('/status', (req, res) => {
    res.json({
        service: 'Firebase Notification Microservice',
        status: 'running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        controllers: {
            notification: !!notificationController
        }
    });
});

// ==========================================
// NOTIFICATION ENDPOINTS
// ==========================================

// Endpoint de prueba simple
router.post('/test', (req, res) => {
    logger.info('📤 Test endpoint called');
    res.json({
        success: true,
        message: 'Test endpoint working',
        timestamp: new Date().toISOString(),
        body: req.body,
        controllerAvailable: !!notificationController
    });
});

// Send single notification
router.post('/notifications/send', checkController, async (req, res) => {
    try {
        logger.info('📤 Send notification request received');
        await notificationController.sendNotification(req, res);
    } catch (error) {
        logger.error('❌ Send notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Send bulk notifications  
router.post('/notifications/bulk', checkController, async (req, res) => {
    try {
        logger.info('📬 Bulk notification request received');
        await notificationController.sendBulkNotifications(req, res);
    } catch (error) {
        logger.error('❌ Bulk notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Send test notification
router.post('/notifications/test', checkController, async (req, res) => {
    try {
        logger.info('🧪 Test notification request received');
        await notificationController.testNotification(req, res);
    } catch (error) {
        logger.error('❌ Test notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get notification status
router.get('/notifications/:id', checkController, async (req, res) => {
    try {
        logger.info(`📋 Get notification status: ${req.params.id}`);
        await notificationController.getNotificationStatus(req, res);
    } catch (error) {
        logger.error('❌ Get notification status error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

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
router.get('/notifications', checkController, async (req, res) => {
    try {
        logger.info('📋 List notifications request received');
        await notificationController.listNotifications(req, res);
    } catch (error) {
        logger.error('❌ List notifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

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
// STATISTICS ENDPOINTS
// ==========================================

router.get('/stats', checkController, async (req, res) => {
    try {
        logger.info('📊 Stats request received');
        await notificationController.getNotificationStats(req, res);
    } catch (error) {
        logger.error('❌ Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// QUEUE MANAGEMENT ENDPOINTS
// ==========================================

router.get('/queue/status', checkController, async (req, res) => {
    try {
        logger.info('📦 Queue status request received');
        await notificationController.getQueueStatus(req, res);
    } catch (error) {
        logger.error('❌ Queue status error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// API DOCUMENTATION
// ==========================================

router.get('/docs', (req, res) => {
    res.json({
        service: 'Firebase Notification Microservice API',
        version: '1.0.0',
        description: 'REST API for Firebase push notification management',
        endpoints: {
            health: {
                path: '/api/health',
                method: 'GET',
                description: 'Check service health'
            },
            test: {
                path: '/api/test',
                method: 'POST',
                description: 'Test endpoint'
            },
            sendNotification: {
                path: '/api/notifications/send',
                method: 'POST',
                description: 'Send a single notification'
            },
            bulkNotifications: {
                path: '/api/notifications/bulk',
                method: 'POST',
                description: 'Send multiple notifications'
            },
            listNotifications: {
                path: '/api/notifications',
                method: 'GET',
                description: 'List notifications with pagination'
            },
            getNotification: {
                path: '/api/notifications/:id',
                method: 'GET',
                description: 'Get notification status'
            },
            stats: {
                path: '/api/stats',
                method: 'GET',
                description: 'Get service statistics'
            },
            queueStatus: {
                path: '/api/queue/status',
                method: 'GET',
                description: 'Get queue status'
            }
        },
        timestamp: new Date().toISOString()
    });
});

// API root endpoint
router.get('/', (req, res) => {
    res.json({
        service: 'Firebase Microservice API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        status: 'running',
        endpoints: {
            health: '/api/health',
            test: '/api/test',
            notifications: '/api/notifications',
            docs: '/api/docs'
        },
        controllerStatus: {
            notification: !!notificationController
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
            'GET /api/health',
            'POST /api/test',
            'GET /api/notifications',
            'POST /api/notifications/send',
            'GET /api/docs'
        ]
    });
});

module.exports = router;