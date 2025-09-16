// ==========================================
// NOTIFICATION SERVICE - FIXED VERSION
// Core Business Logic with proper model access
// ==========================================

const AppLogger = require('../utils/logger');
const { 
    NOTIFICATION_STATUS, 
    NOTIFICATION_TYPES,
    PRIORITY_LEVELS,
    VALIDATION_RULES 
} = require('../utils/constants');
const { validateToken, validateTopic } = require('../utils/validators');

class NotificationService {
    constructor(dependencies = {}, options = {}) {
        this.logger = new AppLogger('NotificationService');
        
        // Dependencies
        this.websocketService = dependencies.websocketService;
        this.database = dependencies.database;
        this.queueService = dependencies.queueService;
        
        // Services that will be initialized
        this.firebaseService = null;
        
        // Cache
        this.tokenCache = new Map();
        this.configCache = new Map();
        
        // Stats
        this.dailyStats = {
            sent: 0,
            successful: 0,
            failed: 0,
            lastReset: new Date().toDateString()
        };
        
        this.initialized = false;
    }

    /**
     * Initialize notification service
     */
    async initialize() {
        try {
            this.logger.info('🔔 Initializing Notification service...');
            
            // Validate dependencies
            if (!this.database) {
                throw new Error('Database is required for NotificationService');
            }
            
            this.models = this.database.getModels();
            this.logger.info('✅ Database models available');
            
            // Initialize Firebase service if available
            try {
                const FirebaseService = require('./firebaseService');
                this.firebaseService = new FirebaseService();
                await this.firebaseService.initialize();
                this.logger.info('✅ Firebase service initialized');
            } catch (firebaseError) {
                this.logger.warn('⚠️ Firebase service not available:', firebaseError.message);
                this.firebaseService = null;
            }
            
            // Setup periodic tasks
            this.setupPeriodicTasks();
            
            this.initialized = true;
            this.logger.info('✅ Notification service initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Notification service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Queue single notification for processing
     */
    async queueNotification(notificationData, metadata = {}) {
        try {
            this.logger.info('📤 Queuing notification...');
            
            if (!this.database || !this.models) {
                throw new Error('Database not available');
            }
            
            // Validate notification data
            const validatedData = await this.validateNotificationData(notificationData);
            
            // Determine priority
            const priority = this.determinePriority(validatedData);
            
            // Resolve tokens if user_id provided
            if (validatedData.user_id && !validatedData.tokens && !validatedData.topic) {
                validatedData.tokens = await this.resolveUserTokens(validatedData.user_id);
                
                if (!validatedData.tokens || validatedData.tokens.length === 0) {
                    throw new Error(`No active tokens found for user: ${validatedData.user_id}`);
                }
            }

            // Create notification record first
            const notification = await this.models.Notification.create({
                ...validatedData,
                status: NOTIFICATION_STATUS.QUEUED,
                request_id: metadata.requestId || this.generateRequestId(),
                priority: priority
            });

            // Queue the notification if queue service is available
            let queueResult = null;
            if (this.queueService) {
                try {
                    queueResult = await this.queueService.queueNotification(validatedData, {
                        priority,
                        requestId: metadata.requestId,
                        delay: validatedData.scheduleAt ? 
                            new Date(validatedData.scheduleAt).getTime() - Date.now() : 0
                    });
                } catch (queueError) {
                    this.logger.warn('⚠️ Failed to queue in background service:', queueError.message);
                }
            }

            // Update daily stats
            this.updateDailyStats('queued');

            this.logger.info(`✅ Notification queued successfully: ${notification.id}`);
            
            return {
                success: true,
                notificationId: notification.id,
                requestId: metadata.requestId || notification.request_id,
                queuePosition: queueResult?.queuePosition || 0,
                estimatedProcessingTime: queueResult?.estimatedProcessingTime || 30,
                priority
            };

        } catch (error) {
            this.logger.error('❌ Failed to queue notification:', error);
            throw error;
        }
    }

    /**
     * Queue bulk notifications
     */
    async queueBulkNotifications(notifications, metadata = {}) {
        try {
            this.logger.info(`📬 Queuing ${notifications.length} bulk notifications...`);
            
            if (!this.models || !this.models.Notification) {
                throw new Error('Notification model not available');
            }
            
            // Validate all notifications
            const validatedNotifications = await Promise.all(
                notifications.map(notif => this.validateNotificationData(notif))
            );

            // Resolve user tokens for notifications that need it
            for (const notif of validatedNotifications) {
                if (notif.user_id && !notif.tokens && !notif.topic) {
                    notif.tokens = await this.resolveUserTokens(notif.user_id);
                    
                    if (!notif.tokens || notif.tokens.length === 0) {
                        this.logger.warn(`No tokens found for user: ${notif.user_id}, skipping...`);
                        notif._skip = true;
                    }
                }
            }

            // Filter out skipped notifications
            const validNotifications = validatedNotifications.filter(notif => !notif._skip);
            
            if (validNotifications.length === 0) {
                throw new Error('No valid notifications to process');
            }

            // Determine bulk priority (highest priority wins)
            const priority = validNotifications.reduce((maxPriority, notif) => {
                const notifPriority = this.determinePriority(notif);
                return Math.max(maxPriority, notifPriority);
            }, 0);

            // Create notification records
            const createdNotifications = [];
            for (const notif of validNotifications) {
                const notification = await this.models.Notification.create({
                    ...notif,
                    status: NOTIFICATION_STATUS.QUEUED,
                    request_id: metadata.requestId || this.generateRequestId(),
                    priority: priority
                });
                createdNotifications.push(notification);
            }

            // Queue bulk notifications if queue service is available
            let queueResult = null;
            if (this.queueService) {
                try {
                    queueResult = await this.queueService.queueBulkNotifications(validNotifications, {
                        priority,
                        requestId: metadata.requestId,
                        batchSize: metadata.batchSize || 100
                    });
                } catch (queueError) {
                    this.logger.warn('⚠️ Failed to queue bulk in background service:', queueError.message);
                }
            }

            // Update daily stats
            this.updateDailyStats('queued', validNotifications.length);

            this.logger.info(`✅ Bulk notifications queued: ${createdNotifications.length} notifications`);

            return {
                success: true,
                totalQueued: createdNotifications.length,
                totalSkipped: notifications.length - validNotifications.length,
                requestId: metadata.requestId,
                notificationIds: createdNotifications.map(n => n.id),
                jobIds: queueResult?.jobIds || [],
                estimatedProcessingTime: queueResult?.estimatedProcessingTime || 60,
                priority
            };

        } catch (error) {
            this.logger.error('❌ Failed to queue bulk notifications:', error);
            throw error;
        }
    }

    /**
     * Get notification status
     */
    async getNotificationStatus(notificationId) {
        try {
            if (!this.models || !this.models.Notification) {
                throw new Error('Notification model not available');
            }
            
            const notification = await this.models.Notification.findById(notificationId);
            
            if (!notification) {
                return null;
            }

            // Get additional details based on status
            let additionalData = {};
            
            if (notification.status === NOTIFICATION_STATUS.COMPLETED && this.models.Response) {
                // Get response summary
                const responses = await this.models.Response.getByNotificationId(notificationId);
                additionalData.responseSummary = this.summarizeResponses(responses);
            }

            return {
                ...notification,
                ...additionalData,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error(`❌ Failed to get notification status ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * Get detailed notification information
     */
    async getNotificationDetails(notificationId) {
        try {
            if (!this.models || !this.models.Notification) {
                throw new Error('Notification model not available');
            }
            
            const notification = await this.models.Notification.findById(notificationId);
            
            if (!notification) {
                return null;
            }

            // Get all responses if Response model is available
            let responses = [];
            if (this.models.Response) {
                try {
                    responses = await this.models.Response.getByNotificationId(notificationId);
                } catch (responseError) {
                    this.logger.warn('Failed to get responses:', responseError.message);
                }
            }
            
            // Get queue information if still queued/processing
            let queueInfo = null;
            if ([NOTIFICATION_STATUS.QUEUED, NOTIFICATION_STATUS.PROCESSING].includes(notification.status)) {
                queueInfo = await this.getQueueInformation(notificationId);
            }

            return {
                notification,
                responses: responses || [],
                responseSummary: this.summarizeResponses(responses),
                queueInfo,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error(`❌ Failed to get notification details ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * List notifications with pagination and filters - FIXED METHOD
     */
    async listNotifications(options = {}) {
        try {
            // Verify models are available
            if (!this.database || !this.models) {
                throw new Error('Database not available - service not properly initialized');
            }
            
            this.logger.debug('📋 Listing notifications with options:', options);

            const {
                page = 1,
                limit = 50,
                status,
                type,
                userId,
                dateFrom,
                dateTo,
                sortBy = 'created_at',
                sortOrder = 'DESC'
            } = options;

            const offset = (page - 1) * limit;
            
            const filters = {};
            if (status) filters.status = status;
            if (type) filters.type = type;
            if (userId) filters.user_id = userId;
            if (dateFrom) filters.created_at_from = dateFrom;
            if (dateTo) filters.created_at_to = dateTo;

            // Use the model's findMany method
            const result = await this.models.Notification.findMany({
                filters,
                limit,
                offset,
                sortBy,
                sortOrder
            });

            this.logger.debug(`📋 Found ${result.data?.length || 0} notifications`);

            return {
                notifications: result.data || [],
                total: result.total || 0,
                hasNext: offset + limit < (result.total || 0),
                hasPrev: page > 1
            };

        } catch (error) {
            this.logger.error('❌ Failed to list notifications:', error);
            throw error;
        }
    }

    /**
     * Cancel notification
     */
    async cancelNotification(notificationId, reason = null) {
        try {
            if (!this.models || !this.models.Notification) {
                throw new Error('Notification model not available');
            }
            
            const notification = await this.models.Notification.findById(notificationId);
            
            if (!notification) {
                return { success: false, error: 'Notification not found' };
            }

            if (![NOTIFICATION_STATUS.QUEUED, NOTIFICATION_STATUS.PROCESSING].includes(notification.status)) {
                return { 
                    success: false, 
                    error: `Cannot cancel notification with status: ${notification.status}` 
                };
            }

            // Try to remove from queue if queue service is available
            let cancelled = true;
            if (this.queueService) {
                try {
                    cancelled = await this.queueService.cancelJob(notificationId);
                } catch (queueError) {
                    this.logger.warn('Failed to cancel from queue:', queueError.message);
                }
            }
            
            if (cancelled) {
                // Update notification status
                await this.models.Notification.updateStatus(notificationId, NOTIFICATION_STATUS.CANCELLED, {
                    cancelled_reason: reason,
                    cancelled_at: new Date().toISOString()
                });

                // Broadcast cancellation if websocket service is available
                if (this.websocketService) {
                    this.websocketService.broadcastNotificationUpdate(notificationId, {
                        status: NOTIFICATION_STATUS.CANCELLED,
                        reason,
                        cancelledAt: new Date().toISOString()
                    });
                }

                this.logger.info(`❌ Notification ${notificationId} cancelled: ${reason || 'No reason'}`);
                
                return {
                    success: true,
                    previousStatus: notification.status,
                    cancelledAt: new Date().toISOString()
                };
            } else {
                return { 
                    success: false, 
                    error: 'Notification could not be cancelled (may be already processing)' 
                };
            }

        } catch (error) {
            this.logger.error(`❌ Failed to cancel notification ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * Send test notification
     */
    async sendTestNotification(testData) {
        try {
            this.logger.info('🧪 Sending test notification...');
            
            if (!this.firebaseService) {
                // Fallback to creating a mock test result
                this.logger.warn('⚠️ Firebase service not available, creating mock result');
                return {
                    success: true,
                    messageId: `mock_${Date.now()}`,
                    error: null,
                    mock: true,
                    timestamp: new Date().toISOString()
                };
            }
            
            const message = this.firebaseService.createMessage({
                token: testData.token,
                title: testData.title || 'Test Notification',
                body: testData.message || 'This is a test notification from Firebase Microservice',
                type: NOTIFICATION_TYPES.GENERAL,
                data: { test: true, timestamp: new Date().toISOString() }
            });

            const result = await this.firebaseService.sendNotification(message);

            this.logger.info(`🧪 Test notification result: ${result.success ? 'SUCCESS' : 'FAILED'}`);

            return {
                success: result.success,
                messageId: result.messageId,
                error: result.error,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('❌ Test notification failed:', error);
            throw error;
        }
    }

    /**
     * Get notification statistics
     */
    async getStats(options = {}) {
        try {
            if (!this.models || !this.models.Notification) {
                throw new Error('Notification model not available');
            }
            
            const {
                period = '24h',
                groupBy = 'hour',
                userId,
                type,
                status
            } = options;

            // Get date range based on period
            const dateRange = this.calculateDateRange(period);
            
            const stats = await this.models.Notification.getStats({
                dateFrom: dateRange.from,
                dateTo: dateRange.to,
                groupBy,
                userId,
                type,
                status
            });

            // Add real-time queue stats if available
            let queueStats = null;
            if (this.queueService) {
                try {
                    queueStats = await this.queueService.getQueueStats();
                } catch (queueError) {
                    this.logger.warn('Failed to get queue stats:', queueError.message);
                }
            }

            return {
                period,
                dateRange,
                daily: this.dailyStats,
                historical: stats,
                queue: queueStats,
                realTime: {
                    totalProcessed: this.queueService?.stats?.totalProcessed || 0,
                    totalFailed: this.queueService?.stats?.totalFailed || 0,
                    avgProcessingTime: this.queueService?.stats?.avgProcessingTime || 0,
                    lastProcessedAt: this.queueService?.stats?.lastProcessedAt || null
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('❌ Failed to get stats:', error);
            throw error;
        }
    }

    /**
     * Get queue status
     */
    async getQueueStatus() {
        try {
            if (!this.queueService) {
                return {
                    available: false,
                    message: 'Queue service not available'
                };
            }
            
            return await this.queueService.getQueueStats();
        } catch (error) {
            this.logger.error('❌ Failed to get queue status:', error);
            throw error;
        }
    }

    // ==========================================
    // PRIVATE HELPER METHODS (unchanged)
    // ==========================================

    async validateNotificationData(data) {
        const errors = [];

        if (!data.title) errors.push('Title is required');
        if (!data.message) errors.push('Message is required');
        
        const hasTarget = data.user_id || data.tokens || data.topic;
        if (!hasTarget) {
            errors.push('Must specify user_id, tokens, or topic');
        }

        if (data.tokens) {
            if (Array.isArray(data.tokens)) {
                const invalidTokens = data.tokens.filter(token => !validateToken(token));
                if (invalidTokens.length > 0) {
                    errors.push(`Invalid tokens: ${invalidTokens.length}`);
                }
            } else if (typeof data.tokens === 'string') {
                if (!validateToken(data.tokens)) {
                    errors.push('Invalid token format');
                }
            }
        }

        if (data.topic && !validateTopic(data.topic)) {
            errors.push('Invalid topic format');
        }

        if (data.type && !Object.values(NOTIFICATION_TYPES).includes(data.type)) {
            errors.push('Invalid notification type');
        }

        if (data.priority && !Object.values(PRIORITY_LEVELS).includes(data.priority)) {
            errors.push('Invalid priority level');
        }

        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }

        return {
            ...data,
            type: data.type || NOTIFICATION_TYPES.GENERAL,
            priority: data.priority || PRIORITY_LEVELS.NORMAL
        };
    }

    async resolveUserTokens(userId) {
        try {
            const cacheKey = `user_tokens_${userId}`;
            if (this.tokenCache.has(cacheKey)) {
                const cached = this.tokenCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 300000) {
                    return cached.tokens;
                }
            }

            const tokens = [];
            
            this.tokenCache.set(cacheKey, {
                tokens,
                timestamp: Date.now()
            });

            return tokens;

        } catch (error) {
            this.logger.error(`❌ Failed to resolve tokens for user ${userId}:`, error);
            return [];
        }
    }

    determinePriority(data) {
        if (data.type === NOTIFICATION_TYPES.EMERGENCY) return 10;
        if (data.priority === PRIORITY_LEVELS.HIGH) return 8;
        if (data.type === NOTIFICATION_TYPES.APPOINTMENT) return 6;
        if (data.type === NOTIFICATION_TYPES.RESULT) return 5;
        return 1;
    }

    summarizeResponses(responses) {
        if (!responses || responses.length === 0) {
            return { total: 0, successful: 0, failed: 0, successRate: 0 };
        }

        const successful = responses.filter(r => r.success).length;
        const failed = responses.length - successful;

        return {
            total: responses.length,
            successful,
            failed,
            successRate: Math.round((successful / responses.length) * 100),
            errorCodes: this.groupBy(responses.filter(r => !r.success), 'error_code')
        };
    }

    groupBy(array, property) {
        return array.reduce((groups, item) => {
            const key = item[property] || 'unknown';
            groups[key] = (groups[key] || 0) + 1;
            return groups;
        }, {});
    }

    calculateDateRange(period) {
        const now = new Date();
        const ranges = {
            '1h': { hours: 1 },
            '24h': { hours: 24 },
            '7d': { days: 7 },
            '30d': { days: 30 },
            '90d': { days: 90 }
        };

        const range = ranges[period] || ranges['24h'];
        const from = new Date(now);
        
        if (range.hours) from.setHours(from.getHours() - range.hours);
        if (range.days) from.setDate(from.getDate() - range.days);

        return {
            from: from.toISOString(),
            to: now.toISOString()
        };
    }

    updateDailyStats(type, count = 1) {
        const today = new Date().toDateString();
        
        if (this.dailyStats.lastReset !== today) {
            this.dailyStats = {
                sent: 0,
                successful: 0,
                failed: 0,
                lastReset: today
            };
        }

        switch (type) {
            case 'queued':
            case 'sent':
                this.dailyStats.sent += count;
                break;
            case 'successful':
                this.dailyStats.successful += count;
                break;
            case 'failed':
                this.dailyStats.failed += count;
                break;
        }
    }

    setupPeriodicTasks() {
        setInterval(() => {
            this.tokenCache.clear();
            this.logger.debug('🧹 Token cache cleared');
        }, 3600000);

        setInterval(() => {
            this.configCache.clear();
            this.logger.debug('🧹 Config cache cleared');
        }, 1800000);
    }

    async getQueueInformation(notificationId) {
        return {
            position: 0,
            estimatedProcessingTime: 0
        };
    }

    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async getHealthStatus() {
        try {
            const firebaseHealth = this.firebaseService ? 
                await this.firebaseService.getHealthStatus() : 
                { status: 'unavailable' };
                
            const queueHealth = this.queueService ? 
                await this.queueService.getHealthStatus() : 
                { status: 'unavailable' };

            return {
                service: 'NotificationService',
                status: 'healthy',
                initialized: this.initialized,
                dependencies: {
                    firebase: firebaseHealth,
                    queue: queueHealth,
                    models: {
                        available: !!this.models,
                        notification: !!this.models?.Notification,
                        response: !!this.models?.Response,
                        config: !!this.models?.Config
                    }
                },
                dailyStats: this.dailyStats,
                cacheStats: {
                    tokenCache: this.tokenCache.size,
                    configCache: this.configCache.size
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                service: 'NotificationService',
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async cleanup() {
        this.logger.info('🧹 Cleaning up Notification service...');
        
        if (this.queueService) {
            await this.queueService.stop();
        }
        
        if (this.firebaseService) {
            await this.firebaseService.cleanup();
        }
        
        this.tokenCache.clear();
        this.configCache.clear();
        
        this.initialized = false;
        this.logger.info('✅ Notification service cleaned up');
    }
}

module.exports = NotificationService;