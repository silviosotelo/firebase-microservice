// ==========================================
// NOTIFICATION CONTROLLER - VERSIÓN CORREGIDA
// Controlador simplificado y robusto sin problemas de contexto
// ==========================================

const AppLogger = require('../utils/logger');
const { NOTIFICATION_STATUS } = require('../utils/constants');

class NotificationController {
    constructor(models = null, queueService = null, websocketService = null) {
        this.logger = new AppLogger('NotificationController');
        this.models = models;
        this.queueService = queueService;
        this.websocketService = websocketService;
        this.notificationService = null;
        
        this.logger.info('✅ NotificationController initialized');
        this.initializeService();
    }

    /**
     * Initialize notification service
     */
    async initializeService() {
        try {
            if (!this.models) {
                this.logger.warn('⚠️ No models provided, using fallback mode');
                return;
            }

            const NotificationService = require('../services/notificationService');
            this.notificationService = new NotificationService(
                this.websocketService,
                this.models,
                this.queueService
            );
            
            await this.notificationService.initialize();
            this.logger.info('✅ NotificationService initialized in controller');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize NotificationService:', error.message);
            this.notificationService = null;
        }
    }

    /**
     * Send notification endpoint
     */
    async sendNotification(req, res) {
        try {
            this.logger.info(`📤 Send notification request from ${req.ip}`);
            
            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available',
                    code: 'SERVICE_UNAVAILABLE'
                });
            }

            // Validación básica
            const { title, message, tokens, topic, user_id } = req.body;
            
            if (!title || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Title and message are required',
                    code: 'VALIDATION_ERROR'
                });
            }

            if (!tokens && !topic && !user_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Either tokens, topic, or user_id must be provided',
                    code: 'VALIDATION_ERROR'
                });
            }

            // Process notification
            const result = await this.notificationService.queueNotification(req.body, {
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
            this.logger.error('❌ Send notification failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Send bulk notifications endpoint
     */
    async sendBulkNotifications(req, res) {
        try {
            this.logger.info(`📬 Bulk notification request from ${req.ip}`);
            
            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available',
                    code: 'SERVICE_UNAVAILABLE'
                });
            }

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

            // Process bulk notifications
            const result = await this.notificationService.queueBulkNotifications(
                notifications,
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
                    estimatedProcessingTime: result.estimatedProcessingTime
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Bulk notification failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get notification status endpoint
     */
    async getNotificationStatus(req, res) {
        try {
            const { id } = req.params;
            
            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'Notification ID is required'
                });
            }

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
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
            this.logger.error('❌ Get notification status failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get notification details with responses
     */
    async getNotificationDetails(req, res) {
        try {
            const { id } = req.params;
            
            this.logger.info(`📋 Get notification details: ${id}`);

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
                });
            }
            
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
            this.logger.error('❌ Get notification details failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * List notifications with pagination
     */
    async listNotifications(req, res) {
        try {
            this.logger.info('📋 List notifications request...');

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
                });
            }

            // Prepare query options
            const options = {
                page: parseInt(req.query.page) || 1,
                limit: Math.min(parseInt(req.query.limit) || 50, 1000),
                status: req.query.status,
                type: req.query.type,
                userId: req.query.userId,
                dateFrom: req.query.dateFrom,
                dateTo: req.query.dateTo,
                sortBy: req.query.sortBy || 'created_at',
                sortOrder: req.query.sortOrder || 'DESC'
            };

            // Call the service method
            const result = await this.notificationService.listNotifications(options);

            res.json({
                success: true,
                data: result.notifications,
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / options.limit),
                    hasNext: result.hasNext,
                    hasPrev: result.hasPrev
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ List notifications failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Cancel notification endpoint
     */
    async cancelNotification(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
                });
            }

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
            this.logger.error('❌ Cancel notification failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Retry failed notification endpoint
     */
    async retryNotification(req, res) {
        try {
            const { id } = req.params;

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
                });
            }

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
            this.logger.error('❌ Retry notification failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get notification statistics endpoint
     */
    async getNotificationStats(req, res) {
        try {
            if (!this.notificationService) {
                // Fallback stats if service not available
                return res.json({
                    success: true,
                    data: {
                        message: 'Notification service not available, returning basic stats',
                        basic: {
                            uptime: process.uptime(),
                            memory: process.memoryUsage(),
                            timestamp: new Date().toISOString()
                        }
                    },
                    timestamp: new Date().toISOString()
                });
            }

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
            this.logger.error('❌ Get notification stats failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get queue status endpoint
     */
    async getQueueStatus(req, res) {
        try {
            if (!this.notificationService) {
                return res.json({
                    success: true,
                    data: {
                        available: false,
                        message: 'Queue service not available'
                    },
                    timestamp: new Date().toISOString()
                });
            }

            const status = await this.notificationService.getQueueStatus();

            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Get queue status failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Test notification endpoint
     */
    async testNotification(req, res) {
        try {
            if (!this.notificationService) {
                // Fallback test response
                return res.json({
                    success: true,
                    message: 'Test endpoint working (service not available)',
                    data: {
                        mock: true,
                        messageId: `test_${Date.now()}`,
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }

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
            this.logger.error('❌ Test notification failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Validate tokens endpoint
     */
    async validateTokens(req, res) {
        try {
            const { tokens } = req.body;

            if (!Array.isArray(tokens) || tokens.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Tokens array is required'
                });
            }

            if (!this.notificationService) {
                // Basic token validation fallback
                const validTokens = tokens.filter(token => 
                    token && typeof token === 'string' && token.length > 50
                );

                return res.json({
                    success: true,
                    data: {
                        valid: validTokens,
                        invalid: tokens.filter(token => !validTokens.includes(token)),
                        total: tokens.length,
                        validCount: validTokens.length,
                        mock: true
                    },
                    timestamp: new Date().toISOString()
                });
            }

            const result = await this.notificationService.validateTokens(tokens);

            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Token validation failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get delivery report endpoint
     */
    async getDeliveryReport(req, res) {
        try {
            const { id } = req.params;
            const { format = 'json' } = req.query;

            if (!this.notificationService) {
                return res.status(503).json({
                    success: false,
                    error: 'Notification service not available'
                });
            }

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
            this.logger.error('❌ Get delivery report failed:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = {
    NotificationController
};