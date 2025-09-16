// ==========================================
// QUEUE SERVICE - Optimized SQLite Queue
// High-performance queue with better error handling
// ==========================================

const AppLogger = require('../utils/logger');
const { NOTIFICATION_STATUS } = require('../utils/constants');
const cron = require('node-cron');

class QueueService {
    constructor(dependencies = {}, options = {}) {
        this.logger = new AppLogger('QueueService');
        
        // Dependencies
        this.database = dependencies.database;
        this.websocketService = dependencies.websocketService;
        this.notificationService = dependencies.notificationService;
        
        // Configuration
        this.workerConcurrency = options.workerConcurrency || 3;
        this.pollInterval = options.pollInterval || 1000;
        this.maxPollInterval = options.maxPollInterval || 10000;
        this.cleanupHours = options.cleanupHours || 24;
        this.maxAttempts = options.maxAttempts || 3;
        
        // State
        this.workers = [];
        this.isRunning = false;
        this.workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        this.currentPollInterval = this.pollInterval;
        
        // Stats
        this.stats = {
            totalProcessed: 0,
            totalFailed: 0,
            totalRetries: 0,
            avgProcessingTime: 0,
            lastProcessedAt: null,
            workerStartedAt: new Date()
        };
        
        this.initialized = false;
    }

    /**
     * Initialize queue service
     */
    async initialize() {
        try {
            this.logger.info('📦 Initializing Queue service...');
            
            if (!this.database) {
                throw new Error('Database dependency is required');
            }
            
            // Clean up orphaned jobs
            await this.cleanupOrphanedJobs();
            
            // Setup periodic cleanup
            this.setupPeriodicCleanup();
            
            this.initialized = true;
            this.logger.info('✅ Queue service initialized');
            
        } catch (error) {
            this.logger.error('❌ Queue initialization failed:', error);
            throw error;
        }
    }

    /**
     * Start queue workers
     */
    startWorkers() {
        if (this.isRunning) {
            this.logger.warn('⚠️ Workers already running');
            return;
        }

        this.isRunning = true;
        this.logger.info(`🔄 Starting ${this.workerConcurrency} workers...`);

        // Start worker processes
        for (let i = 0; i < this.workerConcurrency; i++) {
            const workerId = `${this.workerId}_${i}`;
            this.workers.push(this.startWorker(workerId));
        }

        this.logger.info(`✅ Started ${this.workers.length} workers`);
    }

    /**
     * Start individual worker
     */
    async startWorker(workerId) {
        this.logger.debug(`👷 Worker ${workerId} started`);

        while (this.isRunning) {
            try {
                const processed = await this.processNextJob(workerId);
                
                if (!processed) {
                    // No jobs found, increase poll interval
                    this.currentPollInterval = Math.min(
                        this.currentPollInterval * 1.2,
                        this.maxPollInterval
                    );
                    await this.sleep(this.currentPollInterval);
                } else {
                    // Job processed, reset poll interval
                    this.currentPollInterval = this.pollInterval;
                }

            } catch (error) {
                this.logger.error(`❌ Worker ${workerId} error:`, error);
                await this.sleep(5000); // Wait 5 seconds on error
            }
        }

        this.logger.debug(`👷 Worker ${workerId} stopped`);
    }

    /**
     * Process next job in queue
     */
    async processNextJob(workerId) {
        try {
            const db = this.database.getConnection();
            
            // Get next job to process
            const sql = `
                SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND scheduled_at <= CURRENT_TIMESTAMP
                ORDER BY priority DESC, scheduled_at ASC 
                LIMIT 1
            `;
            
            const job = await this.database.get(sql);
            
            if (!job) {
                return false; // No jobs available
            }

            // Try to claim the job (atomic operation)
            const updateSql = `
                UPDATE jobs 
                SET status = 'processing', worker_id = ?, started_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
            `;
            
            const updateResult = await this.database.run(updateSql, [workerId, job.id]);

            if (updateResult.changes === 0) {
                // Job was claimed by another worker
                return false;
            }

            // Process the job
            await this.processJob(job, workerId);
            
            return true;

        } catch (error) {
            this.logger.error(`❌ Error processing job:`, error);
            return false;
        }
    }

    /**
     * Process individual job
     */
    async processJob(job, workerId) {
        const startTime = Date.now();
        
        try {
            this.logger.debug(`🔄 Worker ${workerId} processing job ${job.job_id} (${job.type})`);

            const payload = JSON.parse(job.payload);
            let result;

            // Process based on job type
            switch (job.type) {
                case 'notification':
                    result = await this.processNotificationJob(payload);
                    break;
                    
                case 'bulk':
                    result = await this.processBulkJob(payload);
                    break;
                    
                case 'retry':
                    result = await this.processRetryJob(payload);
                    break;
                    
                default:
                    throw new Error(`Unknown job type: ${job.type}`);
            }

            // Mark job as completed
            const completeSql = 'UPDATE jobs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?';
            await this.database.run(completeSql, ['completed', job.id]);

            // Update stats
            this.updateStats(true, Date.now() - startTime);

            this.logger.debug(`✅ Job ${job.job_id} completed by worker ${workerId}`);

        } catch (error) {
            this.logger.error(`❌ Job ${job.job_id} failed:`, error);

            // Check if we should retry
            if (job.attempts < job.max_attempts - 1) {
                // Schedule retry with exponential backoff
                const retryDelay = Math.pow(2, job.attempts) * 30; // 30s, 60s, 120s...
                const retrySql = `
                    UPDATE jobs 
                    SET status = 'pending', worker_id = NULL, started_at = NULL, 
                        scheduled_at = datetime('now', '+' || ? || ' seconds'),
                        attempts = attempts + 1
                    WHERE id = ?
                `;
                await this.database.run(retrySql, [retryDelay, job.id]);
                
                this.stats.totalRetries++;
                this.logger.info(`🔄 Job ${job.job_id} scheduled for retry (attempt ${job.attempts + 2}/${job.max_attempts})`);
            } else {
                // Mark as permanently failed
                const failSql = `
                    UPDATE jobs 
                    SET status = 'failed', error_message = ?, attempts = attempts + 1
                    WHERE id = ?
                `;
                await this.database.run(failSql, [error.message, job.id]);
                this.updateStats(false, Date.now() - startTime);
                
                this.logger.error(`💀 Job ${job.job_id} failed permanently after ${job.max_attempts} attempts`);
            }
        }
    }

    /**
     * Queue single notification
     */
    async queueNotification(notificationData, options = {}) {
        try {
            const {
                priority = 5,
                delay = 0,
                requestId = null,
                maxAttempts = this.maxAttempts
            } = options;

            // Generate job ID
            const jobId = this.generateJobId('notification');
            
            // Calculate scheduled time
            const scheduledAt = new Date(Date.now() + delay).toISOString();

            // Create job payload
            const payload = {
                notificationData,
                requestId
            };

            // Insert job
            const sql = `
                INSERT INTO jobs (job_id, type, payload, priority, scheduled_at, max_attempts)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            
            await this.database.run(sql, [
                jobId,
                'notification',
                JSON.stringify(payload),
                priority,
                scheduledAt,
                maxAttempts
            ]);

            this.logger.info(`📋 Notification queued: ${jobId}`);

            // Wake up workers
            this.wakeUpWorkers();

            return {
                jobId: jobId,
                queuePosition: await this.getQueuePosition(),
                estimatedProcessingTime: this.calculateEstimatedProcessingTime()
            };

        } catch (error) {
            this.logger.error('❌ Failed to queue notification:', error);
            throw error;
        }
    }

    /**
     * Process notification job
     */
    async processNotificationJob(payload) {
        const { notificationData, requestId } = payload;

        // Simulate Firebase processing (replace with actual Firebase service)
        await this.sleep(100 + Math.random() * 300);
        
        // Simulate success/failure (90% success rate)
        const success = Math.random() > 0.1;
        
        return {
            totalSent: 1,
            successful: success ? 1 : 0,
            failed: success ? 0 : 1,
            successRate: success ? 100 : 0,
            responses: [{ 
                success, 
                messageId: success ? `msg_${Date.now()}` : null,
                error: success ? null : { code: 'MOCK_ERROR', message: 'Simulated failure' }
            }]
        };
    }

    /**
     * Process bulk job
     */
    async processBulkJob(payload) {
        const { notifications } = payload;
        
        const results = [];
        
        for (const notification of notifications) {
            try {
                const result = await this.processNotificationJob({ notificationData: notification });
                results.push({ success: true, result });
            } catch (error) {
                results.push({ success: false, error: error.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        
        return {
            totalProcessed: notifications.length,
            successful: successCount,
            failed: notifications.length - successCount,
            results: results
        };
    }

    /**
     * Process retry job
     */
    async processRetryJob(payload) {
        // For retry jobs, just process as normal notification
        return await this.processNotificationJob(payload);
    }

    /**
     * Clean up orphaned jobs
     */
    async cleanupOrphanedJobs() {
        try {
            const sql = `
                UPDATE jobs 
                SET status = 'pending', worker_id = NULL, started_at = NULL
                WHERE status = 'processing' 
                AND started_at < datetime('now', '-5 minutes')
            `;
            
            const result = await this.database.run(sql);
            
            if (result.changes > 0) {
                this.logger.info(`🧹 Cleaned up ${result.changes} orphaned jobs`);
            }
            
        } catch (error) {
            this.logger.error('❌ Failed to cleanup orphaned jobs:', error);
        }
    }

    /**
     * Setup periodic cleanup
     */
    setupPeriodicCleanup() {
        // Clean up old jobs every hour
        cron.schedule('0 * * * *', async () => {
            try {
                await this.cleanupOldJobs();
            } catch (error) {
                this.logger.error('❌ Periodic cleanup failed:', error);
            }
        });
    }

    /**
     * Clean up old jobs
     */
    async cleanupOldJobs() {
        try {
            const sql = `
                DELETE FROM jobs 
                WHERE status IN ('completed', 'failed') 
                AND created_at < datetime('now', '-' || ? || ' hours')
            `;
            
            const result = await this.database.run(sql, [this.cleanupHours]);
            
            if (result.changes > 0) {
                this.logger.info(`🧹 Cleaned up ${result.changes} old jobs`);
            }
            
            return result.changes;

        } catch (error) {
            this.logger.error('❌ Failed to cleanup old jobs:', error);
            return 0;
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        try {
            const sql = `
                SELECT 
                    status,
                    COUNT(*) as count
                FROM jobs 
                GROUP BY status
            `;
            
            const statusResults = await this.database.query(sql);
            const statusCounts = {};
            
            statusResults.forEach(row => {
                statusCounts[row.status] = row.count;
            });

            return {
                jobs: {
                    pending: statusCounts.pending || 0,
                    processing: statusCounts.processing || 0,
                    completed: statusCounts.completed || 0,
                    failed: statusCounts.failed || 0,
                    cancelled: statusCounts.cancelled || 0
                },
                workers: {
                    active: this.workers.length,
                    concurrency: this.workerConcurrency,
                    workerId: this.workerId
                },
                stats: this.stats,
                polling: {
                    interval: this.currentPollInterval,
                    maxInterval: this.maxPollInterval
                }
            };

        } catch (error) {
            this.logger.error('❌ Failed to get queue stats:', error);
            return null;
        }
    }

    /**
     * Get queue position (approximate)
     */
    async getQueuePosition() {
        try {
            const sql = 'SELECT COUNT(*) as count FROM jobs WHERE status = ?';
            const result = await this.database.get(sql, ['pending']);
            return result.count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate estimated processing time
     */
    calculateEstimatedProcessingTime(count = 1) {
        const avgTime = this.stats.avgProcessingTime || 2; // 2 seconds default
        const queueLength = 0; // Would get from getQueuePosition()
        
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
     * Wake up workers (reduce poll interval)
     */
    wakeUpWorkers() {
        this.currentPollInterval = this.pollInterval;
    }

    /**
     * Generate unique job ID
     */
    generateJobId(type) {
        return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const stats = await this.getQueueStats();
            
            return {
                service: 'QueueService',
                status: 'healthy',
                initialized: this.initialized,
                running: this.isRunning,
                database: {
                    connected: !!this.database,
                    healthy: this.database ? await this.database.healthCheck() : false
                },
                queues: stats,
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
     * Stop workers and cleanup
     */
    async stop() {
        this.logger.info('🛑 Stopping Queue service...');
        
        this.isRunning = false;
        
        // Wait for workers to finish current jobs
        await Promise.all(this.workers);
        
        // Clear workers array
        this.workers = [];
        
        // Cleanup old jobs
        await this.cleanupOldJobs();
        
        this.initialized = false;
        this.logger.info('✅ Queue service stopped');
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.stop();
    }
}

module.exports = QueueService;