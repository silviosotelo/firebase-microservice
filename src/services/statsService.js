// ==========================================
// STATS SERVICE
// Real-time statistics and analytics service
// ==========================================

const config = require('../config');
const AppLogger = require('../utils/logger');
const cron = require('cron');

class StatsService {
    constructor(dependencies = {}, options = {}) {
        this.logger = new AppLogger();
        this.websocketService = options.websocketService || null;
        this.database = dependencies.database;
        this.isInitialized = false;
        this.cache = new Map();
        this.cacheExpiry = new Map();
        this.cronJobs = [];
        this.updateInterval = null;
        
        // Default cache TTL (5 minutes)
        this.defaultCacheTTL = 5 * 60 * 1000;
        
        // Real-time stats
        this.realtimeStats = {
            activeConnections: 0,
            queueSizes: {},
            systemLoad: {
                cpu: 0,
                memory: 0,
                timestamp: new Date().toISOString()
            },
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Initialize stats service
     */
    async initialize() {
        try {
            this.logger.info('📊 Initializing Stats Service...');

            // Initialize cache cleanup
            this.initializeCacheCleanup();

            // Initialize periodic stats updates
            this.initializePeriodicUpdates();

            // Initialize scheduled tasks
            this.initializeScheduledTasks();

            this.isInitialized = true;
            this.logger.info('✅ Stats Service initialized');

        } catch (error) {
            this.logger.error('❌ Failed to initialize Stats Service:', error);
            throw error;
        }
    }

    /**
     * Initialize cache cleanup
     */
    initializeCacheCleanup() {
        // Clean expired cache entries every minute
        setInterval(() => {
            const now = Date.now();
            for (const [key, expiry] of this.cacheExpiry.entries()) {
                if (now > expiry) {
                    this.cache.delete(key);
                    this.cacheExpiry.delete(key);
                }
            }
        }, 60000);
    }

    /**
     * Initialize periodic stats updates
     */
    initializePeriodicUpdates() {
        // Update real-time stats every 30 seconds
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateRealtimeStats();
                if (this.websocketService) {
                    this.websocketService.broadcastStatsUpdate(this.realtimeStats);
                }
            } catch (error) {
                this.logger.error('❌ Failed to update real-time stats:', error);
            }
        }, 30000);
    }

    /**
     * Initialize scheduled tasks
     */
    initializeScheduledTasks() {
        // Daily statistics aggregation at 2 AM
        const dailyStatsJob = new cron.CronJob('0 2 * * *', async () => {
            try {
                await this.aggregateDailyStats();
            } catch (error) {
                this.logger.error('❌ Daily stats aggregation failed:', error);
            }
        });

        // Weekly statistics aggregation on Sunday at 3 AM
        const weeklyStatsJob = new cron.CronJob('0 3 * * 0', async () => {
            try {
                await this.aggregateWeeklyStats();
            } catch (error) {
                this.logger.error('❌ Weekly stats aggregation failed:', error);
            }
        });

        // Cache cleanup at midnight
        const cacheCleanupJob = new cron.CronJob('0 0 * * *', async () => {
            try {
                await this.cleanupExpiredCache();
            } catch (error) {
                this.logger.error('❌ Cache cleanup failed:', error);
            }
        });

        this.cronJobs.push(dailyStatsJob, weeklyStatsJob, cacheCleanupJob);

        // Start all cron jobs
        this.cronJobs.forEach(job => job.start());
        this.logger.info('✅ Scheduled tasks initialized');
    }

    /**
     * Start periodic updates
     */
    startPeriodicUpdates() {
        if (!this.updateInterval) {
            this.initializePeriodicUpdates();
        }
    }

    /**
     * Get overall statistics
     */
    async getOverallStats() {
        const cacheKey = 'overall_stats';
        
        // Check cache first
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const stats = db.prepare(`
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
            `).get();

            // Cache the result
            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get overall stats:', error);
            throw error;
        }
    }

    /**
     * Get daily statistics
     */
    async getDailyStats(days = 7) {
        const cacheKey = `daily_stats_${days}`;
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const stats = db.prepare(`
                SELECT 
                    date(created_at) as date,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(total_sent) as total_sent,
                    SUM(successful) as successful,
                    AVG(success_rate) as avg_success_rate,
                    AVG(processing_time) as avg_processing_time
                FROM notifications 
                WHERE created_at >= date('now', '-${days} days')
                GROUP BY date(created_at)
                ORDER BY date DESC
            `).all();

            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get daily stats:', error);
            throw error;
        }
    }

    /**
     * Get hourly statistics
     */
    async getHourlyStats(hours = 24) {
        const cacheKey = `hourly_stats_${hours}`;
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const stats = db.prepare(`
                SELECT 
                    strftime('%Y-%m-%d %H:00', created_at) as hour,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(total_sent) as total_sent,
                    SUM(successful) as successful,
                    AVG(success_rate) as avg_success_rate
                FROM notifications 
                WHERE created_at >= datetime('now', '-${hours} hours')
                GROUP BY strftime('%Y-%m-%d %H:00', created_at)
                ORDER BY hour DESC
            `).all();

            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get hourly stats:', error);
            throw error;
        }
    }

    /**
     * Get statistics by notification type
     */
    async getStatsByType() {
        const cacheKey = 'stats_by_type';
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const stats = db.prepare(`
                SELECT 
                    type,
                    COUNT(*) as count,
                    SUM(total_sent) as total_sent,
                    SUM(successful) as successful,
                    AVG(success_rate) as avg_success_rate,
                    AVG(processing_time) as avg_processing_time
                FROM notifications 
                GROUP BY type
                ORDER BY count DESC
            `).all();

            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get stats by type:', error);
            throw error;
        }
    }

    /**
     * Get statistics by priority
     */
    async getStatsByPriority() {
        const cacheKey = 'stats_by_priority';
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const stats = db.prepare(`
                SELECT 
                    priority,
                    COUNT(*) as count,
                    AVG(processing_time) as avg_processing_time,
                    AVG(success_rate) as avg_success_rate
                FROM notifications 
                GROUP BY priority
                ORDER BY 
                    CASE priority 
                        WHEN 'high' THEN 1 
                        WHEN 'normal' THEN 2 
                        WHEN 'low' THEN 3 
                    END
            `).all();

            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get stats by priority:', error);
            throw error;
        }
    }

    /**
     * Get error statistics
     */
    async getErrorStats() {
        const cacheKey = 'error_stats';
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            const errorStats = db.prepare(`
                SELECT 
                    error_code,
                    error_message,
                    COUNT(*) as count,
                    COUNT(DISTINCT notification_id) as affected_notifications
                FROM notification_responses 
                WHERE success = 0 
                AND created_at >= datetime('now', '-7 days')
                GROUP BY error_code, error_message
                ORDER BY count DESC
                LIMIT 20
            `).all();

            const errorTrends = db.prepare(`
                SELECT 
                    date(created_at) as date,
                    COUNT(*) as total_errors,
                    COUNT(DISTINCT error_code) as unique_errors
                FROM notification_responses 
                WHERE success = 0 
                AND created_at >= datetime('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY date DESC
            `).all();

            const stats = {
                topErrors: errorStats,
                errorTrends: errorTrends
            };

            this.setCache(cacheKey, stats, this.defaultCacheTTL);
            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get error stats:', error);
            throw error;
        }
    }

    /**
     * Get performance metrics
     */
    async getPerformanceMetrics() {
        const cacheKey = 'performance_metrics';
        
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const db = this.database.getConnection();
            
            // Processing time percentiles
            const processingTimes = db.prepare(`
                SELECT processing_time 
                FROM notifications 
                WHERE processing_time IS NOT NULL 
                AND created_at >= datetime('now', '-24 hours')
                ORDER BY processing_time
            `).all().map(row => row.processing_time);

            const metrics = {
                processingTime: {
                    average: processingTimes.length > 0 ? 
                        processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length : 0,
                    p50: getPercentile(processingTimes, 50),
                    p95: getPercentile(processingTimes, 95),
                    p99: getPercentile(processingTimes, 99)
                },
                throughput: await this.getThroughputMetrics(),
                system: this.realtimeStats.systemLoad
            };

            this.setCache(cacheKey, metrics, this.defaultCacheTTL);
            return metrics;

        } catch (error) {
            this.logger.error('❌ Failed to get performance metrics:', error);
            throw error;
        }
    }

    /**
     * Get throughput metrics
     */
    async getThroughputMetrics() {
        try {
            const db = this.database.getConnection();
            
            const hourlyThroughput = db.prepare(`
                SELECT 
                    strftime('%H', created_at) as hour,
                    COUNT(*) as notifications_per_hour,
                    SUM(total_sent) as messages_per_hour
                FROM notifications 
                WHERE created_at >= datetime('now', '-24 hours')
                GROUP BY strftime('%H', created_at)
                ORDER BY hour
            `).all();

            const peakHour = hourlyThroughput.reduce((max, current) => 
                current.messages_per_hour > max.messages_per_hour ? current : max, 
                { messages_per_hour: 0 }
            );

            return {
                hourlyThroughput,
                peakHour: peakHour.hour || 'N/A',
                peakThroughput: peakHour.messages_per_hour || 0
            };

        } catch (error) {
            this.logger.error('❌ Failed to get throughput metrics:', error);
            return { hourlyThroughput: [], peakHour: 'N/A', peakThroughput: 0 };
        }
    }

    /**
     * Update real-time statistics
     */
    async updateRealtimeStats() {
        try {
            const overall = await this.getOverallStats();
            
            // Update system load (simplified - in production you'd use proper system monitoring)
            const memUsage = process.memoryUsage();
            
            this.realtimeStats = {
                ...this.realtimeStats,
                notifications: {
                    total: overall.total,
                    queued: overall.queued,
                    processing: overall.processing,
                    completed: overall.completed,
                    failed: overall.failed
                },
                systemLoad: {
                    memory: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
                    uptime: Math.round(process.uptime()),
                    timestamp: new Date().toISOString()
                },
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('❌ Failed to update real-time stats:', error);
        }
    }

    /**
     * Get real-time statistics
     */
    getRealtimeStats() {
        return this.realtimeStats;
    }

    /**
     * Aggregate daily statistics
     */
    async aggregateDailyStats() {
        try {
            this.logger.info('📊 Running daily statistics aggregation...');
            
            const db = this.database.getConnection();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const dateStr = yesterday.toISOString().split('T')[0];

            // Aggregate yesterday's data
            const dailyStats = db.prepare(`
                SELECT 
                    COUNT(*) as total_notifications,
                    SUM(total_sent) as total_messages,
                    SUM(successful) as successful_messages,
                    SUM(failed) as failed_messages,
                    AVG(success_rate) as avg_success_rate,
                    AVG(processing_time) as avg_processing_time
                FROM notifications 
                WHERE date(created_at) = ?
            `).get(dateStr);

            // Store aggregated data
            const cacheKey = `daily_aggregate_${dateStr}`;
            this.setCache(cacheKey, {
                date: dateStr,
                ...dailyStats,
                aggregated_at: new Date().toISOString()
            }, 7 * 24 * 60 * 60 * 1000); // Cache for 7 days

            this.logger.info(`✅ Daily aggregation completed for ${dateStr}`);

        } catch (error) {
            this.logger.error('❌ Daily aggregation failed:', error);
        }
    }

    /**
     * Aggregate weekly statistics
     */
    async aggregateWeeklyStats() {
        try {
            this.logger.info('📊 Running weekly statistics aggregation...');
            
            const db = this.database.getConnection();
            
            // Get last week's data
            const weeklyStats = db.prepare(`
                SELECT 
                    COUNT(*) as total_notifications,
                    SUM(total_sent) as total_messages,
                    SUM(successful) as successful_messages,
                    AVG(success_rate) as avg_success_rate,
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(DISTINCT type) as notification_types_used
                FROM notifications 
                WHERE created_at >= datetime('now', '-7 days')
            `).get();

            // Store weekly aggregate
            const weekKey = `weekly_aggregate_${new Date().toISOString().split('T')[0]}`;
            this.setCache(weekKey, {
                week_ending: new Date().toISOString().split('T')[0],
                ...weeklyStats,
                aggregated_at: new Date().toISOString()
            }, 30 * 24 * 60 * 60 * 1000); // Cache for 30 days

            this.logger.info('✅ Weekly aggregation completed');

        } catch (error) {
            this.logger.error('❌ Weekly aggregation failed:', error);
        }
    }

    /**
     * Clean up expired cache from database
     */
    async cleanupExpiredCache() {
        try {
            const db = this.database.getConnection();
            const result = db.prepare(`
                DELETE FROM stats_cache WHERE expires_at < datetime('now')
            `).run();

            this.logger.info(`🧹 Cleaned up ${result.changes} expired cache entries`);

        } catch (error) {
            this.logger.error('❌ Cache cleanup failed:', error);
        }
    }

    /**
     * Cache management methods
     */
    setCache(key, value, ttl = this.defaultCacheTTL) {
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + ttl);
    }

    getFromCache(key) {
        if (this.cacheExpiry.has(key) && Date.now() > this.cacheExpiry.get(key)) {
            this.cache.delete(key);
            this.cacheExpiry.delete(key);
            return null;
        }
        return this.cache.get(key);
    }

    clearCache() {
        this.cache.clear();
        this.cacheExpiry.clear();
    }

    /**
     * Export statistics in various formats
     */
    async exportStats(format = 'json', period = '30d') {
        try {
            const stats = {
                overall: await this.getOverallStats(),
                daily: await this.getDailyStats(30),
                byType: await this.getStatsByType(),
                byPriority: await this.getStatsByPriority(),
                errors: await this.getErrorStats(),
                performance: await this.getPerformanceMetrics(),
                exportedAt: new Date().toISOString()
            };

            if (format === 'csv') {
                return this.convertStatsToCSV(stats);
            }

            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to export stats:', error);
            throw error;
        }
    }

    /**
     * Convert stats to CSV format
     */
    convertStatsToCSV(stats) {
        const csvRows = [];
        
        // Daily stats CSV
        csvRows.push('Date,Total,Completed,Failed,Success Rate,Avg Processing Time');
        stats.daily.forEach(day => {
            csvRows.push([
                day.date,
                day.total,
                day.completed,
                day.failed,
                day.avg_success_rate || 0,
                day.avg_processing_time || 0
            ].join(','));
        });

        return csvRows.join('\n');
    }

    /**
     * Stop stats service
     */
    async stop() {
        try {
            this.logger.info('🛑 Stopping Stats Service...');

            // Stop update interval
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            // Stop cron jobs
            this.cronJobs.forEach(job => job.stop());
            this.cronJobs = [];

            // Clear cache
            this.clearCache();

            this.isInitialized = false;
            this.logger.info('✅ Stats Service stopped');

        } catch (error) {
            this.logger.error('❌ Failed to stop Stats Service:', error);
            throw error;
        }
    }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Calculate percentile for an array of numbers
 */
function getPercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    
    const sorted = arr.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
}

module.exports = StatsService;