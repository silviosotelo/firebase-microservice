// ==========================================
// UNIFIED NOTIFICATION ROUTES
// Combines controller methods with direct DB access
// ==========================================

const express = require('express');
const database = require('../config/database');
const { requireRole } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');
const AppLogger = require('../utils/logger');

// Import the corrected controller
const { getNotificationController } = require('../controllers/notificationController');

const router = express.Router();
const logger = new AppLogger('NotificationRoutes');

// Get controller instance
let controller = null;
try {
    controller = getNotificationController();
    logger.info('✅ Notification controller loaded successfully');
} catch (error) {
    logger.error('❌ Failed to load notification controller:', error);
}

// Middleware to check controller availability
const checkController = (req, res, next) => {
    if (!controller) {
        return res.status(503).json({
            success: false,
            error: 'Notification service temporarily unavailable',
            code: 'CONTROLLER_UNAVAILABLE'
        });
    }
    next();
};

// ==========================================
// CORE NOTIFICATION ENDPOINTS (Using Controller)
// ==========================================

// Send single notification
router.post('/send', checkController, controller.sendNotification);

// Send bulk notifications  
router.post('/bulk', checkController, controller.sendBulkNotifications);

// Get notification status
router.get('/:id', checkController, controller.getNotificationStatus);

// Get notification details
router.get('/:id/details', checkController, controller.getNotificationDetails);

// List notifications (with pagination)
router.get('/', checkController, controller.listNotifications);

// Cancel notification
router.post('/:id/cancel', checkController, controller.cancelNotification);

// Retry notification
router.post('/:id/retry', checkController, controller.retryNotification);

// Test notification
router.post('/test', checkController, controller.testNotification);

// Validate tokens
router.post('/validate-tokens', checkController, controller.validateTokens);

// Get delivery report
router.get('/:id/delivery-report', checkController, controller.getDeliveryReport);

// Get queue status
router.get('/queue/status', checkController, controller.getQueueStatus);

// ==========================================
// ANALYTICS & REPORTING ENDPOINTS (Direct DB Access)
// ==========================================

/**
 * Get notification tracking information
 * GET /api/notifications/:id/tracking
 */
router.get('/:id/tracking', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const models = database.getModels();

        if (!models) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        // Get notification using model
        const notification = await models.Notification.findById(notificationId);
        
        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Notification not found'
            });
        }

        // Get response details
        const responses = await models.Response.findByNotificationId(notificationId);
        const responseSummary = await models.Response.getSummaryByNotificationId(notificationId);

        // Calculate delivery timeline
        const timeline = [
            {
                event: 'Created',
                timestamp: notification.created_at,
                status: 'queued'
            }
        ];

        if (notification.started_at) {
            timeline.push({
                event: 'Processing Started',
                timestamp: notification.started_at,
                status: 'processing'
            });
        }

        if (notification.completed_at) {
            timeline.push({
                event: 'Processing Completed',
                timestamp: notification.completed_at,
                status: notification.status
            });
        }

        res.json({
            success: true,
            data: {
                notification: {
                    id: notification.id,
                    requestId: notification.request_id,
                    title: notification.title,
                    status: notification.status,
                    totalSent: notification.total_sent,
                    successful: notification.successful,
                    failed: notification.failed,
                    successRate: notification.success_rate
                },
                tracking: {
                    timeline,
                    responseSummary,
                    recentAttempts: responses.slice(0, 10).map(r => ({
                        token: r.token ? r.token.substring(0, 20) + '...' : 'N/A',
                        success: Boolean(r.success),
                        messageId: r.firebase_message_id,
                        errorCode: r.error_code,
                        errorMessage: r.error_message,
                        timestamp: r.created_at
                    }))
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Notification tracking error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get tracking information',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get notification statistics - ENHANCED VERSION
 * GET /api/notifications/stats
 */
router.get('/stats', async (req, res) => {
    try {
        // First try to get stats from controller (includes queue info)
        if (controller) {
            try {
                // Call controller method but don't use res object
                const statsResult = await controller.notificationService.getStats(req.query);
                return res.json({
                    success: true,
                    data: statsResult,
                    source: 'controller',
                    timestamp: new Date().toISOString()
                });
            } catch (controllerError) {
                logger.warn('Controller stats failed, falling back to direct DB:', controllerError.message);
            }
        }

        // Fallback to direct database access
        const { period = '24h', groupBy = 'hour' } = req.query;
        const db = database.getConnection();

        if (!db) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        // Calculate date range based on period
        let dateCondition = '';
        switch (period) {
            case '1h':
                dateCondition = "created_at >= datetime('now', '-1 hour')";
                break;
            case '24h':
                dateCondition = "created_at >= datetime('now', '-1 day')";
                break;
            case '7d':
                dateCondition = "created_at >= datetime('now', '-7 days')";
                break;
            case '30d':
                dateCondition = "created_at >= datetime('now', '-30 days')";
                break;
            default:
                dateCondition = "created_at >= datetime('now', '-1 day')";
        }

        // Get overall statistics
        const overallStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(total_sent) as total_sent,
                SUM(successful) as total_successful,
                SUM(failed) as total_failed,
                AVG(success_rate) as avg_success_rate,
                AVG(processing_time) as avg_processing_time
            FROM notifications 
            WHERE ${dateCondition}
        `).get();

        // Get time series data
        let timeFormat = '';
        switch (groupBy) {
            case 'hour':
                timeFormat = "strftime('%Y-%m-%d %H:00', created_at)";
                break;
            case 'day':
                timeFormat = "strftime('%Y-%m-%d', created_at)";
                break;
            case 'week':
                timeFormat = "strftime('%Y-W%W', created_at)";
                break;
            default:
                timeFormat = "strftime('%Y-%m-%d %H:00', created_at)";
        }

        const timeSeries = db.prepare(`
            SELECT 
                ${timeFormat} as period,
                COUNT(*) as total,
                SUM(total_sent) as total_sent,
                SUM(successful) as successful,
                SUM(failed) as failed,
                AVG(success_rate) as avg_success_rate
            FROM notifications 
            WHERE ${dateCondition}
            GROUP BY ${timeFormat}
            ORDER BY period ASC
        `).all();

        res.json({
            success: true,
            data: {
                period,
                groupBy,
                overall: overallStats,
                historical: { timeSeries },
                source: 'database'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Notification stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get notification statistics',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get notification delivery analytics
 * GET /api/notifications/analytics/delivery
 */
router.get('/analytics/delivery', async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        const db = database.getConnection();

        if (!db) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        // Calculate date range
        let dateCondition = '';
        switch (period) {
            case '24h':
                dateCondition = "fr.created_at >= datetime('now', '-1 day')";
                break;
            case '7d':
                dateCondition = "fr.created_at >= datetime('now', '-7 days')";
                break;
            case '30d':
                dateCondition = "fr.created_at >= datetime('now', '-30 days')";
                break;
            default:
                dateCondition = "fr.created_at >= datetime('now', '-7 days')";
        }

        // Get error analysis
        const errorAnalysis = db.prepare(`
            SELECT 
                error_code,
                error_message,
                COUNT(*) as count,
                COUNT(DISTINCT notification_id) as affected_notifications
            FROM firebase_responses fr
            WHERE ${dateCondition} AND success = 0
            GROUP BY error_code, error_message
            ORDER BY count DESC
            LIMIT 10
        `).all();

        // Get delivery success rate by hour
        const hourlyDelivery = db.prepare(`
            SELECT 
                strftime('%Y-%m-%d %H:00', fr.created_at) as hour,
                COUNT(*) as total_attempts,
                SUM(success) as successful_attempts,
                ROUND((SUM(success) * 100.0 / COUNT(*)), 2) as success_rate
            FROM firebase_responses fr
            WHERE ${dateCondition}
            GROUP BY strftime('%Y-%m-%d %H:00', fr.created_at)
            ORDER BY hour ASC
        `).all();

        // Get delivery performance by notification type
        const typePerformance = db.prepare(`
            SELECT 
                n.type,
                COUNT(fr.id) as total_deliveries,
                SUM(fr.success) as successful_deliveries,
                ROUND((SUM(fr.success) * 100.0 / COUNT(fr.id)), 2) as success_rate,
                AVG(n.processing_time) as avg_processing_time
            FROM notifications n
            JOIN firebase_responses fr ON n.id = fr.notification_id
            WHERE ${dateCondition}
            GROUP BY n.type
            ORDER BY success_rate DESC
        `).all();

        res.json({
            success: true,
            data: {
                period,
                deliveryAnalytics: {
                    errorAnalysis,
                    hourlyDeliveryRates: hourlyDelivery,
                    performanceByType: typePerformance
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Delivery analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get delivery analytics',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Search notifications
 * POST /api/notifications/search
 */
router.post('/search', async (req, res) => {
    try {
        const {
            query,
            filters = {},
            page = 1,
            limit = 50,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.body;

        const models = database.getModels();
        if (!models) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        // Use model search method if available
        const searchOptions = {
            query,
            filters,
            page,
            limit,
            sortBy,
            sortOrder
        };

        const result = await models.Notification.search(searchOptions);

        res.json({
            success: true,
            data: {
                query,
                filters,
                results: result.data,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.total,
                    totalPages: Math.ceil(result.total / limit)
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Notification search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search notifications',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get user notification history
 * GET /api/notifications/user/:userId/history
 */
router.get('/user/:userId/history', async (req, res) => {
    try {
        const userId = req.params.userId;
        const { 
            page = 1, 
            limit = 20, 
            status,
            type,
            date_from,
            date_to 
        } = req.query;

        const models = database.getModels();
        if (!models) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        const filters = { user_id: userId };
        if (status) filters.status = status;
        if (type) filters.type = type;
        if (date_from) filters.created_at_from = date_from;
        if (date_to) filters.created_at_to = date_to;

        const result = await models.Notification.findMany({
            filters,
            limit: Math.min(parseInt(limit), 100),
            offset: (parseInt(page) - 1) * parseInt(limit),
            sortBy: 'created_at',
            sortOrder: 'DESC'
        });

        // Get user statistics
        const userStats = await models.Notification.getUserStats(userId);

        res.json({
            success: true,
            data: {
                userId,
                notifications: result.data,
                userStatistics: userStats,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.total,
                    totalPages: Math.ceil(result.total / parseInt(limit))
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ User notification history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user notification history',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Bulk operations on notifications (Admin only)
 * POST /api/notifications/bulk/:operation
 */
router.post('/bulk/:operation', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const operation = req.params.operation;
        const { notification_ids, filters } = req.body;

        if (!notification_ids && !filters) {
            return res.status(400).json({
                success: false,
                error: 'Either notification_ids or filters must be provided'
            });
        }

        const models = database.getModels();
        if (!models) {
            return res.status(500).json({
                success: false,
                error: 'Database not available'
            });
        }

        let affectedCount = 0;

        switch (operation) {
            case 'delete':
                if (notification_ids) {
                    affectedCount = await models.Notification.deleteMany(notification_ids);
                } else if (filters) {
                    affectedCount = await models.Notification.deleteByFilters(filters);
                }
                break;

            case 'cancel':
                if (notification_ids) {
                    affectedCount = await models.Notification.bulkUpdateStatus(
                        notification_ids, 
                        'cancelled'
                    );
                }
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid bulk operation'
                });
        }

        logger.info(`🔧 Bulk ${operation} operation: ${affectedCount} notifications affected`);

        res.json({
            success: true,
            message: `Bulk ${operation} completed`,
            data: {
                operation,
                affectedCount
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Bulk operation error:', error);
        res.status(500).json({
            success: false,
            error: 'Bulk operation failed',
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;