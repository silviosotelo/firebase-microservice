// ==========================================
// STATS CONTROLLER
// Handles statistics, metrics and system status
// ==========================================

const AppLogger = require('../utils/logger');
const { Notification } = require('../models');
const { formatBytes, formatDuration } = require('../utils/validators');
const { CACHE_TTL } = require('../utils/constants');

class StatsController {
    constructor() {
        this.logger = new AppLogger('StatsController');
        this.metricsCache = new Map();
        this.cacheExpiry = new Map();
        
        // Initialize Prometheus metrics if available
        this.initializeMetrics();
    }

    /**
     * Initialize Prometheus metrics
     */
    initializeMetrics() {
        try {
            this.promClient = require('prom-client');
            this.register = new this.promClient.Registry();
            
            // Create custom metrics
            this.metrics = {
                notificationsSent: new this.promClient.Counter({
                    name: 'notifications_sent_total',
                    help: 'Total number of notifications sent',
                    labelNames: ['type', 'status', 'priority']
                }),
                
                processingTime: new this.promClient.Histogram({
                    name: 'notification_processing_seconds',
                    help: 'Time spent processing notifications',
                    labelNames: ['type', 'status'],
                    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
                }),
                
                queueSize: new this.promClient.Gauge({
                    name: 'queue_size',
                    help: 'Current queue size',
                    labelNames: ['queue_type', 'status']
                }),
                
                activeConnections: new this.promClient.Gauge({
                    name: 'websocket_connections_active',
                    help: 'Number of active WebSocket connections'
                }),
                
                errorRate: new this.promClient.Counter({
                    name: 'errors_total',
                    help: 'Total number of errors',
                    labelNames: ['type', 'endpoint']
                })
            };
            
            // Register metrics
            Object.values(this.metrics).forEach(metric => {
                this.register.registerMetric(metric);
            });
            
            // Add default Node.js metrics
            this.promClient.collectDefaultMetrics({ register: this.register });
            
            this.logger.info('📊 Prometheus metrics initialized');
            
        } catch (error) {
            this.logger.warn('⚠️ Prometheus not available, metrics disabled');
            this.metricsEnabled = false;
        }
    }

    /**
     * Get general statistics
     */
    async getStats(req, res, next) {
        try {
            const {
                period = '24h',
                groupBy = 'hour',
                userId,
                type,
                status
            } = req.query;

            // Check cache first
            const cacheKey = `stats:${period}:${groupBy}:${userId || 'all'}:${type || 'all'}:${status || 'all'}`;
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
                return res.json({
                    success: true,
                    data: cached,
                    cached: true,
                    timestamp: new Date().toISOString()
                });
            }

            // Get date range
            const dateRange = this.calculateDateRange(period);
            
            // Get notification stats
            const notificationStats = await Notification.getStats({
                dateFrom: dateRange.from,
                dateTo: dateRange.to,
                groupBy,
                userId,
                type,
                status
            });

            // Get queue stats
            const queueStats = await this.getQueueStatsInternal();
            
            // Get system stats
            const systemStats = this.getSystemStats();

            const stats = {
                period,
                dateRange,
                notifications: notificationStats,
                queue: queueStats,
                system: systemStats,
                generated_at: new Date().toISOString()
            };

            // Cache for 5 minutes
            this.setCache(cacheKey, stats, CACHE_TTL.SHORT);

            res.json({
                success: true,
                data: stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get stats:', error);
            next(error);
        }
    }

    /**
     * Get real-time statistics
     */
    async getRealtimeStats(req, res, next) {
        try {
            // Get current queue status
            const queueStats = await this.getQueueStatsInternal();
            
            // Get recent activity (last hour)
            const recentStats = await Notification.getStats({
                dateFrom: new Date(Date.now() - 3600000).toISOString(),
                dateTo: new Date().toISOString(),
                groupBy: 'hour'
            });

            // Get WebSocket connections (if service is available)
            let wsStats = { activeConnections: 0, totalConnections: 0 };
            try {
                const { getWebSocketService } = require('../app');
                const wsService = getWebSocketService();
                if (wsService) {
                    wsStats = wsService.getConnectionStats();
                }
            } catch (error) {
                // WebSocket service not available
            }

            const realTimeStats = {
                queue: queueStats,
                recent: recentStats.overall || {},
                websocket: wsStats,
                system: {
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    cpu: process.cpuUsage(),
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            };

            res.json({
                success: true,
                data: realTimeStats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get realtime stats:', error);
            next(error);
        }
    }

    /**
     * Get system status
     */
    async getSystemStatus(req, res, next) {
        try {
            const status = {
                service: 'Firebase Notification Microservice',
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                status: 'healthy',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                
                memory: {
                    ...process.memoryUsage(),
                    formatted: {
                        rss: formatBytes(process.memoryUsage().rss),
                        heapUsed: formatBytes(process.memoryUsage().heapUsed),
                        heapTotal: formatBytes(process.memoryUsage().heapTotal),
                        external: formatBytes(process.memoryUsage().external)
                    }
                },
                
                cpu: process.cpuUsage(),
                
                platform: {
                    arch: process.arch,
                    platform: process.platform,
                    nodeVersion: process.version,
                    pid: process.pid
                }
            };

            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get system status:', error);
            next(error);
        }
    }

    /**
     * Export statistics in various formats
     */
    async exportStats(req, res, next) {
        try {
            const {
                format = 'json',
                period = '30d',
                type
            } = req.query;

            const dateRange = this.calculateDateRange(period);
            
            const stats = await Notification.getStats({
                dateFrom: dateRange.from,
                dateTo: dateRange.to,
                groupBy: 'day',
                type
            });

            const exportData = {
                exported_at: new Date().toISOString(),
                period: period,
                date_range: dateRange,
                summary: stats.overall,
                time_series: stats.timeSeries || []
            };

            switch (format.toLowerCase()) {
                case 'csv':
                    const csv = this.convertToCSV(exportData.time_series);
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename="stats-${period}.csv"`);
                    res.send(csv);
                    break;
                    
                case 'xlsx':
                    // Would implement Excel export here
                    res.status(501).json({
                        success: false,
                        error: 'XLSX export not yet implemented'
                    });
                    break;
                    
                default: // json
                    res.json({
                        success: true,
                        data: exportData,
                        timestamp: new Date().toISOString()
                    });
            }

        } catch (error) {
            this.logger.error('❌ Failed to export stats:', error);
            next(error);
        }
    }

    /**
     * Get queue status
     */
    async getQueueStatus(req, res, next) {
        try {
            const queueStats = await this.getQueueStatsInternal();
            
            res.json({
                success: true,
                data: queueStats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get queue status:', error);
            next(error);
        }
    }

    /**
     * Pause queue processing
     */
    async pauseQueue(req, res, next) {
        try {
            // Get queue service
            const { getQueueService } = require('../app');
            const queueService = getQueueService();
            
            if (queueService) {
                await queueService.pauseQueues();
                this.logger.info('⏸️ Queue processing paused');
                
                res.json({
                    success: true,
                    message: 'Queue processing paused',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(503).json({
                    success: false,
                    error: 'Queue service not available'
                });
            }

        } catch (error) {
            this.logger.error('❌ Failed to pause queue:', error);
            next(error);
        }
    }

    /**
     * Resume queue processing
     */
    async resumeQueue(req, res, next) {
        try {
            const { getQueueService } = require('../app');
            const queueService = getQueueService();
            
            if (queueService) {
                await queueService.resumeQueues();
                this.logger.info('▶️ Queue processing resumed');
                
                res.json({
                    success: true,
                    message: 'Queue processing resumed',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(503).json({
                    success: false,
                    error: 'Queue service not available'
                });
            }

        } catch (error) {
            this.logger.error('❌ Failed to resume queue:', error);
            next(error);
        }
    }

    /**
     * Clear failed jobs
     */
    async clearFailedJobs(req, res, next) {
        try {
            const { getQueueService } = require('../app');
            const queueService = getQueueService();
            
            if (queueService) {
                const result = await queueService.clearFailedJobs();
                this.logger.info(`🧹 Cleared ${result.cleared} failed jobs`);
                
                res.json({
                    success: true,
                    message: 'Failed jobs cleared',
                    data: result,
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(503).json({
                    success: false,
                    error: 'Queue service not available'
                });
            }

        } catch (error) {
            this.logger.error('❌ Failed to clear failed jobs:', error);
            next(error);
        }
    }

    /**
     * Cleanup old data
     */
    async cleanupOldData(req, res, next) {
        try {
            const { days = 90 } = req.body;
            
            const result = await Notification.cleanup(days);
            this.logger.info(`🧹 Cleaned up ${result.deleted} old notifications`);
            
            res.json({
                success: true,
                message: `Cleaned up old data (${days} days)`,
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to cleanup old data:', error);
            next(error);
        }
    }

    /**
     * Clear all caches
     */
    async clearCaches(req, res, next) {
        try {
            // Clear internal caches
            this.metricsCache.clear();
            this.cacheExpiry.clear();
            
            // Clear other service caches
            const clearedCaches = ['metrics', 'stats'];
            
            this.logger.info('🧹 All caches cleared');
            
            res.json({
                success: true,
                message: 'All caches cleared',
                data: {
                    cleared: clearedCaches,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            this.logger.error('❌ Failed to clear caches:', error);
            next(error);
        }
    }

    /**
     * Get Prometheus metrics
     */
    async getPrometheusMetrics(req, res, next) {
        try {
            if (!this.register) {
                return res.status(501).send('# Metrics not available\n');
            }

            // Update custom metrics
            await this.updatePrometheusMetrics();
            
            const metrics = await this.register.metrics();
            
            res.set('Content-Type', this.register.contentType);
            res.send(metrics);

        } catch (error) {
            this.logger.error('❌ Failed to get Prometheus metrics:', error);
            res.status(500).send('# Error retrieving metrics\n');
        }
    }

    // ==========================================
    // PRIVATE HELPER METHODS
    // ==========================================

    /**
     * Get internal queue statistics
     */
    async getQueueStatsInternal() {
        try {
            const { getQueueService } = require('../app');
            const queueService = getQueueService();
            
            if (queueService) {
                return await queueService.getQueueStats();
            } else {
                return {
                    notification: { waiting: 0, active: 0, completed: 0, failed: 0 },
                    bulk: { waiting: 0, active: 0, completed: 0, failed: 0 },
                    retry: { waiting: 0, active: 0, completed: 0, failed: 0 }
                };
            }
        } catch (error) {
            this.logger.error('❌ Failed to get queue stats:', error);
            return {};
        }
    }

    /**
     * Get system statistics
     */
    getSystemStats() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            uptime: process.uptime(),
            memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                formatted: {
                    rss: formatBytes(memUsage.rss),
                    heapUsed: formatBytes(memUsage.heapUsed),
                    heapTotal: formatBytes(memUsage.heapTotal),
                    external: formatBytes(memUsage.external)
                }
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            process: {
                pid: process.pid,
                version: process.version,
                platform: process.platform,
                arch: process.arch
            }
        };
    }

    /**
     * Calculate date range from period
     */
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

    /**
     * Convert data to CSV format
     */
    convertToCSV(data) {
        if (!data || data.length === 0) {
            return 'No data available\n';
        }

        const headers = Object.keys(data[0]);
        const csvHeaders = headers.join(',') + '\n';
        
        const csvRows = data.map(row => 
            headers.map(header => {
                const value = row[header];
                // Escape commas and quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        ).join('\n');

        return csvHeaders + csvRows;
    }

    /**
     * Update Prometheus metrics
     */
    async updatePrometheusMetrics() {
        if (!this.metrics) return;

        try {
            // Get recent stats for metrics
            const recentStats = await Notification.getStats({
                dateFrom: new Date(Date.now() - 3600000).toISOString(), // Last hour
                dateTo: new Date().toISOString(),
                groupBy: 'hour'
            });

            // Update notification counters
            if (recentStats.overall) {
                this.metrics.notificationsSent.inc({ type: 'all', status: 'completed' }, recentStats.overall.completed || 0);
                this.metrics.notificationsSent.inc({ type: 'all', status: 'failed' }, recentStats.overall.failed || 0);
            }

            // Update queue size metrics
            const queueStats = await this.getQueueStatsInternal();
            if (queueStats.notification) {
                this.metrics.queueSize.set({ queue_type: 'notification', status: 'waiting' }, queueStats.notification.waiting || 0);
                this.metrics.queueSize.set({ queue_type: 'notification', status: 'active' }, queueStats.notification.active || 0);
            }

        } catch (error) {
            this.logger.error('❌ Failed to update Prometheus metrics:', error);
        }
    }

    /**
     * Cache management
     */
    getFromCache(key) {
        const expiry = this.cacheExpiry.get(key);
        if (expiry && expiry > Date.now()) {
            return this.metricsCache.get(key);
        }
        
        // Clean expired cache
        this.metricsCache.delete(key);
        this.cacheExpiry.delete(key);
        return null;
    }

    setCache(key, value, ttlSeconds) {
        this.metricsCache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + (ttlSeconds * 1000));
    }
}

module.exports = new StatsController();