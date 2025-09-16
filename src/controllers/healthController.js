// ==========================================
// HEALTH CONTROLLER
// Handles system health checks and monitoring
// ==========================================

const AppLogger = require('../utils/logger');
const { formatBytes, formatDuration } = require('../utils/validators');
const { HTTP_STATUS } = require('../utils/constants');

class HealthController {
    constructor() {
        this.logger = new AppLogger('HealthController');
        this.startTime = Date.now();
        this.healthCheckCache = null;
        this.lastHealthCheck = null;
        this.cacheExpiry = 30000; // 30 seconds cache
    }

    /**
     * Basic health check endpoint
     */
    async getHealth(req, res) {
        try {
            const uptime = process.uptime();
            const memory = process.memoryUsage();
            
            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: Math.floor(uptime),
                uptimeFormatted: formatDuration(uptime * 1000),
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                memory: {
                    used: memory.heapUsed,
                    total: memory.heapTotal,
                    usedFormatted: formatBytes(memory.heapUsed),
                    totalFormatted: formatBytes(memory.heapTotal),
                    usage: Math.round((memory.heapUsed / memory.heapTotal) * 100)
                },
                process: {
                    pid: process.pid,
                    platform: process.platform,
                    arch: process.arch,
                    nodeVersion: process.version
                }
            };

            // Set appropriate HTTP status
            res.status(HTTP_STATUS.OK).json(health);

        } catch (error) {
            this.logger.error('❌ Health check failed:', error);
            
            res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: 'Health check failed',
                details: error.message
            });
        }
    }

    /**
     * Detailed health check with dependency checks
     */
    async getDetailedHealth(req, res) {
        try {
            // Check if we have a recent cached result
            if (this.healthCheckCache && 
                this.lastHealthCheck && 
                (Date.now() - this.lastHealthCheck) < this.cacheExpiry) {
                return res.json(this.healthCheckCache);
            }

            const startTime = Date.now();
            const healthChecks = {};

            // Check main application health
            healthChecks.application = await this.checkApplicationHealth();

            // Check database health
            healthChecks.database = await this.checkDatabaseHealth();

            // Check Firebase service health
            healthChecks.firebase = await this.checkFirebaseHealth();

            // Check queue service health
            healthChecks.queue = await this.checkQueueHealth();

            // Check WebSocket service health
            healthChecks.websocket = await this.checkWebSocketHealth();

            // Check Redis health (if available)
            healthChecks.redis = await this.checkRedisHealth();

            // Calculate overall health status
            const overallStatus = this.calculateOverallHealth(healthChecks);
            const checkDuration = Date.now() - startTime;

            const detailedHealth = {
                status: overallStatus,
                timestamp: new Date().toISOString(),
                checkDuration: checkDuration,
                checkDurationFormatted: formatDuration(checkDuration),
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                uptime: process.uptime(),
                uptimeFormatted: formatDuration(process.uptime() * 1000),
                dependencies: healthChecks,
                system: this.getSystemInfo()
            };

            // Cache the result
            this.healthCheckCache = detailedHealth;
            this.lastHealthCheck = Date.now();

            // Set HTTP status based on overall health
            const httpStatus = overallStatus === 'healthy' 
                ? HTTP_STATUS.OK 
                : HTTP_STATUS.SERVICE_UNAVAILABLE;

            res.status(httpStatus).json(detailedHealth);

        } catch (error) {
            this.logger.error('❌ Detailed health check failed:', error);
            
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                status: 'error',
                timestamp: new Date().toISOString(),
                error: 'Detailed health check failed',
                details: error.message
            });
        }
    }

    /**
     * Readiness probe (Kubernetes compatible)
     */
    async getReadiness(req, res) {
        try {
            const readinessChecks = {};

            // Check critical dependencies for readiness
            readinessChecks.database = await this.checkDatabaseHealth();
            readinessChecks.firebase = await this.checkFirebaseHealth();

            const isReady = Object.values(readinessChecks).every(
                check => check.status === 'healthy' || check.status === 'degraded'
            );

            const readiness = {
                ready: isReady,
                timestamp: new Date().toISOString(),
                checks: readinessChecks
            };

            const httpStatus = isReady ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;
            res.status(httpStatus).json(readiness);

        } catch (error) {
            this.logger.error('❌ Readiness check failed:', error);
            
            res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
                ready: false,
                timestamp: new Date().toISOString(),
                error: 'Readiness check failed',
                details: error.message
            });
        }
    }

    /**
     * Liveness probe (Kubernetes compatible)
     */
    async getLiveness(req, res) {
        try {
            // Simple liveness check - just verify the process is responsive
            const liveness = {
                alive: true,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage().heapUsed,
                pid: process.pid
            };

            res.status(HTTP_STATUS.OK).json(liveness);

        } catch (error) {
            this.logger.error('❌ Liveness check failed:', error);
            
            res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
                alive: false,
                timestamp: new Date().toISOString(),
                error: 'Liveness check failed'
            });
        }
    }

    // ==========================================
    // PRIVATE HEALTH CHECK METHODS
    // ==========================================

    /**
     * Check application health
     */
    async checkApplicationHealth() {
        try {
            const memory = process.memoryUsage();
            const uptime = process.uptime();

            // Consider unhealthy if memory usage is extremely high or uptime is too low
            const memoryUsagePercent = (memory.heapUsed / memory.heapTotal) * 100;
            const isMemoryHigh = memoryUsagePercent > 90;
            const isUptimeLow = uptime < 10; // Less than 10 seconds

            let status = 'healthy';
            let issues = [];

            if (isMemoryHigh) {
                status = 'degraded';
                issues.push('High memory usage');
            }

            if (isUptimeLow) {
                status = 'starting';
                issues.push('Recently started');
            }

            return {
                status,
                responseTime: 0, // This check is instant
                details: {
                    uptime: Math.floor(uptime),
                    memory: {
                        used: memory.heapUsed,
                        total: memory.heapTotal,
                        usagePercent: Math.round(memoryUsagePercent)
                    },
                    issues: issues.length > 0 ? issues : null
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check database health
     */
    async checkDatabaseHealth() {
        const startTime = Date.now();
        
        try {
            const { db } = require('../models');
            
            if (!db || !db.initialized) {
                return {
                    status: 'unhealthy',
                    error: 'Database not initialized',
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            // Test database connection with a simple query
            const connection = db.getConnection();
            const result = connection.prepare('SELECT 1 as test, datetime("now") as timestamp').get();

            const responseTime = Date.now() - startTime;

            return {
                status: 'healthy',
                responseTime,
                details: {
                    connected: true,
                    testQuery: result,
                    database: 'sqlite',
                    path: db.dbPath
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check Firebase service health
     */
    async checkFirebaseHealth() {
        const startTime = Date.now();
        
        try {
            const { getFirebaseService } = require('../app');
            const firebaseService = getFirebaseService();

            if (!firebaseService) {
                return {
                    status: 'degraded',
                    error: 'Firebase service not available',
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            const healthStatus = await firebaseService.getHealthStatus();
            const responseTime = Date.now() - startTime;

            return {
                status: healthStatus.status === 'healthy' ? 'healthy' : 'degraded',
                responseTime,
                details: healthStatus,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check queue service health
     */
    async checkQueueHealth() {
        const startTime = Date.now();
        
        try {
            const { getQueueService } = require('../app');
            const queueService = getQueueService();

            if (!queueService) {
                return {
                    status: 'degraded',
                    error: 'Queue service not available',
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            const healthStatus = await queueService.getHealthStatus();
            const responseTime = Date.now() - startTime;

            return {
                status: healthStatus.status === 'healthy' ? 'healthy' : 'degraded',
                responseTime,
                details: healthStatus,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check WebSocket service health
     */
    async checkWebSocketHealth() {
        const startTime = Date.now();
        
        try {
            const { getWebSocketService } = require('../app');
            const websocketService = getWebSocketService();

            if (!websocketService) {
                return {
                    status: 'degraded',
                    error: 'WebSocket service not available',
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            const healthStatus = await websocketService.getHealthStatus();
            const responseTime = Date.now() - startTime;

            return {
                status: healthStatus.status === 'healthy' ? 'healthy' : 'degraded',
                responseTime,
                details: healthStatus,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'degraded', // WebSocket is not critical for basic functionality
                error: error.message,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check Redis health
     */
    async checkRedisHealth() {
        const startTime = Date.now();
        
        try {
            const { getQueueService } = require('../app');
            const queueService = getQueueService();

            if (!queueService || !queueService.redis) {
                return {
                    status: 'not_configured',
                    message: 'Redis not configured',
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            // Test Redis connection
            const pingResult = await queueService.redis.ping();
            const responseTime = Date.now() - startTime;

            return {
                status: pingResult === 'PONG' ? 'healthy' : 'unhealthy',
                responseTime,
                details: {
                    ping: pingResult,
                    status: queueService.redis.status
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Calculate overall health status from individual checks
     */
    calculateOverallHealth(healthChecks) {
        const statuses = Object.values(healthChecks).map(check => check.status);
        
        // If any critical service is unhealthy, overall status is unhealthy
        const criticalServices = ['application', 'database'];
        const criticalStatuses = criticalServices.map(service => healthChecks[service]?.status);
        
        if (criticalStatuses.includes('unhealthy')) {
            return 'unhealthy';
        }

        // If any service is degraded, overall status is degraded
        if (statuses.includes('degraded') || statuses.includes('unhealthy')) {
            return 'degraded';
        }

        // If we're starting up
        if (statuses.includes('starting')) {
            return 'starting';
        }

        return 'healthy';
    }

    /**
     * Get system information
     */
    getSystemInfo() {
        const memory = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            platform: {
                os: process.platform,
                arch: process.arch,
                node: process.version,
                pid: process.pid
            },
            memory: {
                rss: memory.rss,
                heapUsed: memory.heapUsed,
                heapTotal: memory.heapTotal,
                external: memory.external,
                arrayBuffers: memory.arrayBuffers,
                formatted: {
                    rss: formatBytes(memory.rss),
                    heapUsed: formatBytes(memory.heapUsed),
                    heapTotal: formatBytes(memory.heapTotal),
                    external: formatBytes(memory.external)
                }
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            uptime: {
                process: process.uptime(),
                system: require('os').uptime(),
                formatted: {
                    process: formatDuration(process.uptime() * 1000),
                    system: formatDuration(require('os').uptime() * 1000)
                }
            }
        };
    }

    /**
     * Clear health check cache (useful for testing)
     */
    clearCache() {
        this.healthCheckCache = null;
        this.lastHealthCheck = null;
        this.logger.debug('🧹 Health check cache cleared');
    }

    /**
     * Get health check statistics
     */
    getHealthStats() {
        return {
            cacheEnabled: !!this.healthCheckCache,
            lastCheck: this.lastHealthCheck ? new Date(this.lastHealthCheck).toISOString() : null,
            cacheAge: this.lastHealthCheck ? Date.now() - this.lastHealthCheck : null,
            serviceUptime: Date.now() - this.startTime,
            totalChecks: this.totalChecks || 0
        };
    }
}

module.exports = new HealthController();