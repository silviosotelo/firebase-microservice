// ==========================================
// ERROR HANDLER MIDDLEWARE
// Global error handling and response formatting
// ==========================================

const AppLogger = require('../utils/logger');
const { 
    HTTP_STATUS, 
    ERROR_TYPES,
    FIREBASE_ERROR_CODES 
} = require('../utils/constants');

class ErrorHandler {
    constructor() {
        this.logger = new AppLogger('ErrorHandler');
    }

    /**
     * Global error handler middleware
     */
    globalErrorHandler = (error, req, res, next) => {
        try {
            // Log the error
            this.logError(error, req);

            // Determine error type and status
            const errorInfo = this.parseError(error);

            // Send error response
            res.status(errorInfo.status).json({
                success: false,
                error: errorInfo.message,
                code: errorInfo.code,
                details: errorInfo.details,
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'],
                path: req.path,
                method: req.method
            });

        } catch (handlerError) {
            // Fallback error handling
            this.logger.error('❌ Error in error handler:', handlerError);
            
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: 'Internal server error',
                code: ERROR_TYPES.INTERNAL_ERROR,
                timestamp: new Date().toISOString()
            });
        }
    };

    /**
     * Async error wrapper
     */
    asyncHandler = (fn) => {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    };

    /**
     * 404 handler
     */
    notFoundHandler = (req, res, next) => {
        const error = new Error(`Route not found: ${req.method} ${req.path}`);
        error.statusCode = HTTP_STATUS.NOT_FOUND;
        error.code = ERROR_TYPES.NOT_FOUND_ERROR;
        next(error);
    };

    /**
     * Validation error handler
     */
    validationErrorHandler = (error, req, res, next) => {
        if (error.name === 'ValidationError' || error.isJoi) {
            const validationError = this.formatValidationError(error);
            
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: 'Validation failed',
                code: ERROR_TYPES.VALIDATION_ERROR,
                details: validationError.details,
                timestamp: new Date().toISOString()
            });
        }
        
        next(error);
    };

    /**
     * Authentication error handler
     */
    authErrorHandler = (error, req, res, next) => {
        if (error.name === 'UnauthorizedError' || error.code === 'CREDENTIALS_REQUIRED') {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: 'Authentication required',
                code: ERROR_TYPES.AUTHENTICATION_ERROR,
                timestamp: new Date().toISOString()
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: 'Invalid token',
                code: ERROR_TYPES.AUTHENTICATION_ERROR,
                timestamp: new Date().toISOString()
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: 'Token expired',
                code: ERROR_TYPES.AUTHENTICATION_ERROR,
                timestamp: new Date().toISOString()
            });
        }

        next(error);
    };

    /**
     * Rate limit error handler
     */
    rateLimitErrorHandler = (error, req, res, next) => {
        if (error.name === 'TooManyRequestsError' || error.type === 'rate-limit') {
            return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
                success: false,
                error: 'Rate limit exceeded',
                code: ERROR_TYPES.RATE_LIMIT_ERROR,
                retryAfter: error.retryAfter,
                limit: error.limit,
                remaining: error.remaining,
                timestamp: new Date().toISOString()
            });
        }

        next(error);
    };

    /**
     * Database error handler
     */
    databaseErrorHandler = (error, req, res, next) => {
        if (error.name === 'DatabaseError' || error.code === 'SQLITE_ERROR') {
            this.logger.error('Database error:', error);
            
            return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: 'Database operation failed',
                code: ERROR_TYPES.DATABASE_ERROR,
                timestamp: new Date().toISOString()
            });
        }

        next(error);
    };

    /**
     * Firebase error handler
     */
    firebaseErrorHandler = (error, req, res, next) => {
        if (error.errorInfo && error.errorInfo.code) {
            const firebaseError = this.parseFirebaseError(error);
            
            return res.status(firebaseError.status).json({
                success: false,
                error: firebaseError.message,
                code: ERROR_TYPES.FIREBASE_ERROR,
                firebaseCode: firebaseError.firebaseCode,
                details: firebaseError.details,
                timestamp: new Date().toISOString()
            });
        }

        next(error);
    };

    /**
     * Network error handler
     */
    networkErrorHandler = (error, req, res, next) => {
        if (error.code === 'ECONNREFUSED' || 
            error.code === 'ENOTFOUND' || 
            error.code === 'ETIMEDOUT' ||
            error.name === 'NetworkError') {
            
            return res.status(HTTP_STATUS.BAD_GATEWAY).json({
                success: false,
                error: 'External service unavailable',
                code: ERROR_TYPES.NETWORK_ERROR,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                timestamp: new Date().toISOString()
            });
        }

        next(error);
    };

    /**
     * Parse error and determine response
     */
    parseError(error) {
        // Default error info
        let errorInfo = {
            status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
            code: ERROR_TYPES.INTERNAL_ERROR,
            details: undefined
        };

        // Check for custom status code
        if (error.statusCode || error.status) {
            errorInfo.status = error.statusCode || error.status;
        }

        // Check for custom error code
        if (error.code) {
            errorInfo.code = error.code;
        }

        // Parse based on error type
        switch (error.name) {
            case 'ValidationError':
                errorInfo = {
                    status: HTTP_STATUS.BAD_REQUEST,
                    message: 'Validation failed',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    details: this.formatValidationError(error).details
                };
                break;

            case 'UnauthorizedError':
            case 'JsonWebTokenError':
            case 'TokenExpiredError':
                errorInfo = {
                    status: HTTP_STATUS.UNAUTHORIZED,
                    message: error.message || 'Authentication failed',
                    code: ERROR_TYPES.AUTHENTICATION_ERROR
                };
                break;

            case 'ForbiddenError':
                errorInfo = {
                    status: HTTP_STATUS.FORBIDDEN,
                    message: 'Access denied',
                    code: ERROR_TYPES.AUTHORIZATION_ERROR
                };
                break;

            case 'NotFoundError':
                errorInfo = {
                    status: HTTP_STATUS.NOT_FOUND,
                    message: error.message || 'Resource not found',
                    code: ERROR_TYPES.NOT_FOUND_ERROR
                };
                break;

            case 'ConflictError':
                errorInfo = {
                    status: HTTP_STATUS.CONFLICT,
                    message: error.message || 'Resource conflict',
                    code: ERROR_TYPES.CONFLICT_ERROR
                };
                break;

            case 'TooManyRequestsError':
                errorInfo = {
                    status: HTTP_STATUS.TOO_MANY_REQUESTS,
                    message: 'Rate limit exceeded',
                    code: ERROR_TYPES.RATE_LIMIT_ERROR
                };
                break;

            default:
                // Use custom message if available
                if (error.message && process.env.NODE_ENV === 'development') {
                    errorInfo.message = error.message;
                }
        }

        return errorInfo;
    }

    /**
     * Parse Firebase errors
     */
    parseFirebaseError(error) {
        const firebaseCode = error.errorInfo?.code;
        const message = error.errorInfo?.message || error.message;

        let status = HTTP_STATUS.INTERNAL_SERVER_ERROR;
        let userMessage = 'Firebase service error';

        switch (firebaseCode) {
            case FIREBASE_ERROR_CODES.INVALID_REGISTRATION_TOKEN:
            case FIREBASE_ERROR_CODES.REGISTRATION_TOKEN_NOT_REGISTERED:
                status = HTTP_STATUS.BAD_REQUEST;
                userMessage = 'Invalid or expired FCM token';
                break;

            case FIREBASE_ERROR_CODES.INVALID_PACKAGE_NAME:
                status = HTTP_STATUS.BAD_REQUEST;
                userMessage = 'Invalid package name';
                break;

            case FIREBASE_ERROR_CODES.MESSAGE_RATE_EXCEEDED:
            case FIREBASE_ERROR_CODES.DEVICE_MESSAGE_RATE_EXCEEDED:
            case FIREBASE_ERROR_CODES.TOPICS_MESSAGE_RATE_EXCEEDED:
                status = HTTP_STATUS.TOO_MANY_REQUESTS;
                userMessage = 'Firebase rate limit exceeded';
                break;

            case FIREBASE_ERROR_CODES.INVALID_APNS_CREDENTIALS:
                status = HTTP_STATUS.BAD_REQUEST;
                userMessage = 'Invalid APNS credentials';
                break;

            case FIREBASE_ERROR_CODES.TOO_MANY_TOPICS:
                status = HTTP_STATUS.BAD_REQUEST;
                userMessage = 'Too many topics in condition';
                break;

            case FIREBASE_ERROR_CODES.INVALID_ARGUMENT:
                status = HTTP_STATUS.BAD_REQUEST;
                userMessage = 'Invalid request parameters';
                break;

            case FIREBASE_ERROR_CODES.THIRD_PARTY_AUTH_ERROR:
                status = HTTP_STATUS.UNAUTHORIZED;
                userMessage = 'Firebase authentication error';
                break;

            case FIREBASE_ERROR_CODES.QUOTA_EXCEEDED:
                status = HTTP_STATUS.TOO_MANY_REQUESTS;
                userMessage = 'Firebase quota exceeded';
                break;

            case FIREBASE_ERROR_CODES.UNAVAILABLE:
                status = HTTP_STATUS.SERVICE_UNAVAILABLE;
                userMessage = 'Firebase service temporarily unavailable';
                break;

            case FIREBASE_ERROR_CODES.INTERNAL_ERROR:
            default:
                status = HTTP_STATUS.INTERNAL_SERVER_ERROR;
                userMessage = 'Firebase internal error';
                break;
        }

        return {
            status,
            message: userMessage,
            firebaseCode,
            details: process.env.NODE_ENV === 'development' ? message : undefined
        };
    }

    /**
     * Format validation errors
     */
    formatValidationError(error) {
        let details = [];

        if (error.details) {
            // Joi validation error
            details = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));
        } else if (error.errors) {
            // Mongoose validation error
            details = Object.keys(error.errors).map(field => ({
                field,
                message: error.errors[field].message,
                value: error.errors[field].value
            }));
        } else {
            details = [{ message: error.message || 'Validation failed' }];
        }

        return {
            type: 'validation',
            details
        };
    }

    /**
     * Log error with context
     */
    logError(error, req) {
        const errorContext = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            status: error.statusCode || error.status,
            url: req?.url,
            method: req?.method,
            ip: req?.ip,
            userAgent: req?.get('User-Agent'),
            requestId: req?.headers['x-request-id'],
            userId: req?.user?.id,
            timestamp: new Date().toISOString()
        };

        // Log based on error severity
        if (this.isClientError(error)) {
            this.logger.warn('Client error:', errorContext);
        } else {
            this.logger.error('Server error:', errorContext);
        }
    }

    /**
     * Check if error is client-side (4xx)
     */
    isClientError(error) {
        const status = error.statusCode || error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
        return status >= 400 && status < 500;
    }

    /**
     * Create error response
     */
    createErrorResponse(message, code = ERROR_TYPES.INTERNAL_ERROR, status = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) {
        return {
            success: false,
            error: message,
            code,
            details,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Create custom error
     */
    createError(message, code = ERROR_TYPES.INTERNAL_ERROR, status = HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        const error = new Error(message);
        error.code = code;
        error.statusCode = status;
        return error;
    }

    /**
     * Handle uncaught exceptions
     */
    handleUncaughtException = (error) => {
        this.logger.error('Uncaught Exception:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });

        // In production, exit gracefully
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    };

    /**
     * Handle unhandled promise rejections
     */
    handleUnhandledRejection = (reason, promise) => {
        this.logger.error('Unhandled Promise Rejection:', {
            reason: reason?.message || reason,
            stack: reason?.stack,
            promise: promise.toString(),
            timestamp: new Date().toISOString()
        });

        // In production, exit gracefully
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    };

    /**
     * Setup global error handlers
     */
    setupGlobalHandlers() {
        process.on('uncaughtException', this.handleUncaughtException);
        process.on('unhandledRejection', this.handleUnhandledRejection);
        
        this.logger.info('🛡️ Global error handlers configured');
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: true,
            errorHandlingActive: true,
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const errorHandler = new ErrorHandler();

module.exports = {
    globalErrorHandler: errorHandler.globalErrorHandler,
    asyncHandler: errorHandler.asyncHandler,
    notFoundHandler: errorHandler.notFoundHandler,
    validationErrorHandler: errorHandler.validationErrorHandler,
    authErrorHandler: errorHandler.authErrorHandler,
    rateLimitErrorHandler: errorHandler.rateLimitErrorHandler,
    databaseErrorHandler: errorHandler.databaseErrorHandler,
    firebaseErrorHandler: errorHandler.firebaseErrorHandler,
    networkErrorHandler: errorHandler.networkErrorHandler,
    createError: errorHandler.createError.bind(errorHandler),
    createErrorResponse: errorHandler.createErrorResponse.bind(errorHandler),
    setupGlobalHandlers: errorHandler.setupGlobalHandlers.bind(errorHandler),
    healthCheck: errorHandler.healthCheck.bind(errorHandler),
    errorHandler
};