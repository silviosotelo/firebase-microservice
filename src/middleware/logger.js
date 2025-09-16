// ==========================================
// LOGGER MIDDLEWARE
// HTTP request logging and monitoring
// ==========================================

const AppLogger = require('../utils/logger');
const { generateUUID } = require('../utils/validators');

class LoggerMiddleware {
    constructor() {
        this.logger = new AppLogger('RequestLogger');
        this.requestCounter = 0;
        this.stats = {
            totalRequests: 0,
            activeRequests: 0,
            totalResponseTime: 0,
            errorCount: 0,
            statusCodes: {}
        };
    }

    /**
     * Request logger middleware
     */
    requestLogger = (req, res, next) => {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || this.generateRequestId();
        
        // Attach request ID to request
        req.requestId = requestId;
        res.setHeader('X-Request-ID', requestId);
        
        // Update stats
        this.stats.totalRequests++;
        this.stats.activeRequests++;
        this.requestCounter++;

        // Log request start
        this.logRequest(req, startTime);

        // Override res.json to capture response data
        const originalJson = res.json;
        let responseData = null;
        
        res.json = function(body) {
            responseData = body;
            return originalJson.call(this, body);
        };

        // Log response when finished
        res.on('finish', () => {
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            // Update stats
            this.stats.activeRequests--;
            this.stats.totalResponseTime += responseTime;
            this.updateStatusCodeStats(res.statusCode);
            
            if (res.statusCode >= 400) {
                this.stats.errorCount++;
            }

            this.logResponse(req, res, responseTime, responseData);
        });

        // Log response on close (for cases where response is not properly finished)
        res.on('close', () => {
            if (this.stats.activeRequests > 0) {
                this.stats.activeRequests--;
            }
        });

        next();
    };

    /**
     * Enhanced request logger with additional context
     */
    enhancedRequestLogger = (req, res, next) => {
        const startTime = process.hrtime.bigint();
        const requestId = req.headers['x-request-id'] || this.generateRequestId();
        
        // Attach enhanced context
        req.requestId = requestId;
        req.startTime = startTime;
        res.setHeader('X-Request-ID', requestId);

        // Capture request details
        const requestContext = {
            requestId,
            method: req.method,
            url: req.url,
            path: req.path,
            query: req.query,
            headers: this.sanitizeHeaders(req.headers),
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent'),
            contentLength: req.get('Content-Length'),
            contentType: req.get('Content-Type'),
            timestamp: new Date().toISOString()
        };

        // Add user context if available
        if (req.user) {
            requestContext.userId = req.user.id;
            requestContext.userRole = req.user.role;
        }

        // Add auth context if available
        if (req.auth) {
            requestContext.authType = req.auth.type;
            requestContext.authRole = req.auth.role;
        }

        // Store context for response logging
        req.logContext = requestContext;

        // Log request
        this.logger.info('📥 Request started', requestContext);

        // Update stats
        this.updateRequestStats(req);

        // Setup response logging
        this.setupResponseLogging(req, res, startTime);

        next();
    };

    /**
     * API-specific logger
     */
    apiLogger = (req, res, next) => {
        const startTime = Date.now();
        
        // Skip logging for health checks and metrics
        if (this.shouldSkipLogging(req)) {
            return next();
        }

        const context = {
            method: req.method,
            endpoint: req.path,
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent'),
            apiKey: req.headers['x-api-key'] ? this.maskApiKey(req.headers['x-api-key']) : null,
            contentType: req.get('Content-Type'),
            timestamp: new Date().toISOString()
        };

        this.logger.info('🔑 API Request', context);

        res.on('finish', () => {
            const responseTime = Date.now() - startTime;
            
            this.logger.info('🔑 API Response', {
                ...context,
                statusCode: res.statusCode,
                responseTime: `${responseTime}ms`,
                success: res.statusCode < 400
            });
        });

        next();
    };

    /**
     * Admin logger
     */
    adminLogger = (req, res, next) => {
        const context = {
            admin: req.user?.username || 'unknown',
            action: `${req.method} ${req.path}`,
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        };

        this.logger.info('👤 Admin Action', context);

        res.on('finish', () => {
            this.logger.info('👤 Admin Action Complete', {
                ...context,
                statusCode: res.statusCode,
                success: res.statusCode < 400
            });
        });

        next();
    };

    /**
     * Error logger
     */
    errorLogger = (error, req, res, next) => {
        const errorContext = {
            error: {
                message: error.message,
                name: error.name,
                code: error.code,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            request: {
                requestId: req.requestId,
                method: req.method,
                url: req.url,
                ip: this.getClientIP(req),
                userAgent: req.get('User-Agent'),
                userId: req.user?.id,
                timestamp: new Date().toISOString()
            }
        };

        this.logger.error('❌ Request Error', errorContext);
        next(error);
    };

    /**
     * Security logger
     */
    securityLogger = (event, req, details = {}) => {
        const securityContext = {
            event,
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent'),
            url: req.url,
            method: req.method,
            userId: req.user?.id,
            timestamp: new Date().toISOString(),
            ...details
        };

        this.logger.warn('🔒 Security Event', securityContext);
    };

    /**
     * Performance logger
     */
    performanceLogger = (req, res, next) => {
        const startTime = process.hrtime.bigint();
        
        res.on('finish', () => {
            const endTime = process.hrtime.bigint();
            const responseTime = Number(endTime - startTime) / 1000000; // Convert to ms

            // Log slow requests
            if (responseTime > 1000) { // Slower than 1 second
                this.logger.warn('🐌 Slow Request', {
                    method: req.method,
                    url: req.url,
                    responseTime: `${responseTime.toFixed(2)}ms`,
                    statusCode: res.statusCode,
                    ip: this.getClientIP(req),
                    timestamp: new Date().toISOString()
                });
            }

            // Log performance metrics
            if (process.env.LOG_PERFORMANCE === 'true') {
                this.logger.debug('⚡ Performance', {
                    method: req.method,
                    url: req.url,
                    responseTime: `${responseTime.toFixed(2)}ms`,
                    statusCode: res.statusCode,
                    memoryUsage: process.memoryUsage().heapUsed,
                    timestamp: new Date().toISOString()
                });
            }
        });

        next();
    };

    /**
     * Log request details
     */
    logRequest(req, startTime) {
        // Skip logging for certain paths
        if (this.shouldSkipLogging(req)) {
            return;
        }

        const logData = {
            requestId: req.requestId,
            method: req.method,
            url: req.url,
            ip: this.getClientIP(req),
            userAgent: req.get('User-Agent'),
            timestamp: new Date(startTime).toISOString()
        };

        // Add body for non-GET requests (sanitized)
        if (req.method !== 'GET' && req.body) {
            logData.body = this.sanitizeRequestBody(req.body);
        }

        this.logger.info('📥 Request', logData);
    }

    /**
     * Log response details
     */
    logResponse(req, res, responseTime, responseData) {
        if (this.shouldSkipLogging(req)) {
            return;
        }

        const logData = {
            requestId: req.requestId,
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            contentLength: res.get('Content-Length'),
            timestamp: new Date().toISOString()
        };

        // Add response data for errors or debug mode
        if (res.statusCode >= 400 || process.env.LOG_RESPONSE_BODY === 'true') {
            logData.response = this.sanitizeResponseBody(responseData);
        }

        const logLevel = res.statusCode >= 400 ? 'error' : 'info';
        const emoji = res.statusCode >= 400 ? '❌' : '✅';
        
        this.logger[logLevel](`${emoji} Response`, logData);
    }

    /**
     * Setup response logging
     */
    setupResponseLogging(req, res, startTime) {
        const originalSend = res.send;
        const originalJson = res.json;
        
        let responseBody = null;

        // Override send method
        res.send = function(body) {
            responseBody = body;
            return originalSend.call(this, body);
        };

        // Override json method
        res.json = function(body) {
            responseBody = body;
            return originalJson.call(this, body);
        };

        // Log when response finishes
        res.on('finish', () => {
            const endTime = process.hrtime.bigint();
            const responseTime = Number(endTime - startTime) / 1000000; // Convert to ms

            const responseContext = {
                ...req.logContext,
                statusCode: res.statusCode,
                responseTime: Math.round(responseTime * 100) / 100, // Round to 2 decimal places
                contentLength: res.get('Content-Length'),
                success: res.statusCode < 400
            };

            // Add response body for errors or debug
            if (res.statusCode >= 400 && responseBody) {
                responseContext.response = this.sanitizeResponseBody(responseBody);
            }

            const logLevel = res.statusCode >= 400 ? 'error' : 'info';
            const emoji = res.statusCode >= 400 ? '❌' : '✅';
            
            this.logger[logLevel](`${emoji} Response completed`, responseContext);
        });
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get client IP address
     */
    getClientIP(req) {
        return req.ip || 
               req.connection?.remoteAddress || 
               req.socket?.remoteAddress ||
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               'unknown';
    }

    /**
     * Sanitize request headers
     */
    sanitizeHeaders(headers) {
        const sanitized = { ...headers };
        
        // Remove sensitive headers
        const sensitiveHeaders = [
            'authorization',
            'x-api-key',
            'cookie',
            'set-cookie',
            'x-auth-token'
        ];

        sensitiveHeaders.forEach(header => {
            if (sanitized[header]) {
                sanitized[header] = this.maskSensitiveData(sanitized[header]);
            }
        });

        return sanitized;
    }

    /**
     * Sanitize request body
     */
    sanitizeRequestBody(body) {
        if (!body || typeof body !== 'object') {
            return body;
        }

        const sanitized = JSON.parse(JSON.stringify(body));
        
        // Remove sensitive fields
        const sensitiveFields = [
            'password',
            'token',
            'secret',
            'key',
            'credentials',
            'private_key'
        ];

        this.recursiveSanitize(sanitized, sensitiveFields);
        
        return sanitized;
    }

    /**
     * Sanitize response body
     */
    sanitizeResponseBody(body) {
        if (!body) return body;
        
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body;
            return this.sanitizeRequestBody(parsed);
        } catch {
            return '[Response body not JSON]';
        }
    }

    /**
     * Recursively sanitize object
     */
    recursiveSanitize(obj, sensitiveFields) {
        if (!obj || typeof obj !== 'object') return;

        Object.keys(obj).forEach(key => {
            const lowerKey = key.toLowerCase();
            
            if (sensitiveFields.some(field => lowerKey.includes(field))) {
                obj[key] = this.maskSensitiveData(obj[key]);
            } else if (typeof obj[key] === 'object') {
                this.recursiveSanitize(obj[key], sensitiveFields);
            }
        });
    }

    /**
     * Mask sensitive data
     */
    maskSensitiveData(data) {
        if (!data) return data;
        
        const str = String(data);
        if (str.length <= 8) {
            return '***';
        }
        
        return str.substring(0, 4) + '***' + str.substring(str.length - 4);
    }

    /**
     * Mask API key
     */
    maskApiKey(apiKey) {
        if (!apiKey || apiKey.length < 8) {
            return '***';
        }
        return apiKey.substring(0, 8) + '...';
    }

    /**
     * Check if logging should be skipped
     */
    shouldSkipLogging(req) {
        const skipPaths = [
            '/health',
            '/metrics',
            '/favicon.ico'
        ];

        return skipPaths.some(path => req.path.startsWith(path));
    }

    /**
     * Update request statistics
     */
    updateRequestStats(req) {
        this.stats.totalRequests++;
        this.stats.activeRequests++;
    }

    /**
     * Update status code statistics
     */
    updateStatusCodeStats(statusCode) {
        const codeRange = Math.floor(statusCode / 100) * 100;
        this.stats.statusCodes[codeRange] = (this.stats.statusCodes[codeRange] || 0) + 1;
    }

    /**
     * Get logging statistics
     */
    getStats() {
        return {
            ...this.stats,
            averageResponseTime: this.stats.totalRequests > 0 
                ? Math.round(this.stats.totalResponseTime / this.stats.totalRequests)
                : 0,
            errorRate: this.stats.totalRequests > 0
                ? Math.round((this.stats.errorCount / this.stats.totalRequests) * 100)
                : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            activeRequests: 0,
            totalResponseTime: 0,
            errorCount: 0,
            statusCodes: {}
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: true,
            stats: this.getStats(),
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const loggerMiddleware = new LoggerMiddleware();

module.exports = {
    requestLogger: loggerMiddleware.requestLogger,
    enhancedRequestLogger: loggerMiddleware.enhancedRequestLogger,
    apiLogger: loggerMiddleware.apiLogger,
    adminLogger: loggerMiddleware.adminLogger,
    errorLogger: loggerMiddleware.errorLogger,
    securityLogger: loggerMiddleware.securityLogger,
    performanceLogger: loggerMiddleware.performanceLogger,
    getStats: loggerMiddleware.getStats.bind(loggerMiddleware),
    resetStats: loggerMiddleware.resetStats.bind(loggerMiddleware),
    healthCheck: loggerMiddleware.healthCheck.bind(loggerMiddleware),
    loggerMiddleware
};