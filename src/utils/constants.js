// ==========================================
// CONSTANTS - Constantes del Sistema
// Definiciones centralizadas para el microservicio
// ==========================================

// HTTP Status Codes
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504
};

// Notification Status
const NOTIFICATION_STATUS = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    SCHEDULED: 'scheduled'
};

// Notification Types
const NOTIFICATION_TYPES = {
    GENERAL: 'general',
    EMERGENCY: 'emergency',
    APPOINTMENT: 'appointment',
    RESULT: 'result',
    PROMOTION: 'promotion',
    REMINDER: 'reminder',
    UPDATE: 'update',
    ALERT: 'alert',
    INFO: 'info',
    WARNING: 'warning'
};

// Priority Levels
const PRIORITY_LEVELS = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent'
};

// User Roles
const USER_ROLES = {
    VIEWER: 'viewer',
    USER: 'user',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin'
};

// Queue Priorities (numeric for sorting)
const QUEUE_PRIORITIES = {
    LOW: 1,
    NORMAL: 5,
    HIGH: 8,
    URGENT: 10
};

// WebSocket Events
const WEBSOCKET_EVENTS = {
    // Connection events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    ERROR: 'error',
    
    // Notification events
    NOTIFICATION_UPDATE: 'notification:update',
    NOTIFICATION_PROGRESS: 'notification:progress',
    NOTIFICATION_STATUS: 'notification:status',
    
    // Subscription events
    SUBSCRIBE_NOTIFICATION: 'subscribe:notification',
    UNSUBSCRIBE_NOTIFICATION: 'unsubscribe:notification',
    SUBSCRIBE_STATS: 'subscribe:stats',
    SUBSCRIBE_LOGS: 'subscribe:logs',
    SUBSCRIBED: 'subscribed',
    
    // Stats events
    STATS_UPDATE: 'stats:update',
    
    // System events
    SYSTEM_ALERT: 'system:alert',
    LOG_MESSAGE: 'log:message',
    
    // User events
    USER_CONNECTED: 'user:connected',
    USER_DISCONNECTED: 'user:disconnected',
    
    // Queue events
    JOB_COMPLETED: 'job:completed',
    JOB_FAILED: 'job:failed',
    
    // Request/Response
    GET_NOTIFICATION_STATUS: 'get:notification:status'
};

// Queue Events
const QUEUE_EVENTS = {
    JOB_WAITING: 'waiting',
    JOB_ACTIVE: 'active',
    JOB_COMPLETED: 'completed',
    JOB_FAILED: 'failed',
    JOB_DELAYED: 'delayed',
    JOB_STALLED: 'stalled',
    JOB_PROGRESS: 'progress'
};

// Firebase Scopes
const FIREBASE_SCOPES = [
    'https://www.googleapis.com/auth/firebase.messaging'
];

// Rate Limiting Configuration
const RATE_LIMITS = {
    API: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: process.env.NODE_ENV === 'development' ? 10000 : 1000,
        message: 'Too many API requests'
    },
    BULK: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: process.env.NODE_ENV === 'development' ? 100 : 10,
        message: 'Too many bulk requests'
    },
    TEST: {
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: process.env.NODE_ENV === 'development' ? 200 : 20,
        message: 'Too many test requests'
    }
};

// Validation Rules
const VALIDATION_RULES = {
    NOTIFICATION: {
        TITLE_MAX_LENGTH: 100,
        MESSAGE_MAX_LENGTH: 4000,
        MAX_TOKENS_PER_REQUEST: 1000,
        MAX_NOTIFICATIONS_PER_BULK: 1000
    },
    TOKEN: {
        MIN_LENGTH: 50,
        MAX_LENGTH: 500,
        PATTERN: /^[A-Za-z0-9_-]+$/
    },
    TOPIC: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 900,
        PATTERN: /^[a-zA-Z0-9-_.~%]+$/
    },
    USER_ID: {
        MIN_LENGTH: 1,
        MAX_LENGTH: 100,
        PATTERN: /^[a-zA-Z0-9_-]+$/
    }
};

// Cache TTL (Time To Live)
const CACHE_TTL = {
    SHORT: 5 * 60, // 5 minutes
    MEDIUM: 30 * 60, // 30 minutes
    LONG: 2 * 60 * 60, // 2 hours
    VERY_LONG: 24 * 60 * 60 // 24 hours
};

// Retry Configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

// Batch Configuration
const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;

// Database Configuration
const DB_CONFIG = {
    RETENTION_DAYS: parseInt(process.env.DB_RETENTION_DAYS) || 90,
    BACKUP_INTERVAL_HOURS: 24,
    VACUUM_INTERVAL_HOURS: 168, // 1 week
    MAX_CONNECTIONS: 10
};

// Environment Types
const ENVIRONMENTS = {
    DEVELOPMENT: 'development',
    TESTING: 'test',
    STAGING: 'staging',
    PRODUCTION: 'production'
};

// Log Levels
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    VERBOSE: 'verbose'
};

// Firebase Configuration Keys
const FIREBASE_CONFIG_KEYS = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_CLIENT_ID',
    'FIREBASE_AUTH_URI',
    'FIREBASE_TOKEN_URI',
    'FIREBASE_AUTH_PROVIDER_X509_CERT_URL',
    'FIREBASE_CLIENT_X509_CERT_URL'
];

// Error Codes
const ERROR_CODES = {
    // General
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    
    // Service specific
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    CONTROLLER_UNAVAILABLE: 'CONTROLLER_UNAVAILABLE',
    DATABASE_ERROR: 'DATABASE_ERROR',
    FIREBASE_ERROR: 'FIREBASE_ERROR',
    QUEUE_ERROR: 'QUEUE_ERROR',
    
    // Notification specific
    INVALID_TOKEN: 'INVALID_TOKEN',
    INVALID_TOPIC: 'INVALID_TOPIC',
    NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
    NOTIFICATION_ALREADY_PROCESSED: 'NOTIFICATION_ALREADY_PROCESSED',
    
    // Rate limiting
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    
    // External services
    FIREBASE_UNAVAILABLE: 'FIREBASE_UNAVAILABLE',
    REDIS_UNAVAILABLE: 'REDIS_UNAVAILABLE'
};

// Success Messages
const SUCCESS_MESSAGES = {
    NOTIFICATION_QUEUED: 'Notification queued successfully',
    NOTIFICATION_SENT: 'Notification sent successfully',
    NOTIFICATION_CANCELLED: 'Notification cancelled successfully',
    BULK_QUEUED: 'Bulk notifications queued successfully',
    SERVICE_HEALTHY: 'Service is healthy',
    OPERATION_COMPLETED: 'Operation completed successfully'
};

// Default Configuration Values
const DEFAULTS = {
    NOTIFICATION_TYPE: NOTIFICATION_TYPES.GENERAL,
    PRIORITY: PRIORITY_LEVELS.NORMAL,
    RETRY_ATTEMPTS: 3,
    BATCH_SIZE: 100,
    PAGE_SIZE: 50,
    RATE_LIMIT_DELAY: 100, // milliseconds
    TOKEN_CACHE_TTL: 300, // seconds
    WORKER_CONCURRENCY: 5
};

// API Versioning
const API_VERSION = {
    CURRENT: 'v1',
    SUPPORTED: ['v1'],
    DEPRECATED: []
};

// Export all constants
module.exports = {
    HTTP_STATUS,
    NOTIFICATION_STATUS,
    NOTIFICATION_TYPES,
    PRIORITY_LEVELS,
    USER_ROLES,
    QUEUE_PRIORITIES,
    WEBSOCKET_EVENTS,
    QUEUE_EVENTS,
    FIREBASE_SCOPES,
    RATE_LIMITS,
    VALIDATION_RULES,
    CACHE_TTL,
    MAX_RETRIES,
    RETRY_DELAYS,
    MAX_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    DB_CONFIG,
    ENVIRONMENTS,
    LOG_LEVELS,
    FIREBASE_CONFIG_KEYS,
    ERROR_CODES,
    SUCCESS_MESSAGES,
    DEFAULTS,
    API_VERSION
};