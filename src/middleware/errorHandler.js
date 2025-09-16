// ==========================================
// ERROR HANDLER MIDDLEWARE - OPTIMIZED VERSION
// Robust error handling with better categorization
// ==========================================

const AppLogger = require('../utils/logger');

const logger = new AppLogger('ErrorHandler');

/**
 * Custom error classes for better error handling
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, details = []) {
        super(message, 400, 'VALIDATION_ERROR');
        this.details = details;
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, 'NOT_FOUND');
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'FORBIDDEN');
    }
}

class ServiceUnavailableError extends AppError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, 503, 'SERVICE_UNAVAILABLE');
    }
}

/**
 * Middleware global de manejo de errores
 */
const globalErrorHandler = (error, req, res, next) => {
    try {
        // Enhanced error logging
        const errorContext = {
            error: error.message,
            name: error.name,
            code: error.code,
            statusCode: error.statusCode,
            isOperational: error.isOperational,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            request: {
                url: req.originalUrl,
                method: req.method,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                requestId: req.headers['x-request-id']
            },
            timestamp: new Date().toISOString()
        };

        // Log based on error type
        if (error.isOperational === false || error.statusCode >= 500) {
            logger.error('❌ Critical error caught:', errorContext);
        } else {
            logger.warn('⚠️ Operational error caught:', errorContext);
        }

        // If response already sent, delegate to Express default handler
        if (res.headersSent) {
            return next(error);
        }

        // Determine response details
        const statusCode = error.statusCode || 500;
        const errorCode = error.code || 'INTERNAL_ERROR';
        let userMessage = error.message;

        // Sanitize error message for production
        if (process.env.NODE_ENV === 'production' && statusCode >= 500) {
            userMessage = 'An internal server error occurred';
        }

        // Prepare error response
        const errorResponse = {
            success: false,
            error: userMessage,
            code: errorCode,
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || `req_${Date.now()}`
        };

        // Add details for validation errors
        if (error instanceof ValidationError && error.details) {
            errorResponse.details = error.details;
        }

        // Add development details
        if (process.env.NODE_ENV === 'development') {
            errorResponse.debug = {
                originalMessage: error.message,
                name: error.name,
                code: error.code,
                stack: error.stack?.split('\n').slice(0, 5)
            };
        }

        // Send response
        res.status(statusCode).json(errorResponse);

    } catch (handlerError) {
        // Fallback error handling
        logger.error('❌ Error in error handler:', handlerError);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Critical server error',
                code: 'HANDLER_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }
};

/**
 * Middleware para manejar rutas no encontradas (404)
 */
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
    error.name = 'NotFoundError';
    error.statusCode = 404;
    
    logger.warn(`🔍 Route not found: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        suggestion: 'Check the API documentation for available endpoints'
    });
};

/**
 * Enhanced async handler with better error context
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            // Add request context to error
            if (!error.requestContext) {
                error.requestContext = {
                    method: req.method,
                    url: req.originalUrl,
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                };
            }
            next(error);
        });
    };
};

/**
 * Middleware para validar JSON
 */
const validateJson = (error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        logger.warn('❌ Invalid JSON received:', error.message);
        
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON in request body',
            type: 'JSON_PARSE_ERROR',
            message: 'Please check your JSON syntax',
            timestamp: new Date().toISOString()
        });
    }
    
    next(error);
};

/**
 * Middleware para timeout de requests
 */
const requestTimeout = (timeout = 30000) => {
    return (req, res, next) => {
        // Set timeout
        const timer = setTimeout(() => {
            if (!res.headersSent) {
                logger.warn(`⏰ Request timeout: ${req.method} ${req.originalUrl}`);
                
                res.status(408).json({
                    success: false,
                    error: 'Request timeout',
                    type: 'REQUEST_TIMEOUT',
                    timeout: timeout,
                    timestamp: new Date().toISOString()
                });
            }
        }, timeout);

        // Clear timeout when response finishes
        res.on('finish', () => {
            clearTimeout(timer);
        });

        next();
    };
};

/**
 * Middleware para sanitizar errores de base de datos
 */
const sanitizeDatabaseError = (error, req, res, next) => {
    if (error.code && error.code.startsWith('SQLITE_')) {
        logger.error('❌ Database error:', error);
        
        const sanitizedError = new Error('Database operation failed');
        sanitizedError.name = 'DatabaseError';
        sanitizedError.statusCode = 503;
        
        return next(sanitizedError);
    }
    
    next(error);
};

/**
 * Create standardized error responses
 */
const createErrorResponse = (message, code = 'INTERNAL_ERROR', statusCode = 500, details = null) => {
    return {
        success: false,
        error: message,
        code,
        details,
        timestamp: new Date().toISOString()
    };
};

/**
 * Error factory functions
 */
const createValidationError = (message, details = []) => {
    return new ValidationError(message, details);
};

const createNotFoundError = (resource = 'Resource') => {
    return new NotFoundError(`${resource} not found`);
};

const createUnauthorizedError = (message = 'Authentication required') => {
    return new UnauthorizedError(message);
};

const createServiceError = (service, message = 'Service unavailable') => {
    return new ServiceUnavailableError(`${service}: ${message}`);
};

/**
 * Middleware para logging de errores críticos
 */
const logCriticalError = (error, req, res, next) => {
    // Errores que requieren atención inmediata
    const criticalErrors = [
        'DATABASE_CONNECTION_FAILED',
        'REDIS_CONNECTION_FAILED',
        'OUT_OF_MEMORY',
        'ENOSPC' // No space left on device
    ];

    if (criticalErrors.some(critical => 
        error.message.includes(critical) || 
        error.code === critical ||
        error.type === critical
    )) {
        logger.error('🚨 CRITICAL ERROR detected:', {
            error: error.message,
            type: error.type || error.code,
            stack: error.stack,
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });

        // Aquí podrías enviar alertas a sistemas de monitoreo
        // sendAlertToMonitoring(error);
    }

    next(error);
};

/**
 * Health check para el error handler
 */
const errorHandlerHealthCheck = () => {
    return {
        healthy: true,
        handlers: {
            global: 'active',
            notFound: 'active',
            validation: 'active',
            timeout: 'active'
        },
        timestamp: new Date().toISOString()
    };
};

// Exportar todas las funciones
module.exports = {
    // Handlers principales
    globalErrorHandler,
    notFoundHandler,
    
    // Middlewares utilitarios
    asyncHandler,
    validateJson,
    requestTimeout,
    sanitizeDatabaseError,
    logCriticalError,
    
    // Error classes
    AppError,
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    ServiceUnavailableError,
    
    // Error factory functions
    createErrorResponse,
    createValidationError,
    createNotFoundError,
    createUnauthorizedError,
    createServiceError,
    
    // Utilities
    errorHandlerHealthCheck
};