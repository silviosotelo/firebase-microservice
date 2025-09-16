// ==========================================
// ERROR HANDLER MIDDLEWARE - VERSIÓN MEJORADA
// Manejo robusto de errores que no para el servicio
// ==========================================

const AppLogger = require('../utils/logger');

const logger = new AppLogger('ErrorHandler');

/**
 * Middleware global de manejo de errores
 */
const globalErrorHandler = (error, req, res, next) => {
    try {
        // Log del error
        logger.error('❌ Global error caught:', {
            error: error.message,
            stack: error.stack,
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // Si la respuesta ya fue enviada, delegar al error handler por defecto de Express
        if (res.headersSent) {
            return next(error);
        }

        // Determinar el código de estado
        let statusCode = 500;
        let errorType = 'INTERNAL_SERVER_ERROR';
        let userMessage = 'An internal server error occurred';

        // Manejar tipos específicos de errores
        if (error.name === 'ValidationError') {
            statusCode = 400;
            errorType = 'VALIDATION_ERROR';
            userMessage = 'Validation failed';
        } else if (error.name === 'UnauthorizedError') {
            statusCode = 401;
            errorType = 'UNAUTHORIZED';
            userMessage = 'Authentication required';
        } else if (error.name === 'ForbiddenError') {
            statusCode = 403;
            errorType = 'FORBIDDEN';
            userMessage = 'Access denied';
        } else if (error.name === 'NotFoundError') {
            statusCode = 404;
            errorType = 'NOT_FOUND';
            userMessage = 'Resource not found';
        } else if (error.code === 'ECONNREFUSED') {
            statusCode = 503;
            errorType = 'SERVICE_UNAVAILABLE';
            userMessage = 'External service unavailable';
        } else if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
            statusCode = 503;
            errorType = 'DATABASE_BUSY';
            userMessage = 'Database temporarily unavailable';
        }

        // Preparar respuesta de error
        const errorResponse = {
            success: false,
            error: userMessage,
            type: errorType,
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || `req_${Date.now()}`
        };

        // En desarrollo, incluir más detalles
        if (process.env.NODE_ENV === 'development') {
            errorResponse.details = {
                message: error.message,
                name: error.name,
                code: error.code,
                stack: error.stack?.split('\n').slice(0, 5) // Solo las primeras 5 líneas del stack
            };
        }

        // Enviar respuesta
        res.status(statusCode).json(errorResponse);

        // No relanzar el error para evitar que el proceso se cierre
        
    } catch (handlerError) {
        // Si hay un error en el error handler, usar respuesta mínima
        logger.error('❌ Error in error handler:', handlerError);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Critical server error',
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
 * Wrapper para async route handlers
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
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
 * Crear error personalizado
 */
class AppError extends Error {
    constructor(message, statusCode = 500, type = 'APP_ERROR') {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.type = type;
        this.timestamp = new Date().toISOString();
        
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Crear error de validación
 */
class ValidationError extends AppError {
    constructor(message, details = []) {
        super(message, 400, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
        this.details = details;
    }
}

/**
 * Crear error de autorización
 */
class UnauthorizedError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'UNAUTHORIZED');
        this.name = 'UnauthorizedError';
    }
}

/**
 * Crear error de permisos
 */
class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'FORBIDDEN');
        this.name = 'ForbiddenError';
    }
}

/**
 * Crear error de recurso no encontrado
 */
class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

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
    
    // Clases de error
    AppError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    
    // Utilities
    errorHandlerHealthCheck
};