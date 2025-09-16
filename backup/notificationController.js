// ==========================================
// NOTIFICATION CONTROLLER - UPDATED VERSION
// Uses the fixed NotificationService with proper model injection
// ==========================================

const NotificationService = require('../services/notificationService');
const { validateNotificationRequest, validatePagination } = require('../utils/validators');
const AppLogger = require('../utils/logger');
const { NOTIFICATION_STATUS } = require('../utils/constants');

class NotificationController {
    constructor(models = null, queueService = null, websocketService = null) {
        this.logger = new AppLogger('NotificationController');
        this.models = models;
        this.queueService = queueService;
        this.websocketService = websocketService;
        
        // Initialize notification service with dependencies
        this.notificationService = null;
        this.initializeService();
        
        // Bind all methods to maintain context
        this.sendNotification = this.sendNotification.bind(this);
        this.sendBulkNotifications = this.sendBulkNotifications.bind(this);
        this.getNotificationStatus = this.getNotificationStatus.bind(this);
        this.getNotificationDetails = this.getNotificationDetails.bind(this);
        this.listNotifications = this.listNotifications.bind(this);
        this.cancelNotification = this.cancelNotification.bind(this);
        this.retryNotification = this.retryNotification.bind(this);
        this.getNotificationStats = this.getNotificationStats.bind(this);
        this.getQueueStatus = this.getQueueStatus.bind(this);
        this.testNotification = this.testNotification.bind(this);
        this.validateTokens = this.validateTokens.bind(this);
        this.getDeliveryReport = this.getDeliveryReport.bind(this);
        
        this.logger.info('✅ NotificationController initialized with bound methods');
    }

    /**
     * Initialize the notification service with dependencies
     */
    async initializeService() {
        try {
            if (!this.models) {
                this.logger.warn('⚠️ No models provided to NotificationController');
                return;
            }

            this.notificationService = new NotificationService(
                this.websocketService,
                this.models,
                this.queueService
            );
            
            await this.notificationService.initialize();
            this.logger.info('✅ NotificationService initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize NotificationService:', error);
            this.notificationService = null;
        }
    }

    /**
     * Check if notification service is available
     */
    checkService() {
        if (!this.notificationService) {
            throw new Error('Notification service not available - check initialization');
        }
    }

    /**
     * Send notification endpoint
     * POST /api/notifications/send
     */
    async sendNotification(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error: this or logger undefined in sendNotification');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            this.logger.info(`📤 Send notification request from ${req.ip}`);
            
            // Validate request
            const { error, value } = validateNotificationRequest(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: error.details.map(d => ({
                        field: d.path.join('.'),
                        message: d.message
                    }))
                });
            }

            // Process notification
            const result = await this.notificationService.queueNotification(value, {
                requestId: req.headers['x-request-id'] || this.generateRequestId(),
                userAgent: req.headers['user-agent'],
                clientIp: req.ip
            });

            this.logger.info(`✅ Notification queued: ${result.notificationId}`);

            res.status(202).json({
                success: true,
                message: 'Notification queued for processing',
                data: {
                    notificationId: result.notificationId,
                    requestId: result.requestId,
                    estimatedProcessingTime: result.estimatedProcessingTime
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Send notification failed:', error);
            next(error);
        }
    }

    /**
     * Send bulk notifications endpoint
     * POST /api/notifications/bulk
     */
    async sendBulkNotifications(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in sendBulkNotifications');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            this.logger.info(`📬 Bulk notification request from ${req.ip}`);
            
            const { notifications } = req.body;
            
            if (!Array.isArray(notifications) || notifications.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Notifications array is required and must not be empty'
                });
            }

            if (notifications.length > 1000) {
                return res.status(400).json({
                    success: false,
                    error: 'Maximum 1000 notifications allowed per batch'
                });
            }

            // Validate each notification
            const validationResults = notifications.map((notif, index) => {
                const { error, value } = validateNotificationRequest(notif);
                return { index, error, value };
            });

            const validNotifications = validationResults
                .filter(r => !r.error)
                .map(r => r.value);

            const invalidNotifications = validationResults
                .filter(r => r.error)
                .map(r => ({
                    index: r.index,
                    errors: r.error.details.map(d => ({
                        field: d.path.join('.'),
                        message: d.message
                    }))
                }));

            if (validNotifications.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid notifications found',
                    invalidNotifications
                });
            }

            // Process bulk notifications
            const result = await this.notificationService.queueBulkNotifications(
                validNotifications,
                {
                    requestId: req.headers['x-request-id'] || this.generateRequestId(),
                    userAgent: req.headers['user-agent'],
                    clientIp: req.ip
                }
            );

            this.logger.info(`✅ Bulk notifications queued: ${result.totalQueued} notifications`);

            res.status(202).json({
                success: true,
                message: 'Bulk notifications queued for processing',
                data: {
                    totalQueued: result.totalQueued,
                    requestId: result.requestId,
                    notificationIds: result.notificationIds,
                    estimatedProcessingTime: result.estimatedProcessingTime,
                    invalidCount: invalidNotifications.length
                },
                invalidNotifications: invalidNotifications.length > 0 ? invalidNotifications : undefined,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Bulk notification failed:', error);
            next(error);
        }
    }

    /**
     * Get notification status endpoint
     * GET /api/notifications/:id
     */
    async getNotificationStatus(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in getNotificationStatus');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { id } = req.params;
            
            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'Notification ID is required'
                });
            }

            const notification = await this.notificationService.getNotificationStatus(id);
            
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found'
                });
            }

            res.json({
                success: true,
                data: notification,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Get notification status failed:', error);
            next(error);
        }
    }

    /**
     * Get notification details with responses
     * GET /api/notifications/:id/details
     */
    async getNotificationDetails(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in getNotificationDetails');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { id } = req.params;
            
            this.logger.info(`📋 Get notification details: ${id}`);
            
            const details = await this.notificationService.getNotificationDetails(id);
            
            if (!details) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found'
                });
            }

            res.json({
                success: true,
                data: details,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Get notification details failed:', error);
            next(error);
        }
    }

    /**
     * List notifications endpoint - FIXED METHOD
     * GET /api/notifications
     */
    async listNotifications(req, res, next) {
        try {
            if (!this) {
                console.error('❌ Context error: this is undefined in listNotifications');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - controller context undefined'
                });
            }

            if (!this.logger) {
                console.error('❌ Context error: this.logger is undefined in listNotifications');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - logger undefined'
                });
            }

            this.logger.info('📋 List notifications request...');

            // Check if notification service is available
            this.checkService();

            // Validate pagination and filters
            const { error, value } = validatePagination(req.query);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: error.details.map(d => ({
                        field: d.path.join('.'),
                        message: d.message
                    }))
                });
            }

            // Call the service method
            const result = await this.notificationService.listNotifications(value);

            res.json({
                success: true,
                data: result.notifications,
                pagination: {
                    page: value.page,
                    limit: value.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / value.limit),
                    hasNext: result.hasNext,
                    hasPrev: result.hasPrev
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ List notifications failed:', error);
            next(error);
        }
    }

    /**
     * Cancel notification endpoint
     * POST /api/notifications/:id/cancel
     */
    async cancelNotification(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in cancelNotification');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { id } = req.params;
            const { reason } = req.body;

            const result = await this.notificationService.cancelNotification(id, reason);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error
                });
            }

            this.logger.info(`❌ Notification ${id} cancelled: ${reason || 'No reason provided'}`);

            res.json({
                success: true,
                message: 'Notification cancelled successfully',
                data: {
                    notificationId: id,
                    previousStatus: result.previousStatus,
                    cancelledAt: result.cancelledAt
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Cancel notification failed:', error);
            next(error);
        }
    }

    /**
     * Retry failed notification endpoint
     * POST /api/notifications/:id/retry
     */
    async retryNotification(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in retryNotification');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { id } = req.params;

            const result = await this.notificationService.retryNotification(id);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error
                });
            }

            this.logger.info(`🔄 Notification ${id} queued for retry`);

            res.json({
                success: true,
                message: 'Notification queued for retry',
                data: {
                    notificationId: id,
                    newNotificationId: result.newNotificationId,
                    estimatedProcessingTime: result.estimatedProcessingTime
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Retry notification failed:', error);
            next(error);
        }
    }

    /**
     * Get notification statistics endpoint
     * GET /api/notifications/stats
     */
    async getNotificationStats(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in getNotificationStats');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { 
                period = '24h',
                groupBy = 'hour',
                userId,
                type,
                status
            } = req.query;

            const stats = await this.notificationService.getStats({
                period,
                groupBy,
                userId,
                type,
                status
            });

            res.json({
                success: true,
                data: stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Get notification stats failed:', error);
            next(error);
        }
    }

    /**
     * Get queue status endpoint
     * GET /api/notifications/queue/status
     */
    async getQueueStatus(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in getQueueStatus');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const status = await this.notificationService.getQueueStatus();

            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Get queue status failed:', error);
            next(error);
        }
    }

    /**
     * Test notification endpoint
     * POST /api/notifications/test
     */
    async testNotification(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in testNotification');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { token, title = 'Test Notification', message = 'This is a test notification' } = req.body;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: 'FCM token is required for test notification'
                });
            }

            const result = await this.notificationService.sendTestNotification({
                token,
                title,
                message,
                type: 'test'
            });

            res.json({
                success: true,
                message: 'Test notification sent',
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Test notification failed:', error);
            next(error);
        }
    }

    /**
     * Validate tokens endpoint
     * POST /api/notifications/validate-tokens
     */
    async validateTokens(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in validateTokens');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { tokens } = req.body;

            if (!Array.isArray(tokens) || tokens.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Tokens array is required'
                });
            }

            const result = await this.notificationService.validateTokens(tokens);

            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Token validation failed:', error);
            next(error);
        }
    }

    /**
     * Get delivery report endpoint
     * GET /api/notifications/:id/delivery-report
     */
    async getDeliveryReport(req, res, next) {
        try {
            if (!this || !this.logger) {
                console.error('❌ Context error in getDeliveryReport');
                return res.status(500).json({
                    success: false,
                    error: 'Internal server error - context error'
                });
            }

            this.checkService();
            const { id } = req.params;
            const { format = 'json' } = req.query;

            const report = await this.notificationService.getDeliveryReport(id);

            if (!report) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found'
                });
            }

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="delivery-report-${id}.csv"`);
                res.send(report.csv);
            } else {
                res.json({
                    success: true,
                    data: report,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            const logger = this?.logger || console;
            logger.error('❌ Get delivery report failed:', error);
            next(error);
        }
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// ==========================================
// FACTORY FUNCTION WITH DEPENDENCY INJECTION
// ==========================================

let controllerInstance = null;

function getNotificationController(models = null, queueService = null, websocketService = null) {
    if (!controllerInstance) {
        controllerInstance = new NotificationController(models, queueService, websocketService);
    }
    return controllerInstance;
}

// Function to reinitialize controller with new dependencies
function reinitializeNotificationController(models, queueService = null, websocketService = null) {
    controllerInstance = new NotificationController(models, queueService, websocketService);
    return controllerInstance;
}

// Exportar tanto la clase como las funciones factory
module.exports = {
    NotificationController,
    getNotificationController,
    reinitializeNotificationController
};