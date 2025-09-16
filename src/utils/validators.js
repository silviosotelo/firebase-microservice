// ==========================================
// VALIDATORS - Validadores Robustos
// Funciones de validación que no fallan catastróficamente
// ==========================================

const Joi = require('joi');
const { 
    NOTIFICATION_TYPES, 
    PRIORITY_LEVELS, 
    VALIDATION_RULES,
    USER_ROLES 
} = require('./constants');

/**
 * Validate notification request
 */
function validateNotificationRequest(data) {
    try {
        const schema = Joi.object({
            title: Joi.string()
                .min(1)
                .max(VALIDATION_RULES.NOTIFICATION.TITLE_MAX_LENGTH)
                .required()
                .messages({
                    'string.empty': 'Title cannot be empty',
                    'string.max': `Title must be ${VALIDATION_RULES.NOTIFICATION.TITLE_MAX_LENGTH} characters or less`,
                    'any.required': 'Title is required'
                }),
            
            message: Joi.string()
                .min(1)
                .max(VALIDATION_RULES.NOTIFICATION.MESSAGE_MAX_LENGTH)
                .required()
                .messages({
                    'string.empty': 'Message cannot be empty',
                    'string.max': `Message must be ${VALIDATION_RULES.NOTIFICATION.MESSAGE_MAX_LENGTH} characters or less`,
                    'any.required': 'Message is required'
                }),
            
            type: Joi.string()
                .valid(...Object.values(NOTIFICATION_TYPES))
                .default(NOTIFICATION_TYPES.GENERAL),
            
            priority: Joi.string()
                .valid(...Object.values(PRIORITY_LEVELS))
                .default(PRIORITY_LEVELS.NORMAL),
            
            tokens: Joi.array()
                .items(Joi.string().min(VALIDATION_RULES.TOKEN.MIN_LENGTH))
                .max(VALIDATION_RULES.NOTIFICATION.MAX_TOKENS_PER_REQUEST)
                .when('topic', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.when('user_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }) }),
            
            topic: Joi.string()
                .min(VALIDATION_RULES.TOPIC.MIN_LENGTH)
                .max(VALIDATION_RULES.TOPIC.MAX_LENGTH)
                .pattern(VALIDATION_RULES.TOPIC.PATTERN)
                .when('tokens', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.when('user_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }) }),
            
            user_id: Joi.string()
                .min(VALIDATION_RULES.USER_ID.MIN_LENGTH)
                .max(VALIDATION_RULES.USER_ID.MAX_LENGTH)
                .pattern(VALIDATION_RULES.USER_ID.PATTERN)
                .when('tokens', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.when('topic', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }) }),
            
            data: Joi.object().default({}),
            extra_data: Joi.object().default({}),
            
            sound: Joi.string().default('default'),
            icon: Joi.string().optional(),
            image: Joi.string().uri().optional(),
            badge: Joi.number().integer().min(0).optional(),
            
            scheduled_at: Joi.string().isoDate().optional(),
            
            route: Joi.string().optional(),
            action: Joi.string().optional()
        }).or('tokens', 'topic', 'user_id');

        return schema.validate(data, { 
            abortEarly: false,
            allowUnknown: true,
            stripUnknown: true
        });
        
    } catch (error) {
        return {
            error: {
                details: [{ message: 'Validation schema error: ' + error.message }]
            }
        };
    }
}

/**
 * Validate pagination parameters
 */
function validatePagination(query) {
    try {
        const schema = Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(1000).default(50),
            sortBy: Joi.string().valid('created_at', 'updated_at', 'priority', 'status', 'type').default('created_at'),
            sortOrder: Joi.string().valid('ASC', 'DESC', 'asc', 'desc').default('DESC'),
            
            // Filters
            status: Joi.string().optional(),
            type: Joi.string().optional(),
            priority: Joi.string().optional(),
            userId: Joi.string().optional(),
            dateFrom: Joi.string().isoDate().optional(),
            dateTo: Joi.string().isoDate().optional(),
            search: Joi.string().max(100).optional()
        });

        return schema.validate(query, { 
            abortEarly: false,
            allowUnknown: true,
            stripUnknown: true
        });
        
    } catch (error) {
        return {
            error: {
                details: [{ message: 'Pagination validation error: ' + error.message }]
            }
        };
    }
}

/**
 * Validate configuration
 */
function validateConfig(data) {
    try {
        const schema = Joi.object({
            key: Joi.string().min(1).max(100).required(),
            value: Joi.alternatives([
                Joi.string(),
                Joi.number(),
                Joi.boolean(),
                Joi.object(),
                Joi.array()
            ]).required(),
            description: Joi.string().max(255).optional(),
            type: Joi.string().valid('string', 'number', 'boolean', 'json', 'array').default('string'),
            encrypted: Joi.boolean().default(false)
        });

        return schema.validate(data);
        
    } catch (error) {
        return {
            error: {
                details: [{ message: 'Config validation error: ' + error.message }]
            }
        };
    }
}

/**
 * Validate FCM token format
 */
function validateToken(token) {
    try {
        if (!token || typeof token !== 'string') {
            return false;
        }

        // Basic FCM token validation
        if (token.length < VALIDATION_RULES.TOKEN.MIN_LENGTH) {
            return false;
        }

        if (token.length > VALIDATION_RULES.TOKEN.MAX_LENGTH) {
            return false;
        }

        // Allow test tokens in development
        if (process.env.NODE_ENV === 'development' && token.startsWith('test-')) {
            return true;
        }

        // Basic pattern validation
        return VALIDATION_RULES.TOKEN.PATTERN.test(token);
        
    } catch (error) {
        return false;
    }
}

/**
 * Validate topic name format
 */
function validateTopic(topic) {
    try {
        if (!topic || typeof topic !== 'string') {
            return false;
        }

        if (topic.length < VALIDATION_RULES.TOPIC.MIN_LENGTH || 
            topic.length > VALIDATION_RULES.TOPIC.MAX_LENGTH) {
            return false;
        }

        // Allow test topics in development
        if (process.env.NODE_ENV === 'development' && topic.startsWith('test-')) {
            return true;
        }

        return VALIDATION_RULES.TOPIC.PATTERN.test(topic);
        
    } catch (error) {
        return false;
    }
}

/**
 * Validate user ID format
 */
function validateUserId(userId) {
    try {
        if (!userId || typeof userId !== 'string') {
            return false;
        }

        if (userId.length < VALIDATION_RULES.USER_ID.MIN_LENGTH || 
            userId.length > VALIDATION_RULES.USER_ID.MAX_LENGTH) {
            return false;
        }

        return VALIDATION_RULES.USER_ID.PATTERN.test(userId);
        
    } catch (error) {
        return false;
    }
}

/**
 * Validate user role
 */
function validateUserRole(role) {
    try {
        return Object.values(USER_ROLES).includes(role);
    } catch (error) {
        return false;
    }
}

/**
 * Validate email format
 */
function validateEmail(email) {
    try {
        const schema = Joi.string().email();
        const { error } = schema.validate(email);
        return !error;
    } catch (error) {
        return false;
    }
}

/**
 * Validate URL format
 */
function validateUrl(url) {
    try {
        const schema = Joi.string().uri();
        const { error } = schema.validate(url);
        return !error;
    } catch (error) {
        return false;
    }
}

/**
 * Validate ISO date string
 */
function validateISODate(dateString) {
    try {
        const schema = Joi.string().isoDate();
        const { error } = schema.validate(dateString);
        return !error;
    } catch (error) {
        return false;
    }
}

/**
 * Sanitize string input
 */
function sanitizeString(input, maxLength = 1000) {
    try {
        if (!input || typeof input !== 'string') {
            return '';
        }

        // Remove potentially dangerous characters
        const sanitized = input
            .trim()
            .replace(/[<>'"]/g, '') // Remove basic HTML/script chars
            .substring(0, maxLength);

        return sanitized;
        
    } catch (error) {
        return '';
    }
}

/**
 * Validate and sanitize notification data
 */
function sanitizeNotificationData(data) {
    try {
        const sanitized = {
            title: sanitizeString(data.title, VALIDATION_RULES.NOTIFICATION.TITLE_MAX_LENGTH),
            message: sanitizeString(data.message, VALIDATION_RULES.NOTIFICATION.MESSAGE_MAX_LENGTH),
            type: Object.values(NOTIFICATION_TYPES).includes(data.type) 
                ? data.type 
                : NOTIFICATION_TYPES.GENERAL,
            priority: Object.values(PRIORITY_LEVELS).includes(data.priority) 
                ? data.priority 
                : PRIORITY_LEVELS.NORMAL
        };

        // Handle tokens
        if (data.tokens && Array.isArray(data.tokens)) {
            sanitized.tokens = data.tokens
                .filter(token => validateToken(token))
                .slice(0, VALIDATION_RULES.NOTIFICATION.MAX_TOKENS_PER_REQUEST);
        }

        // Handle topic
        if (data.topic && validateTopic(data.topic)) {
            sanitized.topic = data.topic;
        }

        // Handle user_id
        if (data.user_id && validateUserId(data.user_id)) {
            sanitized.user_id = data.user_id;
        }

        // Handle optional data
        if (data.data && typeof data.data === 'object') {
            sanitized.data = data.data;
        }

        if (data.extra_data && typeof data.extra_data === 'object') {
            sanitized.extra_data = data.extra_data;
        }

        return sanitized;
        
    } catch (error) {
        return {
            title: 'Invalid Notification',
            message: 'Notification data could not be sanitized',
            type: NOTIFICATION_TYPES.GENERAL,
            priority: PRIORITY_LEVELS.NORMAL
        };
    }
}

/**
 * Format bytes for display
 */
function formatBytes(bytes, decimals = 2) {
    try {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        
    } catch (error) {
        return '0 Bytes';
    }
}

/**
 * Format duration for display
 */
function formatDuration(milliseconds) {
    try {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
        
    } catch (error) {
        return '0s';
    }
}

/**
 * Generate random string
 */
function generateRandomString(length = 32) {
    try {
        const crypto = require('crypto');
        return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    } catch (error) {
        // Fallback method
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}

/**
 * Validate JSON string
 */
function validateJSON(jsonString) {
    try {
        JSON.parse(jsonString);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Safe JSON parse
 */
function safeJSONParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        return defaultValue;
    }
}

/**
 * Validate webhook data
 */
function validateWebhookData(data) {
    try {
        const schema = Joi.object({
            url: Joi.string().uri().required(),
            events: Joi.array().items(Joi.string()).default([]),
            secret: Joi.string().optional(),
            active: Joi.boolean().default(true),
            description: Joi.string().max(255).optional()
        });

        return schema.validate(data);
        
    } catch (error) {
        return {
            error: {
                details: [{ message: 'Webhook validation error: ' + error.message }]
            }
        };
    }
}

/**
 * Validate stats query parameters
 */
function validateStatsQuery(query) {
    try {
        const schema = Joi.object({
            period: Joi.string().valid('1h', '24h', '7d', '30d', '90d').default('24h'),
            groupBy: Joi.string().valid('hour', 'day', 'week', 'month').default('hour'),
            userId: Joi.string().optional(),
            type: Joi.string().optional(),
            status: Joi.string().optional(),
            dateFrom: Joi.string().isoDate().optional(),
            dateTo: Joi.string().isoDate().optional()
        });

        return schema.validate(query, { allowUnknown: true, stripUnknown: true });
        
    } catch (error) {
        return {
            error: {
                details: [{ message: 'Stats query validation error: ' + error.message }]
            }
        };
    }
}

// Export all validator functions
module.exports = {
    // Main validators
    validateNotificationRequest,
    validatePagination,
    validateConfig,
    validateWebhookData,
    validateStatsQuery,
    
    // Field validators
    validateToken,
    validateTopic,
    validateUserId,
    validateUserRole,
    validateEmail,
    validateUrl,
    validateISODate,
    validateJSON,
    
    // Sanitizers
    sanitizeString,
    sanitizeNotificationData,
    safeJSONParse,
    
    // Formatters
    formatBytes,
    formatDuration,
    
    // Utilities
    generateRandomString
};