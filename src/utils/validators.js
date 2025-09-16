// ==========================================
// VALIDATORS AND UTILITIES
// Input validation and helper functions
// ==========================================

const Joi = require('joi');
const { 
    VALIDATION_RULES, 
    NOTIFICATION_TYPES, 
    PRIORITY_LEVELS,
    NOTIFICATION_STATUS 
} = require('./constants');

// ==========================================
// JOI VALIDATION SCHEMAS
// ==========================================

const notificationSchema = Joi.object({
    user_id: Joi.string()
        .pattern(/^[a-zA-Z0-9_-]{1,128}$/)
        .max(128)
        .optional(),
    
    tokens: Joi.alternatives().try(
        Joi.string().min(50).max(250),  // Más permisivo para tokens FCM
        Joi.array().items(
            Joi.string().min(50).max(250)  // Más permisivo para tokens FCM
        ).max(1000)
    ).optional(),
    
    topic: Joi.string()
        .pattern(/^[a-zA-Z0-9-_.~%]{1,900}$/)
        .max(900)
        .optional(),
    
    title: Joi.string()
        .max(100)
        .required(),
    
    message: Joi.string()
        .max(4000)
        .required(),
    
    type: Joi.string()
        .valid(...Object.values(NOTIFICATION_TYPES))
        .default(NOTIFICATION_TYPES.GENERAL),
    
    priority: Joi.string()
        .valid(...Object.values(PRIORITY_LEVELS))
        .default(PRIORITY_LEVELS.NORMAL),
    
    route: Joi.string()
        .max(200)
        .optional(),
    
    extra_data: Joi.alternatives().try(
        Joi.string().max(4096),
        Joi.object()
    ).optional(),
    
    sound: Joi.string()
        .max(100)
        .default('default'),
    
    icon: Joi.string()
        .uri()
        .optional(),
    
    image: Joi.string()
        .uri()
        .optional(),
    
    badge: Joi.number()
        .integer()
        .min(0)
        .max(999)
        .optional(),
    
    click_action: Joi.string()
        .uri()
        .optional(),
    
    channel_id: Joi.string()
        .max(100)
        .optional(),
    
    schedule_at: Joi.date()
        .greater('now')
        .optional()
}).or('user_id', 'tokens', 'topic');
const bulkNotificationSchema = Joi.object({
    notifications: Joi.array()
        .items(notificationSchema)
        .min(1)
        .max(VALIDATION_RULES.BULK_MAX_SIZE)
        .required(),
    
    batch_size: Joi.number()
        .integer()
        .min(1)
        .max(500)
        .default(100)
        .optional()
});

const paginationSchema = Joi.object({
    page: Joi.number()
        .integer()
        .min(1)
        .default(1),
    
    limit: Joi.number()
        .integer()
        .min(1)
        .max(1000)
        .default(50),
    
    status: Joi.string()
        .valid(...Object.values(NOTIFICATION_STATUS))
        .optional(),
    
    type: Joi.string()
        .valid(...Object.values(NOTIFICATION_TYPES))
        .optional(),
    
    user_id: Joi.string()
        .pattern(VALIDATION_RULES.USER_ID_PATTERN)
        .optional(),
    
    date_from: Joi.date()
        .optional(),
    
    date_to: Joi.date()
        .greater(Joi.ref('date_from'))
        .optional(),
    
    sort_by: Joi.string()
        .valid('created_at', 'updated_at', 'priority', 'status')
        .default('created_at'),
    
    sort_order: Joi.string()
        .valid('ASC', 'DESC')
        .default('DESC')
});

const testNotificationSchema = Joi.object({
    token: Joi.string()
        .pattern(VALIDATION_RULES.TOKEN_PATTERN)
        .required(),
    
    title: Joi.string()
        .max(VALIDATION_RULES.TITLE_MAX_LENGTH)
        .default('Test Notification'),
    
    message: Joi.string()
        .max(VALIDATION_RULES.MESSAGE_MAX_LENGTH)
        .default('This is a test notification from Firebase Microservice')
});

const tokenValidationSchema = Joi.object({
    tokens: Joi.array()
        .items(Joi.string().min(VALIDATION_RULES.TOKEN_MIN_LENGTH))
        .min(1)
        .max(100)
        .required()
});

const configSchema = Joi.object({
    key: Joi.string()
        .pattern(/^[A-Z_][A-Z0-9_]*$/)
        .max(100)
        .required(),
    
    value: Joi.alternatives().try(
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.object()
    ).required(),
    
    description: Joi.string()
        .max(500)
        .optional(),
    
    type: Joi.string()
        .valid('string', 'number', 'boolean', 'json')
        .default('string'),
    
    encrypted: Joi.boolean()
        .default(false)
});

// ==========================================
// VALIDATION FUNCTIONS
// ==========================================

/**
 * Validate notification request
 */
function validateNotificationRequest(data) {
    return notificationSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

/**
 * Validate bulk notification request
 */
function validateBulkNotificationRequest(data) {
    return bulkNotificationSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

/**
 * Validate pagination parameters
 */
function validatePagination(data) {
    return paginationSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

/**
 * Validate test notification
 */
function validateTestNotification(data) {
    return testNotificationSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

/**
 * Validate token array
 */
function validateTokenArray(data) {
    return tokenValidationSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

/**
 * Validate configuration
 */
function validateConfig(data) {
    return configSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

// ==========================================
// INDIVIDUAL FIELD VALIDATORS
// ==========================================

/**
 * Validate FCM token format - FIXED VERSION
 */
function validateToken(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }

    // Check length first
    if (token.length < VALIDATION_RULES.TOKEN_MIN_LENGTH || 
        token.length > VALIDATION_RULES.TOKEN_MAX_LENGTH) {
        return false;
    }

    // Try multiple patterns for FCM token validation
    
    // 1. Specific FCM pattern (most restrictive)
    if (VALIDATION_RULES.FCM_TOKEN_PATTERN && VALIDATION_RULES.FCM_TOKEN_PATTERN.test(token)) {
        return true;
    }
    
    // 2. General token pattern (medium restrictive)
    if (VALIDATION_RULES.TOKEN_PATTERN && VALIDATION_RULES.TOKEN_PATTERN.test(token)) {
        return true;
    }
    
    // 3. Permissive pattern for any FCM-like token (least restrictive)
    if (VALIDATION_RULES.PERMISSIVE_TOKEN_PATTERN && VALIDATION_RULES.PERMISSIVE_TOKEN_PATTERN.test(token)) {
        return true;
    }
    
    // 4. Manual validation for known FCM format
    // FCM tokens typically have format: [prefix]:[APA91b][rest]
    if (token.includes(':') && token.includes('APA91b')) {
        const parts = token.split(':');
        if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 50) {
            return true;
        }
    }
    
    // 5. Very basic validation - just check for reasonable length and characters
    const basicPattern = /^[A-Za-z0-9_:-]+$/;
    if (basicPattern.test(token) && token.length >= 50 && token.length <= 250) {
        return true;
    }

    return false;
}

/**
 * Validate topic name format
 */
function validateTopic(topic) {
    if (!topic || typeof topic !== 'string') {
        return false;
    }

    // Check length
    if (topic.length > VALIDATION_RULES.TOPIC_MAX_LENGTH) {
        return false;
    }

    // Check pattern
    return VALIDATION_RULES.TOPIC_PATTERN.test(topic);
}

/**
 * Validate user ID format
 */
function validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
        return false;
    }

    // Check length
    if (userId.length > VALIDATION_RULES.USER_ID_MAX_LENGTH) {
        return false;
    }

    // Check pattern
    return VALIDATION_RULES.USER_ID_PATTERN.test(userId);
}

/**
 * Validate email format
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
}

/**
 * Validate URL format
 */
function validateUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Validate JSON string
 */
function validateJson(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
        return false;
    }

    try {
        JSON.parse(jsonString);
        return true;
    } catch (e) {
        return false;
    }
}

// ==========================================
// SANITIZATION FUNCTIONS
// ==========================================

/**
 * Sanitize HTML content
 */
function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }

    // Basic HTML sanitization (remove script tags and dangerous attributes)
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/javascript:/gi, '')
        .trim();
}

/**
 * Sanitize text content
 */
function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    return text
        .replace(/[<>]/g, '')
        .trim();
}

/**
 * Sanitize file name
 */
function sanitizeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return 'file';
    }

    return fileName
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .replace(/_{2,}/g, '_')
        .trim();
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Format validation errors for API response
 */
function formatValidationErrors(joiError) {
    if (!joiError || !joiError.details) {
        return [];
    }

    return joiError.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
    }));
}

/**
 * Check if value is empty
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Generate random string
 */
function generateRandomString(length = 32, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

/**
 * Generate UUID v4
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Deep merge objects
 */
function deepMerge(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                deepMerge(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }

    return deepMerge(target, ...sources);
}

/**
 * Check if value is object
 */
function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Truncate string to specified length
 */
function truncateString(str, length = 100, suffix = '...') {
    if (!str || typeof str !== 'string') {
        return '';
    }

    if (str.length <= length) {
        return str;
    }

    return str.substring(0, length - suffix.length) + suffix;
}

/**
 * Convert string to slug
 */
function slugify(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }

    return text
        .toLowerCase()
        .replace(/[^\w ]+/g, '')
        .replace(/ +/g, '-');
}

/**
 * Parse boolean from string
 */
function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }
    return Boolean(value);
}

/**
 * Format file size
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Retry function with exponential backoff
 */
async function retry(fn, options = {}) {
    const {
        retries = 3,
        delay = 1000,
        factor = 2,
        maxDelay = 30000
    } = options;

    let lastError;
    
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (i === retries) {
                throw error;
            }

            const currentDelay = Math.min(delay * Math.pow(factor, i), maxDelay);
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
    }
    
    throw lastError;
}

/**
 * Rate limiter helper
 */
function createRateLimiter(windowMs, max) {
    const requests = new Map();
    
    return (identifier) => {
        const now = Date.now();
        const windowStart = now - windowMs;
        
        if (!requests.has(identifier)) {
            requests.set(identifier, []);
        }
        
        const userRequests = requests.get(identifier);
        
        // Remove old requests outside the window
        const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
        requests.set(identifier, validRequests);
        
        if (validRequests.length >= max) {
            return false;
        }
        
        validRequests.push(now);
        return true;
    };
}

module.exports = {
    // Joi schemas
    notificationSchema,
    bulkNotificationSchema,
    paginationSchema,
    testNotificationSchema,
    tokenValidationSchema,
    configSchema,
    
    // Main validation functions
    validateNotificationRequest,
    validateBulkNotificationRequest,
    validatePagination,
    validateTestNotification,
    validateTokenArray,
    validateConfig,
    
    // Field validators
    validateToken,
    validateTopic,
    validateUserId,
    validateEmail,
    validateUrl,
    validateJson,
    
    // Sanitization
    sanitizeHtml,
    sanitizeText,
    sanitizeFileName,
    
    // Utilities
    formatValidationErrors,
    isEmpty,
    generateRandomString,
    generateUUID,
    deepMerge,
    isObject,
    truncateString,
    slugify,
    parseBoolean,
    formatBytes,
    formatDuration,
    retry,
    createRateLimiter
};