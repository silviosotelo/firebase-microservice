// ==========================================
// VALIDATION MIDDLEWARE
// Request validation using Joi schemas
// ==========================================

const Joi = require('joi');
const AppLogger = require('../utils/logger');
const { 
    validateNotificationRequest,
    validateBulkNotificationRequest,
    validatePagination,
    validateTestNotification,
    validateTokenArray,
    validateConfig,
    formatValidationErrors
} = require('../utils/validators');
const { HTTP_STATUS, ERROR_TYPES } = require('../utils/constants');

class ValidationMiddleware {
    constructor() {
        this.logger = new AppLogger('ValidationMiddleware');
    }

    /**
     * Generic validation middleware factory
     */
    validate = (schema, property = 'body') => {
        return (req, res, next) => {
            const data = req[property];
            
            const { error, value } = schema.validate(data, {
                abortEarly: false,
                stripUnknown: true,
                convert: true
            });

            if (error) {
                const formattedErrors = formatValidationErrors(error);
                
                this.logger.warn('❌ Validation failed', {
                    property,
                    errors: formattedErrors,
                    path: req.path,
                    method: req.method,
                    ip: req.ip
                });

                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Validation failed',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    details: formattedErrors,
                    timestamp: new Date().toISOString()
                });
            }

            // Replace request data with validated and sanitized data
            req[property] = value;
            next();
        };
    };

    /**
     * Notification validation middleware
     */
    validateNotification = (req, res, next) => {
        const { error, value } = validateNotificationRequest(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Bulk notification validation middleware
     */
    validateBulkNotification = (req, res, next) => {
        const { error, value } = validateBulkNotificationRequest(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Pagination validation middleware
     */
    validatePaginationParams = (req, res, next) => {
        const { error, value } = validatePagination(req.query);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.query = value;
        next();
    };

    /**
     * Test notification validation middleware
     */
    validateTestNotification = (req, res, next) => {
        const { error, value } = validateTestNotification(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Token array validation middleware
     */
    validateTokens = (req, res, next) => {
        const { error, value } = validateTokenArray(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Configuration validation middleware
     */
    validateConfigUpdate = (req, res, next) => {
        // Handle both single config and array of configs
        const configs = Array.isArray(req.body) ? req.body : [req.body];
        const validatedConfigs = [];
        const errors = [];

        for (let i = 0; i < configs.length; i++) {
            const { error, value } = validateConfig(configs[i]);
            
            if (error) {
                errors.push({
                    index: i,
                    errors: formatValidationErrors(error)
                });
            } else {
                validatedConfigs.push(value);
            }
        }

        if (errors.length > 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: 'Configuration validation failed',
                code: ERROR_TYPES.VALIDATION_ERROR,
                details: errors,
                timestamp: new Date().toISOString()
            });
        }

        req.body = Array.isArray(req.body) ? validatedConfigs : validatedConfigs[0];
        next();
    };

    /**
     * ID parameter validation
     */
    validateId = (paramName = 'id') => {
        return (req, res, next) => {
            const id = req.params[paramName];
            
            if (!id) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: `${paramName} parameter is required`,
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    timestamp: new Date().toISOString()
                });
            }

            // Validate ID format (should be numeric for our case)
            if (!/^\d+$/.test(id)) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: `Invalid ${paramName} format`,
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    timestamp: new Date().toISOString()
                });
            }

            next();
        };
    };

    /**
     * Request size validation
     */
    validateRequestSize = (maxSizeBytes = 10 * 1024 * 1024) => { // 10MB default
        return (req, res, next) => {
            const contentLength = parseInt(req.get('Content-Length') || '0');
            
            if (contentLength > maxSizeBytes) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: `Request too large. Maximum size: ${maxSizeBytes} bytes`,
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    maxSize: maxSizeBytes,
                    actualSize: contentLength,
                    timestamp: new Date().toISOString()
                });
            }

            next();
        };
    };

    /**
     * Content type validation
     */
    validateContentType = (allowedTypes = ['application/json']) => {
        return (req, res, next) => {
            const contentType = req.get('Content-Type');
            
            if (!contentType) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Content-Type header is required',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    allowedTypes,
                    timestamp: new Date().toISOString()
                });
            }

            const isAllowed = allowedTypes.some(type => 
                contentType.toLowerCase().includes(type.toLowerCase())
            );

            if (!isAllowed) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Unsupported Content-Type',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    provided: contentType,
                    allowedTypes,
                    timestamp: new Date().toISOString()
                });
            }

            next();
        };
    };

    /**
     * Custom field validation
     */
    validateField = (fieldName, validator, location = 'body') => {
        return (req, res, next) => {
            const value = req[location][fieldName];
            
            try {
                const isValid = validator(value);
                
                if (!isValid) {
                    return res.status(HTTP_STATUS.BAD_REQUEST).json({
                        success: false,
                        error: `Invalid ${fieldName}`,
                        code: ERROR_TYPES.VALIDATION_ERROR,
                        field: fieldName,
                        timestamp: new Date().toISOString()
                    });
                }

                next();

            } catch (error) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: `Validation error for ${fieldName}: ${error.message}`,
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    field: fieldName,
                    timestamp: new Date().toISOString()
                });
            }
        };
    };

    /**
     * Login validation
     */
    validateLogin = (req, res, next) => {
        const schema = Joi.object({
            username: Joi.string()
                .alphanum()
                .min(3)
                .max(50)
                .required(),
            password: Joi.string()
                .min(6)
                .max(255)
                .required()
        });

        const { error, value } = schema.validate(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * API key generation validation
     */
    validateApiKeyGeneration = (req, res, next) => {
        const schema = Joi.object({
            name: Joi.string()
                .min(3)
                .max(100)
                .required(),
            role: Joi.string()
                .valid('viewer', 'admin', 'super_admin')
                .default('admin'),
            description: Joi.string()
                .max(500)
                .optional(),
            expiresAt: Joi.date()
                .greater('now')
                .optional()
        });

        const { error, value } = schema.validate(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Webhook registration validation
     */
    validateWebhookRegistration = (req, res, next) => {
        const schema = Joi.object({
            url: Joi.string()
                .uri()
                .required(),
            events: Joi.array()
                .items(Joi.string().valid(
                    'notification.sent',
                    'notification.delivered', 
                    'notification.failed',
                    'notification.opened'
                ))
                .min(1)
                .default(['notification.sent', 'notification.delivered', 'notification.failed']),
            secret: Joi.string()
                .min(16)
                .max(255)
                .optional(),
            active: Joi.boolean()
                .default(true),
            description: Joi.string()
                .max(500)
                .optional()
        });

        const { error, value } = schema.validate(req.body);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.body = value;
        next();
    };

    /**
     * Query parameter validation for stats
     */
    validateStatsQuery = (req, res, next) => {
        const schema = Joi.object({
            period: Joi.string()
                .valid('1h', '24h', '7d', '30d', '90d')
                .default('24h'),
            groupBy: Joi.string()
                .valid('hour', 'day', 'week', 'month')
                .default('hour'),
            type: Joi.string()
                .valid('general', 'appointment', 'result', 'emergency', 'promotion', 'reminder')
                .optional(),
            status: Joi.string()
                .valid('queued', 'processing', 'completed', 'failed', 'cancelled')
                .optional(),
            userId: Joi.string()
                .max(50)
                .optional(),
            format: Joi.string()
                .valid('json', 'csv', 'xlsx')
                .default('json')
        });

        const { error, value } = schema.validate(req.query);
        
        if (error) {
            return this.handleValidationError(error, req, res);
        }
        
        req.query = value;
        next();
    };

    /**
     * File upload validation
     */
    validateFileUpload = (options = {}) => {
        const {
            maxSize = 5 * 1024 * 1024, // 5MB
            allowedTypes = ['image/jpeg', 'image/png', 'image/gif'],
            required = false
        } = options;

        return (req, res, next) => {
            if (!req.file && required) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'File upload is required',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    timestamp: new Date().toISOString()
                });
            }

            if (req.file) {
                // Check file size
                if (req.file.size > maxSize) {
                    return res.status(HTTP_STATUS.BAD_REQUEST).json({
                        success: false,
                        error: `File too large. Maximum size: ${maxSize} bytes`,
                        code: ERROR_TYPES.VALIDATION_ERROR,
                        maxSize,
                        actualSize: req.file.size,
                        timestamp: new Date().toISOString()
                    });
                }

                // Check file type
                if (!allowedTypes.includes(req.file.mimetype)) {
                    return res.status(HTTP_STATUS.BAD_REQUEST).json({
                        success: false,
                        error: 'Invalid file type',
                        code: ERROR_TYPES.VALIDATION_ERROR,
                        allowedTypes,
                        actualType: req.file.mimetype,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            next();
        };
    };

    /**
     * Batch operation validation
     */
    validateBatchOperation = (maxBatchSize = 1000) => {
        return (req, res, next) => {
            if (!Array.isArray(req.body)) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Request body must be an array for batch operations',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    timestamp: new Date().toISOString()
                });
            }

            if (req.body.length === 0) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Batch array cannot be empty',
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    timestamp: new Date().toISOString()
                });
            }

            if (req.body.length > maxBatchSize) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: `Batch size exceeds maximum limit of ${maxBatchSize}`,
                    code: ERROR_TYPES.VALIDATION_ERROR,
                    maxBatchSize,
                    actualSize: req.body.length,
                    timestamp: new Date().toISOString()
                });
            }

            next();
        };
    };

    /**
     * Handle validation errors
     */
    handleValidationError(error, req, res) {
        const formattedErrors = formatValidationErrors(error);
        
        this.logger.warn('❌ Validation failed', {
            errors: formattedErrors,
            path: req.path,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        });

        return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: 'Validation failed',
            code: ERROR_TYPES.VALIDATION_ERROR,
            details: formattedErrors,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Sanitize HTML content
     */
    sanitizeHtml = (req, res, next) => {
        const { sanitizeHtml } = require('../utils/validators');
        
        if (req.body && typeof req.body === 'object') {
            this.recursiveSanitize(req.body, sanitizeHtml);
        }
        
        next();
    };

    /**
     * Recursively sanitize object properties
     */
    recursiveSanitize(obj, sanitizer) {
        if (!obj || typeof obj !== 'object') return;

        Object.keys(obj).forEach(key => {
            if (typeof obj[key] === 'string') {
                obj[key] = sanitizer(obj[key]);
            } else if (typeof obj[key] === 'object') {
                this.recursiveSanitize(obj[key], sanitizer);
            }
        });
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: true,
            validationActive: true,
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const validationMiddleware = new ValidationMiddleware();

module.exports = {
    validate: validationMiddleware.validate,
    validateNotification: validationMiddleware.validateNotification,
    validateBulkNotification: validationMiddleware.validateBulkNotification,
    validatePaginationParams: validationMiddleware.validatePaginationParams,
    validateTestNotification: validationMiddleware.validateTestNotification,
    validateTokens: validationMiddleware.validateTokens,
    validateConfigUpdate: validationMiddleware.validateConfigUpdate,
    validateId: validationMiddleware.validateId,
    validateRequestSize: validationMiddleware.validateRequestSize,
    validateContentType: validationMiddleware.validateContentType,
    validateField: validationMiddleware.validateField,
    validateLogin: validationMiddleware.validateLogin,
    validateApiKeyGeneration: validationMiddleware.validateApiKeyGeneration,
    validateWebhookRegistration: validationMiddleware.validateWebhookRegistration,
    validateStatsQuery: validationMiddleware.validateStatsQuery,
    validateFileUpload: validationMiddleware.validateFileUpload,
    validateBatchOperation: validationMiddleware.validateBatchOperation,
    sanitizeHtml: validationMiddleware.sanitizeHtml,
    healthCheck: validationMiddleware.healthCheck.bind(validationMiddleware),
    validationMiddleware
};