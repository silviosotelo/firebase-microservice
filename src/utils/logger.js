// ==========================================
// APPLICATION LOGGER
// Winston-based logging with multiple transports
// ==========================================

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

class AppLogger {
    constructor(module = 'App') {
        this.module = module;
        this.logger = this.createLogger();
        this.initializeWebSocketService();
    }

    /**
     * Create Winston logger instance
     */
    createLogger() {
        const logLevel = process.env.LOG_LEVEL || 'info';
        const environment = process.env.NODE_ENV || 'development';
        const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

        // Ensure log directory exists
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Define log format
        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss.SSS'
            }),
            winston.format.errors({ stack: true }),
            winston.format.printf((info) => {
                const { timestamp, level, message, stack, ...metadata } = info;
                const module = metadata.module || this.module;
                
                // Base log message
                let logMessage = `${timestamp} [${level.toUpperCase().padEnd(5)}] [${module}] ${message}`;
                
                // Add metadata if present (excluding module)
                const cleanMetadata = { ...metadata };
                delete cleanMetadata.module;
                
                if (Object.keys(cleanMetadata).length > 0) {
                    const metaString = JSON.stringify(cleanMetadata, null, 0);
                    if (metaString !== '{}') {
                        logMessage += ` ${metaString}`;
                    }
                }
                
                // Add stack trace for errors
                if (stack) {
                    logMessage += `\n${stack}`;
                }
                
                return logMessage;
            })
        );

        // Console format for development
        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({
                format: 'HH:mm:ss.SSS'
            }),
            winston.format.printf((info) => {
                const { timestamp, level, message, ...metadata } = info;
                const module = metadata.module || this.module;
                const emoji = this.getLevelEmoji(info.level);
                
                let logMessage = `${timestamp} ${emoji} [${module}] ${message}`;
                
                // Add important metadata in development
                if (metadata && environment === 'development') {
                    const importantMeta = this.extractImportantMetadata(metadata);
                    if (importantMeta) {
                        logMessage += ` ${importantMeta}`;
                    }
                }
                
                return logMessage;
            })
        );

        // Create transports
        const transports = [];

        // Console transport
        if (process.env.CONSOLE_LOGGING !== 'false') {
            transports.push(new winston.transports.Console({
                level: logLevel,
                format: consoleFormat,
                handleExceptions: true,
                handleRejections: true
            }));
        }

        // File transports
        if (process.env.FILE_LOGGING !== 'false') {
            // General application logs
            transports.push(new DailyRotateFile({
                filename: path.join(logDir, 'app-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                level: logLevel,
                format: logFormat,
                maxSize: process.env.LOG_MAX_SIZE || '20m',
                maxFiles: process.env.LOG_MAX_FILES || '14d',
                createSymlink: true,
                symlinkName: 'app.log',
                handleExceptions: true,
                handleRejections: true
            }));

            // Error-only logs
            transports.push(new DailyRotateFile({
                filename: path.join(logDir, 'error-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                format: logFormat,
                maxSize: process.env.LOG_MAX_SIZE || '20m',
                maxFiles: process.env.LOG_MAX_FILES || '30d',
                createSymlink: true,
                symlinkName: 'error.log'
            }));

            // HTTP access logs (if enabled)
            if (process.env.HTTP_LOGGING === 'true') {
                transports.push(new DailyRotateFile({
                    filename: path.join(logDir, 'access-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    level: 'http',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json()
                    ),
                    maxSize: process.env.LOG_MAX_SIZE || '20m',
                    maxFiles: process.env.LOG_MAX_FILES || '7d',
                    createSymlink: true,
                    symlinkName: 'access.log'
                }));
            }
        }

        // Create the logger
        return winston.createLogger({
            level: logLevel,
            levels: {
                error: 0,
                warn: 1,
                info: 2,
                http: 3,
                debug: 4,
                verbose: 5
            },
            format: logFormat,
            transports,
            exitOnError: false,
            handleExceptions: true,
            handleRejections: true
        });
    }

    /**
     * Initialize WebSocket service for real-time logs
     */
    initializeWebSocketService() {
        this.websocketService = null;
        
        // Will be set later when WebSocket service is available
        setTimeout(() => {
            try {
                const { getWebSocketService } = require('../app');
                this.websocketService = getWebSocketService();
            } catch (error) {
                // WebSocket service not available yet
            }
        }, 1000);
    }

    /**
     * Get emoji for log level
     */
    getLevelEmoji(level) {
        const emojis = {
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️',
            http: '🌐',
            debug: '🐛',
            verbose: '📝'
        };
        return emojis[level] || 'ℹ️';
    }

    /**
     * Extract important metadata for console display
     */
    extractImportantMetadata(metadata) {
        const important = {};
        const importantKeys = [
            'requestId', 'userId', 'notificationId', 'ip', 'statusCode', 
            'responseTime', 'errorCode', 'method', 'path'
        ];

        for (const key of importantKeys) {
            if (metadata[key] !== undefined) {
                important[key] = metadata[key];
            }
        }

        if (Object.keys(important).length === 0) {
            return null;
        }

        return JSON.stringify(important);
    }

    /**
     * Broadcast log to WebSocket clients (admin only)
     */
    broadcastLog(level, message, metadata) {
        if (this.websocketService && process.env.ENABLE_LIVE_LOGS === 'true') {
            try {
                this.websocketService.broadcastLogMessage(level, message, {
                    module: this.module,
                    ...metadata
                });
            } catch (error) {
                // Ignore WebSocket errors to prevent logging loops
            }
        }
    }

    /**
     * Enhanced logging methods with metadata support
     */
    error(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString(),
            stack: metadata.stack || (new Error()).stack
        };
        
        this.logger.error(message, enrichedMetadata);
        this.broadcastLog('error', message, enrichedMetadata);
    }

    warn(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString()
        };
        
        this.logger.warn(message, enrichedMetadata);
        this.broadcastLog('warn', message, enrichedMetadata);
    }

    info(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString()
        };
        
        this.logger.info(message, enrichedMetadata);
        
        // Only broadcast important info messages
        if (this.isImportantInfo(message, metadata)) {
            this.broadcastLog('info', message, enrichedMetadata);
        }
    }

    http(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString()
        };
        
        this.logger.http(message, enrichedMetadata);
    }

    debug(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString()
        };
        
        this.logger.debug(message, enrichedMetadata);
    }

    verbose(message, metadata = {}) {
        const enrichedMetadata = { 
            module: this.module, 
            ...metadata,
            timestamp: new Date().toISOString()
        };
        
        this.logger.verbose(message, enrichedMetadata);
    }

    /**
     * Determine if info message is important enough to broadcast
     */
    isImportantInfo(message, metadata) {
        const importantPatterns = [
            /started|initialized|connected|disconnected/i,
            /notification.*sent|notification.*failed/i,
            /authentication|login|logout/i,
            /error|warning|critical/i
        ];

        const importantMetadataKeys = [
            'notificationId', 'userId', 'errorCode', 'statusCode'
        ];

        // Check message content
        if (importantPatterns.some(pattern => pattern.test(message))) {
            return true;
        }

        // Check metadata
        if (importantMetadataKeys.some(key => metadata[key] !== undefined)) {
            return true;
        }

        return false;
    }

    /**
     * Log performance metrics
     */
    performance(operation, duration, metadata = {}) {
        const perfMetadata = {
            module: this.module,
            operation,
            duration,
            durationMs: typeof duration === 'number' ? duration : parseFloat(duration),
            ...metadata,
            timestamp: new Date().toISOString()
        };

        if (perfMetadata.durationMs > 1000) {
            this.warn(`Slow operation: ${operation} took ${duration}ms`, perfMetadata);
        } else {
            this.debug(`Performance: ${operation} took ${duration}ms`, perfMetadata);
        }
    }

    /**
     * Log security events
     */
    security(event, details = {}) {
        const securityMetadata = {
            module: this.module,
            securityEvent: event,
            ...details,
            timestamp: new Date().toISOString(),
            severity: details.severity || 'medium'
        };

        this.warn(`Security Event: ${event}`, securityMetadata);
        this.broadcastLog('warn', `Security Event: ${event}`, securityMetadata);
    }

    /**
     * Log structured events for analytics
     */
    event(eventName, eventData = {}) {
        const eventMetadata = {
            module: this.module,
            eventName,
            eventData,
            timestamp: new Date().toISOString(),
            eventId: this.generateEventId()
        };

        this.info(`Event: ${eventName}`, eventMetadata);
    }

    /**
     * Log API calls with consistent format
     */
    apiCall(method, endpoint, statusCode, responseTime, metadata = {}) {
        const apiMetadata = {
            module: this.module,
            method,
            endpoint,
            statusCode,
            responseTime,
            ...metadata,
            timestamp: new Date().toISOString()
        };

        const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
        const message = `${method} ${endpoint} ${statusCode} ${responseTime}ms`;

        this[level](message, apiMetadata);
    }

    /**
     * Log database operations
     */
    database(operation, table, duration, metadata = {}) {
        const dbMetadata = {
            module: this.module,
            operation,
            table,
            duration,
            ...metadata,
            timestamp: new Date().toISOString()
        };

        if (duration > 1000) {
            this.warn(`Slow DB operation: ${operation} on ${table} took ${duration}ms`, dbMetadata);
        } else {
            this.debug(`DB: ${operation} on ${table} (${duration}ms)`, dbMetadata);
        }
    }

    /**
     * Log notification lifecycle events
     */
    notification(notificationId, event, details = {}) {
        const notificationMetadata = {
            module: this.module,
            notificationId,
            event,
            ...details,
            timestamp: new Date().toISOString()
        };

        this.info(`Notification ${notificationId}: ${event}`, notificationMetadata);
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create child logger with additional context
     */
    child(additionalContext = {}) {
        const childLogger = Object.create(this);
        childLogger.defaultMetadata = { ...this.defaultMetadata, ...additionalContext };
        return childLogger;
    }

    /**
     * Set log level dynamically
     */
    setLevel(level) {
        this.logger.level = level;
        this.info(`Log level changed to: ${level}`, { previousLevel: this.logger.level });
    }

    /**
     * Get current log level
     */
    getLevel() {
        return this.logger.level;
    }

    /**
     * Flush all log transports
     */
    async flush() {
        return new Promise((resolve) => {
            const transports = this.logger.transports;
            let pending = transports.length;

            if (pending === 0) {
                return resolve();
            }

            transports.forEach(transport => {
                if (transport.close) {
                    transport.close(() => {
                        pending--;
                        if (pending === 0) resolve();
                    });
                } else {
                    pending--;
                    if (pending === 0) resolve();
                }
            });
        });
    }

    /**
     * Get logging statistics
     */
    getStats() {
        const transports = this.logger.transports;
        const stats = {
            level: this.logger.level,
            transports: transports.length,
            transportTypes: transports.map(t => t.constructor.name),
            module: this.module,
            timestamp: new Date().toISOString()
        };

        return stats;
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Test logging functionality
            this.debug('Logger health check');
            
            return {
                healthy: true,
                level: this.logger.level,
                transports: this.logger.transports.length,
                module: this.module,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Static method to create logger instances
     */
    static create(module) {
        return new AppLogger(module);
    }

    /**
     * Static method to configure global logging
     */
    static configure(config = {}) {
        // Set environment variables for global configuration
        if (config.level) process.env.LOG_LEVEL = config.level;
        if (config.logDir) process.env.LOG_DIR = config.logDir;
        if (config.maxSize) process.env.LOG_MAX_SIZE = config.maxSize;
        if (config.maxFiles) process.env.LOG_MAX_FILES = config.maxFiles;
        if (config.console !== undefined) process.env.CONSOLE_LOGGING = config.console.toString();
        if (config.file !== undefined) process.env.FILE_LOGGING = config.file.toString();
        if (config.http !== undefined) process.env.HTTP_LOGGING = config.http.toString();
        if (config.liveLogs !== undefined) process.env.ENABLE_LIVE_LOGS = config.liveLogs.toString();
    }
}

// Export both the class and a default instance
module.exports = AppLogger;