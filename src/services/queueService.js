// ==========================================
// QUEUE SERVICE - Robust Queue Management
// Handles notification queuing and processing
// ==========================================

const Bull = require('bull');
const Redis = require('ioredis');
const AppLogger = require('../utils/logger');
const { Notification, Response } = require('../models');
const FirebaseService = require('./firebaseService');
const { 
    QUEUE_PRIORITIES, 
    NOTIFICATION_STATUS, 
    QUEUE_EVENTS,
    MAX_RETRIES,
    RETRY_DELAYS
} = require('../utils/constants');

class QueueService {
    constructor(websocketService = null) {
        this.logger = new AppLogger('QueueService');
        this.websocketService = websocketService;
        
        // Queue instances
        this.notificationQueue = null;
        this.bulkQueue = null;
        this.retryQueue = null;
        
        // Services
        this.firebaseService = new FirebaseService();
        
        // Redis connection
        this.redis = null;
        
        // Workers
        this.workers = new Map();
        this.workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY) || 5;
        
        // Stats
        this.stats = {
            totalProcessed: 0,
            totalFailed: 0,
            totalRetries: 0,
            avgProcessingTime: 0,
            lastProcessedAt: null
        };
        
        this.initialized = false;
    }

    /**
     * Initialize queue service
     */
    async initialize() {
        try {
            this.logger.info('📦 Initializing Queue service...');
            
            await this.setupRedis();
            await this.setupQueues();
            await this.firebaseService.initialize();
            
            this.initialized = true;
            this.logger.info('✅ Queue service initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Queue service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Setup Redis connection
     */
    async setupRedis() {
        const redisConfig = {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            db: parseInt(process.env.REDIS_DB) || 0,
            retryDelayOnFailover: 100,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 3,
            lazyConnect: true
        };

        this.redis = new Redis(redisConfig);
        
        this.redis.on('connect', () => {
            this.logger.info('🔗 Redis connected');
        });
        
        this.redis.on('error', (error) => {
            this.logger.error('❌ Redis connection error:', error);
        });
        
        this.redis.on('close', () => {
            this.logger.warn('⚠️ Redis connection closed');
        });

        await this.redis.connect();
    }

    /**
     * Setup Bull queues
     */
    async setupQueues() {
        const redisConfig = {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            db: parseInt(process.env.REDIS_DB) || 0
        };

        // Main notification queue
        this.notificationQueue = new Bull('notifications', {
            redis: redisConfig,
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 50,
                attempts: MAX_RETRIES,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                }
            }
        });

        // Bulk notifications queue
        this.bulkQueue = new Bull('bulk-notifications', {
            redis: redisConfig,
            defaultJobOptions: {
                removeOnComplete: 50,
                removeOnFail: 25,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                }
            }
        });

        // Retry queue for failed notifications
        this.retryQueue = new Bull('retry-notifications', {
            redis: redisConfig,
            defaultJobOptions: {
                removeOnComplete: 25,
                removeOnFail: 25,
                attempts: 2,
                delay: 60000 // 1 minute delay
            }
        });

        this.logger.info('📊 Queues created successfully');
        
        // Setup queue event listeners
        this.setupQueueEventListeners();
    }

    /**
     * Setup queue event listeners
     */
    setupQueueEventListeners() {
        // Notification queue events
        this.notificationQueue.on('completed', (job, result) => {
            this.handleJobCompleted('notification', job, result);
        });

        this.notificationQueue.on('failed', (job, error) => {
            this.handleJobFailed('notification', job, error);
        });

        this.notificationQueue.on('progress', (job, progress) => {
            this.handleJobProgress('notification', job, progress);
        });

        // Bulk queue events
        this.bulkQueue.on('completed', (job, result) => {
            this.handleJobCompleted('bulk', job, result);
        });

        this.bulkQueue.on('failed', (job, error) => {
            this.handleJobFailed('bulk', job, error);
        });

        this.bulkQueue.on('progress', (job, progress) => {
            this.handleJobProgress('bulk', job, progress);
        });

        // Retry queue events
        this.retryQueue.on('completed', (job, result) => {
            this.handleJobCompleted('retry', job, result);
        });

        this.retryQueue.on('failed', (job, error) => {
            this.handleJobFailed('retry', job, error);
        });
    }

    /**
     * Start queue workers
     */
    startWorkers() {
        try {
            this.logger.info('🔄 Starting queue workers...');

            // Notification worker
            const notificationWorker = this.notificationQueue.process(
                this.workerConcurrency,
                this.processNotificationJob.bind(this)
            );
            this.workers.set('notification', notificationWorker);

            // Bulk worker
            const bulkWorker = this.bulkQueue.process(
                Math.max(1, Math.floor(this.workerConcurrency / 2)),
                this.processBulkJob.bind(this)
            );
            this.workers.set('bulk', bulkWorker);

            // Retry worker
            const retryWorker = this.retryQueue.process(
                1, // Single worker for retries
                this.processRetryJob.bind(this)
            );
            this.workers.set('retry', retryWorker);

            this.logger.info(`✅ Started ${this.workers.size} workers`);

        } catch (error) {
            this.logger.error('❌ Failed to start workers:', error);
            throw error;
        }
    }

    /**
     * Queue single notification
     */
    async queueNotification(notificationData, options = {}) {
        try {
            const {
                priority = QUEUE_PRIORITIES.NORMAL,
                delay = 0,
                requestId = null
            } = options;

            // Create notification record
            const notification = await Notification.create({
                ...notificationData,
                status: NOTIFICATION_STATUS.QUEUED,
                request_id: requestId
            });

            // Add to queue
            const job = await this.notificationQueue.add(
                'process-notification',
                {
                    notificationId: notification.id,
                    data: notificationData,
                    requestId
                },
                {
                    priority: priority,
                    delay: delay,
                    jobId: `notification-${notification.id}`
                }
            );

            this.logger.info(`📋 Notification queued: ${notification.id} (Job: ${job.id})`);

            // Broadcast to websocket
            if (this.websocketService) {
                this.websocketService.broadcastNotificationUpdate(notification.id, {
                    status: NOTIFICATION_STATUS.QUEUED,
                    queuePosition: await this.getQueuePosition(job)
                });
            }

            return {
                notificationId: notification.id,
                jobId: job.id,
                queuePosition: await this.getQueuePosition(job),
                estimatedProcessingTime: this.calculateEstimatedProcessingTime()
            };

        } catch (error) {
            this.logger.error('❌ Failed to queue notification:', error);
            throw error;
        }
    }

    /**
     * Queue bulk notifications
     */
    async queueBulkNotifications(notifications, options = {}) {
        try {
            const {
                batchSize = 100,
                priority = QUEUE_PRIORITIES.NORMAL,
                requestId = null
            } = options;

            this.logger.info(`📬 Queuing ${notifications.length} bulk notifications...`);

            const results = [];
            
            // Split into batches
            for (let i = 0; i < notifications.length; i += batchSize) {
                const batch = notifications.slice(i, i + batchSize);
                
                // Create notification records
                const notificationRecords = await Promise.all(
                    batch.map(notifData => 
                        Notification.create({
                            ...notifData,
                            status: NOTIFICATION_STATUS.QUEUED,
                            request_id: requestId
                        })
                    )
                );

                // Add batch to queue
                const job = await this.bulkQueue.add(
                    'process-bulk-notifications',
                    {
                        notificationIds: notificationRecords.map(n => n.id),
                        batch: batch,
                        requestId
                    },
                    {
                        priority: priority,
                        jobId: `bulk-${requestId}-${Math.floor(i / batchSize)}`
                    }
                );

                results.push({
                    batchIndex: Math.floor(i / batchSize),
                    jobId: job.id,
                    notificationIds: notificationRecords.map(n => n.id)
                });

                this.logger.debug(`📦 Batch ${Math.floor(i / batchSize)} queued: ${batch.length} notifications`);
            }

            return {
                totalQueued: notifications.length,
                batches: results.length,
                jobIds: results.map(r => r.jobId),
                estimatedProcessingTime: this.calculateEstimatedProcessingTime(notifications.length)
            };

        } catch (error) {
            this.logger.error('❌ Failed to queue bulk notifications:', error);
            throw error;
        }
    }

    /**
     * Process single notification job
     */
    async processNotificationJob(job) {
        const startTime = Date.now();
        const { notificationId, data } = job.data;

        try {
            this.logger.debug(`🔄 Processing notification ${notificationId}...`);

            // Update status to processing
            await Notification.updateStatus(notificationId, NOTIFICATION_STATUS.PROCESSING);
            
            // Broadcast status update
            if (this.websocketService) {
                this.websocketService.broadcastNotificationUpdate(notificationId, {
                    status: NOTIFICATION_STATUS.PROCESSING,
                    startedAt: new Date().toISOString()
                });
            }

            // Determine notification method
            let result;
            if (data.topic) {
                result = await this.processSingleNotification(data, 'topic');
            } else if (data.tokens && Array.isArray(data.tokens)) {
                result = await this.processMulticastNotification(data, notificationId);
            } else if (data.token) {
                result = await this.processSingleNotification(data, 'token');
            } else {
                throw new Error('Invalid notification target');
            }

            // Update notification record
            await Notification.updateWithResult(notificationId, {
                status: NOTIFICATION_STATUS.COMPLETED,
                total_sent: result.totalSent,
                successful: result.successful,
                failed: result.failed,
                success_rate: result.successRate,
                processing_time: (Date.now() - startTime) / 1000,
                firebase_response: JSON.stringify(result.responses?.slice(0, 10))
            });

            // Update stats
            this.updateStats(true, Date.now() - startTime);

            // Broadcast completion
            if (this.websocketService) {
                this.websocketService.broadcastNotificationUpdate(notificationId, {
                    status: NOTIFICATION_STATUS.COMPLETED,
                    result: result,
                    completedAt: new Date().toISOString()
                });
            }

            this.logger.info(`✅ Notification ${notificationId} completed: ${result.successful}/${result.totalSent} successful`);

            return result;

        } catch (error) {
            this.logger.error(`❌ Notification ${notificationId} failed:`, error);

            // Update notification with error
            await Notification.updateWithResult(notificationId, {
                status: NOTIFICATION_STATUS.FAILED,
                error_message: error.message,
                processing_time: (Date.now() - startTime) / 1000
            });

            // Update stats
            this.updateStats(false, Date.now() - startTime);

            // Broadcast failure
            if (this.websocketService) {
                this.websocketService.broadcastNotificationUpdate(notificationId, {
                    status: NOTIFICATION_STATUS.FAILED,
                    error: error.message,
                    failedAt: new Date().toISOString()
                });
            }

            throw error;
        }
    }

    /**
     * Process bulk notification job
     */
    async processBulkJob(job) {
        const startTime = Date.now();
        const { notificationIds, batch } = job.data;

        try {
            this.logger.debug(`🔄 Processing bulk job with ${batch.length} notifications...`);

            // Update all notifications to processing
            await Promise.all(
                notificationIds.map(id => 
                    Notification.updateStatus(id, NOTIFICATION_STATUS.PROCESSING)
                )
            );

            const results = [];
            let totalProcessed = 0;

            // Process each notification in the batch
            for (let i = 0; i < batch.length; i++) {
                const notificationData = batch[i];
                const notificationId = notificationIds[i];

                try {
                    let result;
                    if (notificationData.topic) {
                        result = await this.processSingleNotification(notificationData, 'topic');
                    } else if (notificationData.tokens) {
                        result = await this.processMulticastNotification(notificationData, notificationId);
                    } else if (notificationData.token) {
                        result = await this.processSingleNotification(notificationData, 'token');
                    }

                    // Update individual notification
                    await Notification.updateWithResult(notificationId, {
                        status: NOTIFICATION_STATUS.COMPLETED,
                        total_sent: result.totalSent,
                        successful: result.successful,
                        failed: result.failed,
                        success_rate: result.successRate,
                        processing_time: (Date.now() - startTime) / 1000
                    });

                    results.push({ notificationId, success: true, result });
                    totalProcessed++;

                    // Update job progress
                    const progress = Math.round(((i + 1) / batch.length) * 100);
                    job.progress(progress);

                } catch (error) {
                    this.logger.error(`❌ Bulk notification ${notificationId} failed:`, error);

                    await Notification.updateWithResult(notificationId, {
                        status: NOTIFICATION_STATUS.FAILED,
                        error_message: error.message,
                        processing_time: (Date.now() - startTime) / 1000
                    });

                    results.push({ notificationId, success: false, error: error.message });
                }
            }

            const successCount = results.filter(r => r.success).length;
            
            this.logger.info(`✅ Bulk job completed: ${successCount}/${batch.length} notifications successful`);

            return {
                totalProcessed: batch.length,
                successful: successCount,
                failed: batch.length - successCount,
                results: results
            };

        } catch (error) {
            this.logger.error('❌ Bulk job failed:', error);
            throw error;
        }
    }

    /**
     * Process retry job
     */
    async processRetryJob(job) {
        const { originalJobData, retryCount = 1 } = job.data;
        
        this.logger.info(`🔄 Retry attempt ${retryCount} for notification...`);

        try {
            // Add delay based on retry count
            const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            await new Promise(resolve => setTimeout(resolve, delay));

            // Process the original job
            const result = await this.processNotificationJob({ data: originalJobData });
            
            this.stats.totalRetries++;
            
            return result;

        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                // Queue for another retry
                await this.retryQueue.add(
                    'retry-notification',
                    {
                        originalJobData,
                        retryCount: retryCount + 1
                    },
                    {
                        delay: RETRY_DELAYS[retryCount + 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
                    }
                );
                
                this.logger.info(`⏳ Notification queued for retry ${retryCount + 1}/${MAX_RETRIES}`);
            } else {
                this.logger.error(`💀 Notification exhausted all retry attempts (${MAX_RETRIES})`);
            }
            
            throw error;
        }
    }

    /**
     * Process single notification (token or topic)
     */
    async processSingleNotification(data, type) {
        const message = this.firebaseService.createMessage({
            token: type === 'token' ? data.token : null,
            topic: type === 'topic' ? data.topic : null,
            title: data.title,
            body: data.message,
            type: data.type,
            data: data.extra_data,
            priority: data.priority,
            sound: data.sound,
            icon: data.icon,
            image: data.image
        });

        const result = await this.firebaseService.sendNotification(message);

        return {
            totalSent: 1,
            successful: result.success ? 1 : 0,
            failed: result.success ? 0 : 1,
            successRate: result.success ? 100 : 0,
            responses: [result]
        };
    }

    /**
     * Process multicast notification
     */
    async processMulticastNotification(data, notificationId) {
        const messages = data.tokens.map(token =>
            this.firebaseService.createMessage({
                token,
                title: data.title,
                body: data.message,
                type: data.type,
                data: data.extra_data,
                priority: data.priority,
                sound: data.sound,
                icon: data.icon,
                image: data.image
            })
        );

        const batchResult = await this.firebaseService.sendBatchNotifications(messages);

        // Store individual responses
        await Promise.all(
            batchResult.results.map((result, index) =>
                Response.create({
                    notification_id: notificationId,
                    token: data.tokens[index],
                    success: result.success,
                    error_code: result.error?.code,
                    error_message: result.error?.message,
                    firebase_message_id: result.messageId
                })
            )
        );

        return {
            totalSent: batchResult.totalSent,
            successful: batchResult.successCount,
            failed: batchResult.failureCount,
            successRate: batchResult.successRate,
            responses: batchResult.results
        };
    }

    /**
     * Handle job completion
     */
    handleJobCompleted(queueType, job, result) {
        this.logger.debug(`✅ ${queueType} job ${job.id} completed`);
        
        // Emit event
        if (this.websocketService) {
            this.websocketService.io.emit(QUEUE_EVENTS.JOB_COMPLETED, {
                queueType,
                jobId: job.id,
                result,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Handle job failure
     */
    handleJobFailed(queueType, job, error) {
        this.logger.error(`❌ ${queueType} job ${job.id} failed:`, error);
        
        // Emit event
        if (this.websocketService) {
            this.websocketService.io.emit(QUEUE_EVENTS.JOB_FAILED, {
                queueType,
                jobId: job.id,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Handle job progress
     */
    handleJobProgress(queueType, job, progress) {
        this.logger.debug(`📊 ${queueType} job ${job.id} progress: ${progress}%`);
        
        // Emit progress update
        if (this.websocketService) {
            this.websocketService.broadcastNotificationProgress(
                job.data.notificationId,
                { percent: progress, status: 'processing' }
            );
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        try {
            const [notifCounts, bulkCounts, retryCounts] = await Promise.all([
                this.notificationQueue.getJobCounts(),
                this.bulkQueue.getJobCounts(),
                this.retryQueue.getJobCounts()
            ]);

            return {
                notification: notifCounts,
                bulk: bulkCounts,
                retry: retryCounts,
                workers: {
                    notification: this.workerConcurrency,
                    bulk: Math.max(1, Math.floor(this.workerConcurrency / 2)),
                    retry: 1
                },
                stats: this.stats
            };

        } catch (error) {
            this.logger.error('❌ Failed to get queue stats:', error);
            return null;
        }
    }

    /**
     * Get queue position for a job
     */
    async getQueuePosition(job) {
        try {
            const waiting = await this.notificationQueue.getWaiting();
            return waiting.findIndex(j => j.id === job.id) + 1;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate estimated processing time
     */
    calculateEstimatedProcessingTime(count = 1) {
        const avgTime = this.stats.avgProcessingTime || 2; // 2 seconds default
        const queueLength = 0; // Would need to get actual queue length
        
        return Math.round((avgTime * count) + (queueLength * avgTime / this.workerConcurrency));
    }

    /**
     * Update internal stats
     */
    updateStats(success, processingTime) {
        this.stats.totalProcessed++;
        this.stats.lastProcessedAt = new Date();
        
        if (success) {
            // Update average processing time
            const totalTime = this.stats.avgProcessingTime * (this.stats.totalProcessed - 1);
            this.stats.avgProcessingTime = (totalTime + processingTime) / this.stats.totalProcessed;
        } else {
            this.stats.totalFailed++;
        }
    }

    /**
     * Get service health status
     */
    async getHealthStatus() {
        try {
            const stats = await this.getQueueStats();
            
            return {
                service: 'QueueService',
                status: 'healthy',
                initialized: this.initialized,
                redis: {
                    status: this.redis.status,
                    connected: this.redis.status === 'ready'
                },
                queues: stats,
                workers: this.workers.size,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                service: 'QueueService',
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Stop all workers and cleanup
     */
    async stop() {
        this.logger.info('🛑 Stopping Queue service...');
        
        try {
            // Close all queues
            if (this.notificationQueue) await this.notificationQueue.close();
            if (this.bulkQueue) await this.bulkQueue.close();
            if (this.retryQueue) await this.retryQueue.close();
            
            // Disconnect Redis
            if (this.redis) await this.redis.disconnect();
            
            // Clear workers
            this.workers.clear();
            
            this.initialized = false;
            this.logger.info('✅ Queue service stopped');
            
        } catch (error) {
            this.logger.error('❌ Error stopping Queue service:', error);
            throw error;
        }
    }
}

module.exports = QueueService;