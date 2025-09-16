// ==========================================
// SYSTEM CONSTANTS - FIXED FOR FCM TOKENS
// All constants used throughout the microservice
// ==========================================

// ==========================================
// NOTIFICATION CONSTANTS
// ==========================================

const NOTIFICATION_STATUS = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

const NOTIFICATION_TYPES = {
    GENERAL: 'general',
    APPOINTMENT: 'appointment',
    RESULT: 'result',
    EMERGENCY: 'emergency',
    PROMOTION: 'promotion',
    REMINDER: 'reminder',
    TEST: 'test'
};

const PRIORITY_LEVELS = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high'
};

// ==========================================
// QUEUE CONSTANTS
// ==========================================

const QUEUE_PRIORITIES = {
    LOW: 1,
    NORMAL: 5,
    HIGH: 10
};

const QUEUE_EVENTS = {
    JOB_COMPLETED: 'job_completed',
    JOB_FAILED: 'job_failed',
    JOB_PROGRESS: 'job_progress',
    QUEUE_PAUSED: 'queue_paused',
    QUEUE_RESUMED: 'queue_resumed'
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // milliseconds

const MAX_BATCH_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 100;

// ==========================================
// WEBSOCKET CONSTANTS
// ==========================================

const WEBSOCKET_EVENTS = {
    // Connection events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    
    // Subscription events
    SUBSCRIBE_NOTIFICATION: 'subscribe_notification',
    UNSUBSCRIBE_NOTIFICATION: 'unsubscribe_notification',
    SUBSCRIBE_STATS: 'subscribe_stats',
    SUBSCRIBE_LOGS: 'subscribe_logs',
    
    // Notification events
    NOTIFICATION_UPDATE: 'notification_update',
    NOTIFICATION_PROGRESS: 'notification_progress',
    NOTIFICATION_STATUS: 'notification_status',
    
    // Stats events
    STATS_UPDATE: 'stats_update',
    
    // System events
    SYSTEM_ALERT: 'system_alert',
    LOG_MESSAGE: 'log_message',
    
    // User events
    USER_CONNECTED: 'user_connected',
    USER_DISCONNECTED: 'user_disconnected',
    
    // Generic events
    ERROR: 'error',
    SUBSCRIBED: 'subscribed'
};

const USER_ROLES = {
    VIEWER: 'viewer',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin'
};

// ==========================================
// FIREBASE CONSTANTS
// ==========================================

const FIREBASE_SCOPES = [
    'https://www.googleapis.com/auth/firebase.messaging'
];

const FCM_ENDPOINTS = {
    SEND: 'https://fcm.googleapis.com/v1/projects/{projectId}/messages:send',
    LEGACY: 'https://fcm.googleapis.com/fcm/send'
};

const FIREBASE_ERROR_CODES = {
    INVALID_REGISTRATION_TOKEN: 'messaging/invalid-registration-token',
    REGISTRATION_TOKEN_NOT_REGISTERED: 'messaging/registration-token-not-registered',
    INVALID_PACKAGE_NAME: 'messaging/invalid-package-name',
    MESSAGE_RATE_EXCEEDED: 'messaging/message-rate-exceeded',
    DEVICE_MESSAGE_RATE_EXCEEDED: 'messaging/device-message-rate-exceeded',
    TOPICS_MESSAGE_RATE_EXCEEDED: 'messaging/topics-message-rate-exceeded',
    INVALID_APNS_CREDENTIALS: 'messaging/invalid-apns-credentials',
    TOO_MANY_TOPICS: 'messaging/too-many-topics',
    INVALID_ARGUMENT: 'messaging/invalid-argument',
    THIRD_PARTY_AUTH_ERROR: 'messaging/third-party-auth-error',
    QUOTA_EXCEEDED: 'messaging/quota-exceeded',
    UNAVAILABLE: 'messaging/unavailable',
    INTERNAL_ERROR: 'messaging/internal-error'
};

// ==========================================
// VALIDATION CONSTANTS - FIXED FOR FCM
// ==========================================

const VALIDATION_RULES = {
    TITLE_MAX_LENGTH: 100,
    MESSAGE_MAX_LENGTH: 4000,
    
    // FCM Token validation - FIXED for real FCM tokens
    TOKEN_MIN_LENGTH: 50,        // Allow shorter tokens for testing
    TOKEN_MAX_LENGTH: 4096,      // FCM tokens can be up to 4KB
    
    // Multiple patterns for FCM token validation
    // Pattern 1: Specific FCM format (most restrictive)
    FCM_TOKEN_PATTERN: /^[A-Za-z0-9_-]{10,50}:APA91b[A-Za-z0-9_-]{130,200}$/,
    
    // Pattern 2: General FCM format (medium restrictive)
    TOKEN_PATTERN: /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
    
    // Pattern 3: Very permissive for any token-like string
    PERMISSIVE_TOKEN_PATTERN: /^[A-Za-z0-9_:-]{50,4096}$/,
    
    // Other validation patterns
    TOPIC_MAX_LENGTH: 900,
    TOPIC_PATTERN: /^[a-zA-Z0-9-_.~%]{1,900}$/,
    
    USER_ID_MAX_LENGTH: 50,
    USER_ID_PATTERN: /^[a-zA-Z0-9_.-]{1,50}$/,
    
    BULK_MAX_SIZE: 1000,
    EXTRA_DATA_MAX_SIZE: 8192, // 8KB
    
    // Rate limits
    REQUESTS_PER_MINUTE: 1000,
    REQUESTS_PER_HOUR: 10000,
    BULK_REQUESTS_PER_HOUR: 100
};

// ==========================================
// HTTP STATUS CODES
// ==========================================

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

// ==========================================
// ERROR TYPES
// ==========================================

const ERROR_TYPES = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
    CONFLICT_ERROR: 'CONFLICT_ERROR',
    RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
    FIREBASE_ERROR: 'FIREBASE_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    QUEUE_ERROR: 'QUEUE_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// ==========================================
// LOG LEVELS
// ==========================================

const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    VERBOSE: 'verbose'
};

// ==========================================
// CACHE CONSTANTS
// ==========================================

const CACHE_TTL = {
    SHORT: 300, // 5 minutes
    MEDIUM: 1800, // 30 minutes
    LONG: 3600, // 1 hour
    VERY_LONG: 86400 // 24 hours
};

const CACHE_KEYS = {
    USER_TOKENS: 'user_tokens:',
    FIREBASE_CONFIG: 'firebase_config',
    STATS: 'stats:',
    QUEUE_STATUS: 'queue_status',
    SYSTEM_HEALTH: 'system_health'
};

// ==========================================
// RATE LIMITING
// ==========================================

const RATE_LIMITS = {
    API: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // requests per window
        message: 'Too many API requests'
    },
    BULK: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 100, // requests per window
        message: 'Too many bulk requests'
    },
    TEST: {
        windowMs: 60 * 1000, // 1 minute
        max: 10, // requests per window
        message: 'Too many test requests'
    },
    ADMIN: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5000, // requests per window
        message: 'Too many admin requests'
    }
};

// ==========================================
// WEBHOOK CONSTANTS
// ==========================================

const WEBHOOK_EVENTS = {
    NOTIFICATION_SENT: 'notification.sent',
    NOTIFICATION_DELIVERED: 'notification.delivered',
    NOTIFICATION_FAILED: 'notification.failed',
    NOTIFICATION_OPENED: 'notification.opened',
    TOKEN_REFRESH: 'token.refresh',
    TOPIC_SUBSCRIBED: 'topic.subscribed',
    TOPIC_UNSUBSCRIBED: 'topic.unsubscribed'
};

// ==========================================
// ENVIRONMENT CONSTANTS
// ==========================================

const ENVIRONMENTS = {
    DEVELOPMENT: 'development',
    STAGING: 'staging',
    PRODUCTION: 'production',
    TEST: 'test'
};

// ==========================================
// DATABASE CONSTANTS
// ==========================================

const DB_TABLES = {
    NOTIFICATIONS: 'notifications',
    RESPONSES: 'firebase_responses',
    CONFIG: 'config',
    TOKENS: 'access_tokens'
};

// ==========================================
// MONITORING CONSTANTS
// ==========================================

const METRICS = {
    NOTIFICATIONS_SENT: 'notifications_sent_total',
    NOTIFICATIONS_SUCCESS: 'notifications_success_total',
    NOTIFICATIONS_FAILED: 'notifications_failed_total',
    QUEUE_SIZE: 'queue_size',
    PROCESSING_TIME: 'notification_processing_seconds',
    FIREBASE_REQUESTS: 'firebase_requests_total',
    WEBSOCKET_CONNECTIONS: 'websocket_connections_active',
    MEMORY_USAGE: 'process_memory_usage_bytes',
    CPU_USAGE: 'process_cpu_usage_percent'
};

// ==========================================
// TIME CONSTANTS
// ==========================================

const TIME = {
    SECOND: 1000,
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000
};

// ==========================================
// SECURITY CONSTANTS
// ==========================================

const SECURITY = {
    JWT_EXPIRY: '24h',
    API_KEY_LENGTH: 32,
    WEBHOOK_SECRET_LENGTH: 64,
    PASSWORD_MIN_LENGTH: 8,
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    
    CORS_ORIGINS: [
        'http://localhost:3000',
        'http://localhost:8080',
        'https://admin.firebase-microservice.com'
    ],
    
    ALLOWED_HOSTS: [
        'localhost',
        'firebase-microservice.com',
        '*.firebase-microservice.com'
    ]
};

// ==========================================
// FEATURE FLAGS
// ==========================================

const FEATURES = {
    WEBHOOKS_ENABLED: process.env.ENABLE_WEBHOOKS === 'true',
    METRICS_ENABLED: process.env.ENABLE_METRICS === 'true',
    DEBUG_MODE: process.env.NODE_ENV !== 'production',
    RATE_LIMITING: process.env.ENABLE_RATE_LIMITING !== 'false',
    WEBSOCKETS: process.env.ENABLE_WEBSOCKETS !== 'false',
    BULK_OPERATIONS: process.env.ENABLE_BULK_OPERATIONS !== 'false',
    ADMIN_PANEL: process.env.ENABLE_ADMIN_PANEL !== 'false'
};

module.exports = {
    // Notification constants
    NOTIFICATION_STATUS,
    NOTIFICATION_TYPES,
    PRIORITY_LEVELS,
    
    // Queue constants
    QUEUE_PRIORITIES,
    QUEUE_EVENTS,
    MAX_RETRIES,
    RETRY_DELAYS,
    MAX_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    
    // WebSocket constants
    WEBSOCKET_EVENTS,
    USER_ROLES,
    
    // Firebase constants
    FIREBASE_SCOPES,
    FCM_ENDPOINTS,
    FIREBASE_ERROR_CODES,
    
    // Validation constants
    VALIDATION_RULES,
    
    // HTTP constants
    HTTP_STATUS,
    ERROR_TYPES,
    
    // System constants
    LOG_LEVELS,
    CACHE_TTL,
    CACHE_KEYS,
    RATE_LIMITS,
    WEBHOOK_EVENTS,
    ENVIRONMENTS,
    DB_TABLES,
    METRICS,
    TIME,
    SECURITY,
    FEATURES
};