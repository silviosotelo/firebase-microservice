// ==========================================
// WEBSOCKET EVENTS
// WebSocket event definitions and constants
// ==========================================

/**
 * Server-to-Client Events
 * Events that the server emits to clients
 */
const SERVER_EVENTS = {
    // Connection events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    
    // Authentication events
    AUTHENTICATED: 'authenticated',
    AUTHENTICATION_FAILED: 'authentication_failed',
    
    // Notification events
    NOTIFICATION_CREATED: 'notification_created',
    NOTIFICATION_UPDATED: 'notification_updated',
    NOTIFICATION_PROGRESS: 'notification_progress',
    NOTIFICATION_COMPLETED: 'notification_completed',
    NOTIFICATION_FAILED: 'notification_failed',
    NOTIFICATION_CANCELLED: 'notification_cancelled',
    
    // Queue events
    QUEUE_STATUS_UPDATED: 'queue_status_updated',
    QUEUE_JOB_ADDED: 'queue_job_added',
    QUEUE_JOB_COMPLETED: 'queue_job_completed',
    QUEUE_JOB_FAILED: 'queue_job_failed',
    
    // Statistics events
    STATS_UPDATED: 'stats_updated',
    REALTIME_STATS: 'realtime_stats',
    DASHBOARD_DATA_UPDATED: 'dashboard_data_updated',
    
    // System events
    SYSTEM_ALERT: 'system_alert',
    SYSTEM_STATUS_CHANGED: 'system_status_changed',
    SYSTEM_MAINTENANCE_MODE: 'system_maintenance_mode',
    
    // Error events
    ERROR: 'error',
    VALIDATION_ERROR: 'validation_error',
    RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
    
    // Log events (admin only)
    LOG_ENTRY: 'log_entry',
    LOG_STREAM: 'log_stream'
};

/**
 * Client-to-Server Events
 * Events that clients can emit to the server
 */
const CLIENT_EVENTS = {
    // Authentication
    AUTHENTICATE: 'authenticate',
    
    // Subscriptions
    SUBSCRIBE_NOTIFICATIONS: 'subscribe_notifications',
    UNSUBSCRIBE_NOTIFICATIONS: 'unsubscribe_notifications',
    SUBSCRIBE_STATS: 'subscribe_stats',
    UNSUBSCRIBE_STATS: 'unsubscribe_stats',
    SUBSCRIBE_QUEUE: 'subscribe_queue',
    UNSUBSCRIBE_QUEUE: 'unsubscribe_queue',
    SUBSCRIBE_LOGS: 'subscribe_logs',
    UNSUBSCRIBE_LOGS: 'unsubscribe_logs',
    
    // User-specific subscriptions
    SUBSCRIBE_USER_NOTIFICATIONS: 'subscribe_user_notifications',
    UNSUBSCRIBE_USER_NOTIFICATIONS: 'unsubscribe_user_notifications',
    
    // Notification management
    GET_NOTIFICATION_STATUS: 'get_notification_status',
    CANCEL_NOTIFICATION: 'cancel_notification',
    RETRY_NOTIFICATION: 'retry_notification',
    
    // Dashboard requests
    GET_DASHBOARD_DATA: 'get_dashboard_data',
    GET_REALTIME_STATS: 'get_realtime_stats',
    
    // Admin actions
    PAUSE_QUEUE: 'pause_queue',
    RESUME_QUEUE: 'resume_queue',
    CLEAR_FAILED_JOBS: 'clear_failed_jobs',
    
    // Health checks
    PING: 'ping',
    GET_SYSTEM_STATUS: 'get_system_status'
};

/**
 * Event Data Schemas
 * Defines the structure of event payloads
 */
const EVENT_SCHEMAS = {
    // Notification events
    NOTIFICATION_CREATED: {
        notificationId: 'string',
        requestId: 'string',
        title: 'string',
        type: 'string',
        priority: 'string',
        status: 'string',
        createdAt: 'string',
        estimatedProcessingTime: 'number'
    },
    
    NOTIFICATION_UPDATED: {
        notificationId: 'string',
        requestId: 'string',
        update: {
            status: 'string',
            totalSent: 'number',
            successful: 'number',
            failed: 'number',
            successRate: 'number',
            updatedAt: 'string'
        }
    },
    
    NOTIFICATION_PROGRESS: {
        notificationId: 'string',
        requestId: 'string',
        progress: {
            percent: 'number',
            processed: 'number',
            total: 'number',
            currentBatch: 'number',
            totalBatches: 'number'
        }
    },
    
    // Stats events
    STATS_UPDATED: {
        type: 'string', // 'general', 'queue', 'error', 'performance'
        stats: 'object',
        timestamp: 'string'
    },
    
    REALTIME_STATS: {
        notifications: {
            total: 'number',
            queued: 'number',
            processing: 'number',
            completed: 'number',
            failed: 'number'
        },
        queue: {
            waiting: 'number',
            active: 'number',
            completed: 'number',
            failed: 'number'
        },
        system: {
            uptime: 'number',
            memory: 'number',
            connections: 'number'
        },
        timestamp: 'string'
    },
    
    // System events
    SYSTEM_ALERT: {
        level: 'string', // 'info', 'warning', 'error', 'critical'
        message: 'string',
        code: 'string',
        timestamp: 'string',
        details: 'object'
    },
    
    // Queue events
    QUEUE_STATUS_UPDATED: {
        queueName: 'string',
        status: {
            waiting: 'number',
            active: 'number',
            completed: 'number',
            failed: 'number',
            paused: 'boolean'
        },
        timestamp: 'string'
    },
    
    // Log events
    LOG_ENTRY: {
        level: 'string',
        message: 'string',
        timestamp: 'string',
        module: 'string',
        metadata: 'object'
    }
};

/**
 * Event Priorities
 * For rate limiting and throttling
 */
const EVENT_PRIORITIES = {
    HIGH: 1,    // System alerts, errors
    NORMAL: 2,  // Notification updates, stats
    LOW: 3      // Debug info, verbose logs
};

/**
 * Room Names
 * WebSocket rooms for different types of subscriptions
 */
const ROOMS = {
    // General rooms
    ALL_USERS: 'all_users',
    ADMINS: 'admins',
    SUPER_ADMINS: 'super_admins',
    
    // Feature-specific rooms
    NOTIFICATIONS: 'notifications',
    STATS: 'stats',
    QUEUE: 'queue',
    LOGS: 'logs',
    DASHBOARD: 'dashboard',
    
    // User-specific rooms (prefix)
    USER_PREFIX: 'user_',
    
    // Type-specific rooms
    NOTIFICATION_TYPE_PREFIX: 'type_',
    PRIORITY_PREFIX: 'priority_'
};

/**
 * Rate Limits
 * Per-event rate limiting configuration
 */
const RATE_LIMITS = {
    // Client event limits (events per minute)
    CLIENT_EVENTS: {
        [CLIENT_EVENTS.PING]: { limit: 60, window: 60000 },
        [CLIENT_EVENTS.GET_REALTIME_STATS]: { limit: 30, window: 60000 },
        [CLIENT_EVENTS.GET_NOTIFICATION_STATUS]: { limit: 100, window: 60000 },
        [CLIENT_EVENTS.GET_DASHBOARD_DATA]: { limit: 10, window: 60000 },
        [CLIENT_EVENTS.CANCEL_NOTIFICATION]: { limit: 20, window: 60000 },
        [CLIENT_EVENTS.RETRY_NOTIFICATION]: { limit: 10, window: 60000 }
    },
    
    // Server event limits (events per second to same client)
    SERVER_EVENTS: {
        [SERVER_EVENTS.REALTIME_STATS]: { limit: 2, window: 1000 },
        [SERVER_EVENTS.NOTIFICATION_PROGRESS]: { limit: 10, window: 1000 },
        [SERVER_EVENTS.LOG_ENTRY]: { limit: 50, window: 1000 }
    }
};

/**
 * Event Validation Rules
 */
const VALIDATION_RULES = {
    [CLIENT_EVENTS.AUTHENTICATE]: {
        required: ['token'],
        optional: ['role']
    },
    
    [CLIENT_EVENTS.SUBSCRIBE_USER_NOTIFICATIONS]: {
        required: ['userId'],
        optional: ['types', 'priorities']
    },
    
    [CLIENT_EVENTS.GET_NOTIFICATION_STATUS]: {
        required: ['notificationId'],
        optional: []
    },
    
    [CLIENT_EVENTS.CANCEL_NOTIFICATION]: {
        required: ['notificationId'],
        optional: ['reason']
    },
    
    [CLIENT_EVENTS.RETRY_NOTIFICATION]: {
        required: ['notificationId'],
        optional: ['options']
    }
};

/**
 * Error Codes
 * WebSocket-specific error codes
 */
const ERROR_CODES = {
    // Authentication errors
    AUTH_REQUIRED: 'WS_AUTH_REQUIRED',
    INVALID_TOKEN: 'WS_INVALID_TOKEN',
    INSUFFICIENT_PERMISSIONS: 'WS_INSUFFICIENT_PERMISSIONS',
    
    // Validation errors
    INVALID_EVENT: 'WS_INVALID_EVENT',
    MISSING_DATA: 'WS_MISSING_DATA',
    INVALID_DATA_FORMAT: 'WS_INVALID_DATA_FORMAT',
    
    // Rate limiting errors
    RATE_LIMIT_EXCEEDED: 'WS_RATE_LIMIT_EXCEEDED',
    TOO_MANY_SUBSCRIPTIONS: 'WS_TOO_MANY_SUBSCRIPTIONS',
    
    // System errors
    INTERNAL_ERROR: 'WS_INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'WS_SERVICE_UNAVAILABLE',
    MAINTENANCE_MODE: 'WS_MAINTENANCE_MODE',
    
    // Subscription errors
    ALREADY_SUBSCRIBED: 'WS_ALREADY_SUBSCRIBED',
    NOT_SUBSCRIBED: 'WS_NOT_SUBSCRIBED',
    SUBSCRIPTION_LIMIT_EXCEEDED: 'WS_SUBSCRIPTION_LIMIT_EXCEEDED'
};

/**
 * Helper functions for event handling
 */
const EventHelpers = {
    /**
     * Create a notification event payload
     */
    createNotificationEvent(type, notificationData) {
        return {
            type,
            notificationId: notificationData.id,
            requestId: notificationData.requestId,
            ...notificationData,
            timestamp: new Date().toISOString()
        };
    },
    
    /**
     * Create a stats event payload
     */
    createStatsEvent(type, statsData) {
        return {
            type,
            stats: statsData,
            timestamp: new Date().toISOString()
        };
    },
    
    /**
     * Create a system alert event payload
     */
    createSystemAlert(level, message, code = null, details = {}) {
        return {
            level,
            message,
            code,
            details,
            timestamp: new Date().toISOString()
        };
    },
    
    /**
     * Create a queue status event payload
     */
    createQueueStatusEvent(queueName, status) {
        return {
            queueName,
            status,
            timestamp: new Date().toISOString()
        };
    },
    
    /**
     * Create a log entry event payload
     */
    createLogEntry(level, message, module, metadata = {}) {
        return {
            level,
            message,
            module,
            metadata,
            timestamp: new Date().toISOString()
        };
    },
    
    /**
     * Get room name for user
     */
    getUserRoom(userId) {
        return `${ROOMS.USER_PREFIX}${userId}`;
    },
    
    /**
     * Get room name for notification type
     */
    getTypeRoom(type) {
        return `${ROOMS.NOTIFICATION_TYPE_PREFIX}${type}`;
    },
    
    /**
     * Get room name for priority
     */
    getPriorityRoom(priority) {
        return `${ROOMS.PRIORITY_PREFIX}${priority}`;
    },
    
    /**
     * Validate event data
     */
    validateEventData(eventName, data) {
        const rules = VALIDATION_RULES[eventName];
        if (!rules) {
            return { valid: true };
        }
        
        const errors = [];
        
        // Check required fields
        for (const field of rules.required) {
            if (!(field in data)) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // Check for unknown fields
        const allowedFields = [...rules.required, ...rules.optional];
        for (const field in data) {
            if (!allowedFields.includes(field)) {
                errors.push(`Unknown field: ${field}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    },
    
    /**
     * Check if event is rate limited
     */
    isRateLimited(eventName, clientId, rateLimitStore) {
        const limits = RATE_LIMITS.CLIENT_EVENTS[eventName];
        if (!limits) {
            return false;
        }
        
        const key = `${clientId}:${eventName}`;
        const now = Date.now();
        
        // Get or initialize rate limit data
        let rateLimitData = rateLimitStore.get(key) || { count: 0, windowStart: now };
        
        // Reset window if expired
        if (now - rateLimitData.windowStart > limits.window) {
            rateLimitData = { count: 0, windowStart: now };
        }
        
        // Check limit
        if (rateLimitData.count >= limits.limit) {
            return true;
        }
        
        // Increment counter
        rateLimitData.count++;
        rateLimitStore.set(key, rateLimitData);
        
        return false;
    }
};

module.exports = {
    SERVER_EVENTS,
    CLIENT_EVENTS,
    EVENT_SCHEMAS,
    EVENT_PRIORITIES,
    ROOMS,
    RATE_LIMITS,
    VALIDATION_RULES,
    ERROR_CODES,
    EventHelpers
};