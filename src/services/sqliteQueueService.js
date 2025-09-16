// ==========================================
// SQLITE QUEUE SERVICE - Queue con persistencia SQLite
// Cola robusta usando SQLite como backend
// ==========================================

const AppLogger = require('../utils/logger');
const { NOTIFICATION_STATUS } = require('../utils/constants');

class SQLiteQueueService {
    constructor(websocketService = null, models = null) {
        this.logger = new AppLogger('SQLiteQueueService');
        this.websocketService = websocketService;
        
        // Database connection - can be injected
        this.db = null;
        this.models = models;
        
        // Worker settings
        this.workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY) || 3;
        this.workers = [];
        this.isRunning = false;
        this.workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        // Polling settings
        this.pollInterval = 1000; // 1 segundo
        this.maxPollInterval = 10000; // 10 segundos máximo
        this.currentPollInterval = this.pollInterval;
        
        // Prepared statements for performance
        this.statements = {};
        
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
            this.logger.info('📦 Initializing SQLite Queue service...');
            
            // Use injected database connection
            if (this.models) {
                this.logger.info('📦 Using injected models...');
                // Use the database connection from the injected models
                this.db = this.models.db || this.models.database;
            } else {
                throw new Error('Models must be injected during initialization');
            }
            
            if (!this.db) {
                throw new Error('Database connection is null');
            }
            
            if (!this.models) {
                throw new Error('Models are null');
            }
            
            this.logger.info('✅ Database and models available');
            
            // Prepare SQL statements
            this.logger.info('📋 Preparing SQL statements...');
            this.prepareStatements();
            
            // Clean up orphaned jobs
            this.logger.info('🧹 Cleaning up orphaned jobs...');
            await this.cleanupOrphanedJobs();
            
            this.initialized = true;
            this.logger.info('✅ SQLite Queue service initialized');
            
        } catch (error) {
            this.logger.error('❌ SQLite Queue initialization failed:', error.message);
            if (error.stack) {
                this.logger.error('📍 Queue error stack:', error.stack);
            } else {
                this.logger.error('📍 Queue error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
            throw error;
        }
    }

    /**
     * Prepare SQL statements for better performance
     */
    prepareStatements() {
        try {
            this.logger.info('📋 Starting to prepare SQL statements...');
            
            // Test basic DB access first
            this.logger.info('🔍 Testing basic database access...');
            const testResult = this.db.prepare('SELECT 1 as test').get();
            this.logger.info(`✅ Basic DB test result: ${JSON.stringify(testResult)}`);
            
            // Check if jobs table exists
            this.logger.info('🔍 Checking if jobs table exists...');
            const tableCheck = this.db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='jobs'
            `).get();
            this.logger.info(`📊 Jobs table check result: ${JSON.stringify(tableCheck)}`);
            
            if (!tableCheck) {
                throw new Error('Jobs table does not exist in database. Check if schema was applied correctly.');
            }
            
            // Check jobs table structure
            this.logger.info('🔍 Checking jobs table structure...');
            //const tableInfo = this.db.prepare('PRAGMA table_info(jobs)').all();
            const tableInfo = this.db.prepare('SELECT 1 as test').get();
            this.logger.info(`📋 Jobs table columns: ${JSON.stringify(tableInfo)}`);
            
            this.logger.info('📝 Preparing insertJob statement...');
            this.statements.insertJob = this.db.prepare(`
                INSERT INTO jobs (job_id, type, notification_id, payload, priority, scheduled_at, max_attempts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            this.logger.info('✅ insertJob statement prepared');
            
            this.logger.info('📝 Preparing getNextJobs statement...');
            this.statements.getNextJobs = this.db.prepare(`
                SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND scheduled_at <= CURRENT_TIMESTAMP
                ORDER BY priority DESC, scheduled_at ASC 
                LIMIT ?
            `);
            this.logger.info('✅ getNextJobs statement prepared');
            
            this.logger.info('📝 Preparing updateJobStatus statement...');
            this.statements.updateJobStatus = this.db.prepare(`
                UPDATE jobs 
                SET status = ?, worker_id = ?, started_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
            `);
            this.logger.info('✅ updateJobStatus statement prepared');
            
            this.logger.info('📝 Preparing completeJob statement...');
            this.statements.completeJob = this.db.prepare(`
                UPDATE jobs 
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            this.logger.info('✅ completeJob statement prepared');
            
            this.logger.info('📝 Preparing failJob statement...');
            this.statements.failJob = this.db.prepare(`
                UPDATE jobs 
                SET status = 'failed', error_message = ?, attempts = attempts + 1
                WHERE id = ?
            `);
            this.logger.info('✅ failJob statement prepared');
            
            this.logger.info('📝 Preparing retryJob statement...');
            this.statements.retryJob = this.db.prepare(`
                UPDATE jobs 
                SET status = 'pending', worker_id = NULL, started_at = NULL, 
                    scheduled_at = datetime('now', '+' || ? || ' seconds'),
                    attempts = attempts + 1
                WHERE id = ?
            `);
            this.logger.info('✅ retryJob statement prepared');
            
            this.logger.info('📝 Preparing getJobStats statement...');
            this.statements.getJobStats = this.db.prepare(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM jobs 
                GROUP BY status
            `);
            this.logger.info('✅ getJobStats statement prepared');
            
            this.logger.info('📝 Preparing getPendingCount statement...');
            this.statements.getPendingCount = this.db.prepare(`
                SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'
            `);
            this.logger.info('✅ getPendingCount statement prepared');
            
            this.logger.info('📝 Preparing getProcessingCount statement...');
            this.statements.getProcessingCount = this.db.prepare(`
                SELECT COUNT(*) as count FROM jobs WHERE status = 'processing'
            `);
            this.logger.info('✅ getProcessingCount statement prepared');
            
            this.logger.info('📝 Preparing cleanupJobs statement...');
            this.statements.cleanupJobs = this.db.prepare(`
                DELETE FROM jobs 
                WHERE status IN ('completed', 'failed') 
                AND created_at < datetime('now', '-' || ? || ' hours')
            `);
            this.logger.info('✅ cleanupJobs statement prepared');
            
            this.logger.info('📝 Preparing getWorkerJobs statement...');
            this.statements.getWorkerJobs = this.db.prepare(`
                SELECT COUNT(*) as count FROM jobs WHERE worker_id = ?
            `);
            this.logger.info('✅ getWorkerJobs statement prepared');
            
            this.logger.info('✅ All SQL statements prepared successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to prepare SQL statements:', error.message);
            this.logger.error('❌ Statement preparation error details:', error);
            this.logger.error('❌ Statement error stack:', error.stack);
            throw error;
        }
    }

    /**
     * Clean up orphaned jobs (jobs marked as processing but worker died)
     */
    async cleanupOrphanedJobs() {
        try {
            const cleanupStmt = this.db.prepare(`
                UPDATE jobs 
                SET status = 'pending', worker_id = NULL, started_at = NULL
                WHERE status = 'processing' 
                AND started_at < datetime('now', '-5 minutes')
            `);
            
            const result = cleanupStmt.run();
            
            if (result.changes > 0) {
                this.logger.info(`🧹 Cleaned up ${result.changes} orphaned jobs`);
            }
            
        } catch (error) {
            this.logger.error('❌ Failed to cleanup orphaned jobs:', error);
        }
    }

    /**
     * Queue single notification
     */
    async queueNotification(notificationData, options = {}) {
        try {
            const {
                priority = 5, // 1-10 scale (10 = highest)
                delay = 0,
                requestId = null,
                maxAttempts = 3
            } = options;

            // Create notification record
            const notification = await this.models.Notification.create({
                ...notificationData,
                status: NOTIFICATION_STATUS.QUEUED,
                request_id: requestId
            });

            // Generate job ID
            const jobId = this.generateJobId('notification');
            
            // Calculate scheduled time
            const scheduledAt = new Date(Date.now() + delay).toISOString();

            // Create job payload
            const payload = {
                notificationId: notification.id,
                data: notificationData,
                requestId
            };

            // Insert job
            this.statements.insertJob.run(
                jobId,
                'notification',
                notification.id,
                JSON.stringify(payload),
                priority,
                scheduledAt,
                maxAttempts
            );

            this.logger.info(`📋 Notification queued: ${notification.id} (Job: ${jobId})`);

            // Broadcast to websocket
            if (this.websocketService) {
                this.websocketService.broadcastNotificationUpdate(notification.id, {
                    status: NOTIFICATION_STATUS.QUEUED,
                    jobId: jobId,
                    queuePosition: await this.getQueuePosition()
                });
            }

            // Wake up workers if they're sleeping
            this.wakeUpWorkers();

            return {
                notificationId: notification.id,
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
     * Queue bulk notifications
     */
    async queueBulkNotifications(notifications, options = {}) {
        try {
            const { 
                batchSize = 100, 
                priority = 5, 
                requestId = null,
                maxAttempts = 2
            } = options;

            this.logger.info(`📬 Queuing ${notifications.length} bulk notifications...`);

            const results = [];
            
            // Process in batches
            for (let i = 0; i < notifications.length; i += batchSize) {
                const batch = notifications.slice(i, i + batchSize);
                
                // Create notification records
                const notificationRecords = await Promise.all(
                    batch.map(notifData => 
                        this.models.Notification.create({
                            ...notifData,
                            status: NOTIFICATION_STATUS.QUEUED,
                            request_id: requestId
                        })
                    )
                );

                // Create bulk job
                const jobId = this.generateJobId('bulk');
                const payload = {
                    notificationIds: notificationRecords.map(n => n.id),
                    batch: batch,
                    requestId
                };

                this.statements.insertJob.run(
                    jobId,
                    'bulk',
                    null, // No single notification ID for bulk
                    JSON.stringify(payload),
                    priority,
                    new Date().toISOString(),
                    maxAttempts
                );

                results.push({
                    batchIndex: Math.floor(i / batchSize),
                    jobId: jobId,
                    notificationIds: notificationRecords.map(n => n.id)
                });

                this.logger.debug(`📦 Batch ${Math.floor(i / batchSize)} queued: ${batch.length} notifications`);
            }

            this.wakeUpWorkers();

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
     * Start workers
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
                        this.currentPollInterval * 1.5,
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
            // Get next job to process
            const jobs = this.statements.getNextJobs.all(1);
            
            if (jobs.length === 0) {
                return false; // No jobs available
            }

            const job = jobs[0];

            // Try to claim the job (atomic operation)
            const updateResult = this.statements.updateJobStatus.run(
                'processing',
                workerId,
                job.id
            );

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
            this.statements.completeJob.run(job.id);

            // Update stats
            this.updateStats(true, Date.now() - startTime);

            this.logger.debug(`✅ Job ${job.job_id} completed by worker ${workerId}`);

        } catch (error) {
            this.logger.error(`❌ Job ${job.job_id} failed:`, error);

            // Check if we should retry
            if (job.attempts < job.max_attempts - 1) {
                // Schedule retry with exponential backoff
                const retryDelay = Math.pow(2, job.attempts) * 30; // 30s, 60s, 120s...
                this.statements.retryJob.run(retryDelay, job.id);
                
                this.stats.totalRetries++;
                this.logger.info(`🔄 Job ${job.job_id} scheduled for retry (attempt ${job.attempts + 2}/${job.max_attempts})`);
            } else {
                // Mark as permanently failed
                this.statements.failJob.run(error.message, job.id);
                this.updateStats(false, Date.now() - startTime);
                
                this.logger.error(`💀 Job ${job.job_id} failed permanently after ${job.max_attempts} attempts`);
            }
        }
    }

    /**
     * Process notification job
     */
    async processNotificationJob(payload) {
        const { notificationId, data } = payload;

        // Update notification status
        await this.models.Notification.updateStatus(notificationId, NOTIFICATION_STATUS.PROCESSING);

        // Broadcast status update
        if (this.websocketService) {
            this.websocketService.broadcastNotificationUpdate(notificationId, {
                status: NOTIFICATION_STATUS.PROCESSING,
                startedAt: new Date().toISOString()
            });
        }

        // Simulate Firebase processing (replace with actual Firebase service)
        const result = await this.simulateFirebaseProcessing(data);

        // Update notification with result
        await this.models.Notification.updateWithResult(notificationId, {
            status: NOTIFICATION_STATUS.COMPLETED,
            total_sent: result.totalSent,
            successful: result.successful,
            failed: result.failed,
            success_rate: result.successRate,
            firebase_response: result.responses
        });

        // Broadcast completion
        if (this.websocketService) {
            this.websocketService.broadcastNotificationUpdate(notificationId, {
                status: NOTIFICATION_STATUS.COMPLETED,
                result: result,
                completedAt: new Date().toISOString()
            });
        }

        return result;
    }

    /**
     * Process bulk job
     */
    async processBulkJob(payload) {
        const { notificationIds, batch } = payload;

        this.logger.debug(`🔄 Processing bulk job with ${batch.length} notifications...`);

        const results = [];

        for (let i = 0; i < batch.length; i++) {
            const notificationData = batch[i];
            const notificationId = notificationIds[i];

            try {
                // Update status
                await this.models.Notification.updateStatus(notificationId, NOTIFICATION_STATUS.PROCESSING);

                // Process notification
                const result = await this.simulateFirebaseProcessing(notificationData);

                // Update notification
                await this.models.Notification.updateWithResult(notificationId, {
                    status: NOTIFICATION_STATUS.COMPLETED,
                    total_sent: result.totalSent,
                    successful: result.successful,
                    failed: result.failed,
                    success_rate: result.successRate
                });

                results.push({ notificationId, success: true, result });

            } catch (error) {
                await this.models.Notification.updateWithResult(notificationId, {
                    status: NOTIFICATION_STATUS.FAILED,
                    error_message: error.message
                });

                results.push({ notificationId, success: false, error: error.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        this.logger.info(`✅ Bulk job completed: ${successCount}/${batch.length} successful`);

        return {
            totalProcessed: batch.length,
            successful: successCount,
            failed: batch.length - successCount,
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
     * Simulate Firebase processing (replace with actual service)
     */
    async simulateFirebaseProcessing(data) {
        // Simulate processing time
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
     * Get queue statistics
     */
    async getQueueStats() {
        try {
            const statusCounts = {};
            const statusResults = this.statements.getJobStats.all();
            
            statusResults.forEach(row => {
                statusCounts[row.status] = row.count;
            });

            const pendingCount = this.statements.getPendingCount.get().count;
            const processingCount = this.statements.getProcessingCount.get().count;

            return {
                jobs: {
                    pending: pendingCount,
                    processing: processingCount,
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
            return this.statements.getPendingCount.get().count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate estimated processing time
     */
    calculateEstimatedProcessingTime(count = 1) {
        const avgTime = this.stats.avgProcessingTime || 2; // 2 seconds default
        const queueLength = this.statements.getPendingCount.get().count || 0;
        
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
     * Cleanup old jobs
     */
    async cleanupOldJobs(hoursOld = 24) {
        try {
            const result = this.statements.cleanupJobs.run(hoursOld);
            
            if (result.changes > 0) {
                this.logger.info(`🧹 Cleaned up ${result.changes} old jobs (older than ${hoursOld} hours)`);
            }
            
            return result.changes;

        } catch (error) {
            this.logger.error('❌ Failed to cleanup old jobs:', error);
            return 0;
        }
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
    async getHealthStatus() {
        try {
            const stats = await this.getQueueStats();
            
            return {
                service: 'SQLiteQueueService',
                status: 'healthy',
                initialized: this.initialized,
                running: this.isRunning,
                database: {
                    connected: !!this.db,
                    path: this.db ? 'Connected' : 'Not connected'
                },
                queues: stats,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                service: 'SQLiteQueueService',
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
        this.logger.info('🛑 Stopping SQLite Queue service...');
        
        this.isRunning = false;
        
        // Wait for workers to finish current jobs
        await Promise.all(this.workers);
        
        // Clear workers array
        this.workers = [];
        
        // Cleanup old jobs
        await this.cleanupOldJobs();
        
        this.initialized = false;
        this.logger.info('✅ SQLite Queue service stopped');
    }
}

module.exports = SQLiteQueueService;