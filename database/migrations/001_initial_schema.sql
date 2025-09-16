-- ==========================================
-- MIGRATION 001: Initial Schema
-- Firebase Notification Microservice
-- Database Migration for SQLite
-- ==========================================

-- This migration creates the initial database schema
-- It's designed to be idempotent and safe to run multiple times

-- ==========================================
-- ENABLE FOREIGN KEYS
-- ==========================================
PRAGMA foreign_keys = ON;

-- ==========================================
-- CREATE CORE TABLES
-- ==========================================

-- Notifications table (main entity)
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE NOT NULL,
    user_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'general',
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'queued',
    
    -- Delivery statistics
    total_sent INTEGER DEFAULT 0,
    successful INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    processing_time INTEGER DEFAULT 0,
    
    -- Content and metadata
    route TEXT,
    sound TEXT DEFAULT 'default',
    icon TEXT,
    image TEXT,
    extra_data TEXT, -- JSON
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    completed_at DATETIME,
    
    -- Constraints
    CHECK (type IN ('general', 'appointment', 'result', 'emergency', 'promotion', 'reminder')),
    CHECK (priority IN ('low', 'normal', 'high')),
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    CHECK (success_rate >= 0 AND success_rate <= 100),
    CHECK (successful >= 0 AND failed >= 0 AND total_sent >= 0),
    CHECK (total_sent >= (successful + failed))
);

-- Individual notification responses
CREATE TABLE IF NOT EXISTS notification_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    token TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    message_id TEXT,
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    CHECK (success IN (0, 1)),
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- System configuration
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    data_type TEXT DEFAULT 'string',
    category TEXT DEFAULT 'general',
    is_sensitive INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    CHECK (data_type IN ('string', 'number', 'boolean', 'json')),
    CHECK (is_sensitive IN (0, 1))
);

-- Statistics cache
CREATE TABLE IF NOT EXISTS stats_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    CHECK (expires_at > created_at)
);

-- Webhook logs
CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_name TEXT NOT NULL,
    url TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    http_status INTEGER,
    response_body TEXT,
    response_time INTEGER,
    success INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    CHECK (success IN (0, 1))
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_hash TEXT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    request_size INTEGER DEFAULT 0,
    response_status INTEGER,
    response_time INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_partition TEXT GENERATED ALWAYS AS (DATE(created_at)) STORED
);

-- ==========================================
-- CREATE INDEXES
-- ==========================================

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_request_id ON notifications(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status_created ON notifications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status);

-- Responses indexes
CREATE INDEX IF NOT EXISTS idx_responses_notification_id ON notification_responses(notification_id);
CREATE INDEX IF NOT EXISTS idx_responses_success ON notification_responses(success);
CREATE INDEX IF NOT EXISTS idx_responses_token ON notification_responses(token);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON notification_responses(created_at);
CREATE INDEX IF NOT EXISTS idx_responses_notification_success ON notification_responses(notification_id, success);
CREATE INDEX IF NOT EXISTS idx_responses_error_code ON notification_responses(error_code);

-- Cache indexes
CREATE INDEX IF NOT EXISTS idx_stats_cache_key ON stats_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_stats_cache_expires ON stats_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_stats_cache_category ON stats_cache(category);

-- Config indexes
CREATE INDEX IF NOT EXISTS idx_config_category ON system_config(category);
CREATE INDEX IF NOT EXISTS idx_config_updated ON system_config(updated_at);

-- Webhook logs indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_name ON webhook_logs(webhook_name);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_success ON webhook_logs(success);

-- API logs indexes
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_usage_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_logs_date_partition ON api_usage_logs(date_partition);
CREATE INDEX IF NOT EXISTS idx_api_logs_ip ON api_usage_logs(ip_address);

-- ==========================================
-- CREATE TRIGGERS
-- ==========================================

-- Auto-update timestamps
CREATE TRIGGER IF NOT EXISTS update_notifications_timestamp 
    AFTER UPDATE ON notifications
    FOR EACH ROW
    BEGIN
        UPDATE notifications 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_responses_timestamp 
    AFTER UPDATE ON notification_responses
    FOR EACH ROW
    BEGIN
        UPDATE notification_responses 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_config_timestamp 
    AFTER UPDATE ON system_config
    FOR EACH ROW
    BEGIN
        UPDATE system_config 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE key = NEW.key;
    END;

-- Auto-update notification statistics when responses change
CREATE TRIGGER IF NOT EXISTS update_notification_stats_insert
    AFTER INSERT ON notification_responses
    FOR EACH ROW
    BEGIN
        UPDATE notifications 
        SET 
            total_sent = (
                SELECT COUNT(*) 
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id
            ),
            successful = (
                SELECT COUNT(*) 
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id AND success = 1
            ),
            failed = (
                SELECT COUNT(*) 
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id AND success = 0
            ),
            success_rate = (
                SELECT CASE 
                    WHEN COUNT(*) = 0 THEN 0
                    ELSE ROUND((CAST(SUM(success) AS REAL) / COUNT(*)) * 100, 2)
                END
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.notification_id;
    END;

CREATE TRIGGER IF NOT EXISTS update_notification_stats_update
    AFTER UPDATE ON notification_responses
    FOR EACH ROW
    BEGIN
        UPDATE notifications 
        SET 
            successful = (
                SELECT COUNT(*) 
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id AND success = 1
            ),
            failed = (
                SELECT COUNT(*) 
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id AND success = 0
            ),
            success_rate = (
                SELECT CASE 
                    WHEN COUNT(*) = 0 THEN 0
                    ELSE ROUND((CAST(SUM(success) AS REAL) / COUNT(*)) * 100, 2)
                END
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.notification_id;
    END;

-- ==========================================
-- CREATE VIEWS
-- ==========================================

-- Notification summary view
CREATE VIEW IF NOT EXISTS v_notification_summary AS
SELECT 
    n.id,
    n.request_id,
    n.user_id,
    n.title,
    n.type,
    n.priority,
    n.status,
    n.total_sent,
    n.successful,
    n.failed,
    n.success_rate,
    n.processing_time,
    n.created_at,
    n.completed_at,
    CASE 
        WHEN n.status = 'completed' AND n.completed_at IS NOT NULL 
        THEN ROUND((JULIANDAY(n.completed_at) - JULIANDAY(n.created_at)) * 86400000)
        ELSE NULL 
    END AS total_processing_time_ms,
    CASE
        WHEN n.status = 'queued' THEN 'Pending'
        WHEN n.status = 'processing' THEN 'In Progress'
        WHEN n.status = 'completed' THEN 'Completed'
        WHEN n.status = 'failed' THEN 'Failed'
        WHEN n.status = 'cancelled' THEN 'Cancelled'
        ELSE 'Unknown'
    END AS status_display
FROM notifications n;

-- Daily statistics view for dashboard
CREATE VIEW IF NOT EXISTS v_daily_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_notifications,
    SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
    SUM(total_sent) as total_messages_sent,
    SUM(successful) as total_successful,
    SUM(failed) as total_failed,
    ROUND(AVG(CASE WHEN success_rate > 0 THEN success_rate END), 2) as avg_success_rate,
    ROUND(AVG(CASE WHEN processing_time > 0 THEN processing_time END), 2) as avg_processing_time_ms
FROM notifications
WHERE created_at >= DATE('now', '-30 days')
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Hourly statistics view for real-time charts
CREATE VIEW IF NOT EXISTS v_hourly_stats AS
SELECT 
    DATETIME(STRFTIME('%Y-%m-%d %H:00:00', created_at)) as hour,
    COUNT(*) as total_notifications,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(total_sent) as total_messages_sent,
    SUM(successful) as total_successful,
    ROUND(AVG(CASE WHEN success_rate > 0 THEN success_rate END), 2) as avg_success_rate
FROM notifications
WHERE created_at >= DATETIME('now', '-24 hours')
GROUP BY STRFTIME('%Y-%m-%d %H', created_at)
ORDER BY hour DESC;

-- Error analysis view for troubleshooting
CREATE VIEW IF NOT EXISTS v_error_analysis AS
SELECT 
    nr.error_code,
    nr.error_message,
    COUNT(*) as error_count,
    COUNT(DISTINCT nr.notification_id) as affected_notifications,
    COUNT(DISTINCT nr.token) as affected_tokens,
    MIN(nr.created_at) as first_occurrence,
    MAX(nr.created_at) as last_occurrence,
    ROUND(AVG(nr.retry_count), 1) as avg_retry_count
FROM notification_responses nr
WHERE nr.success = 0 
    AND nr.created_at >= DATETIME('now', '-7 days')
    AND nr.error_code IS NOT NULL
GROUP BY nr.error_code, nr.error_message
ORDER BY error_count DESC;

-- User activity summary
CREATE VIEW IF NOT EXISTS v_user_activity AS
SELECT 
    user_id,
    COUNT(*) as total_notifications,
    SUM(total_sent) as total_messages,
    SUM(successful) as successful_messages,
    ROUND(AVG(success_rate), 2) as avg_success_rate,
    MIN(created_at) as first_notification,
    MAX(created_at) as last_notification,
    COUNT(DISTINCT type) as notification_types_used
FROM notifications
WHERE user_id IS NOT NULL
    AND created_at >= DATE('now', '-30 days')
GROUP BY user_id
ORDER BY total_notifications DESC;

-- ==========================================
-- INSERT DEFAULT CONFIGURATION
-- ==========================================

INSERT OR IGNORE INTO system_config (key, value, description, category, data_type) VALUES
-- Firebase Configuration
('firebase_project_id', '', 'Firebase project ID for FCM', 'firebase', 'string'),
('firebase_server_key', '', 'Firebase server key (legacy)', 'firebase', 'string'),
('firebase_service_account_path', '', 'Path to Firebase service account JSON', 'firebase', 'string'),

-- Notification Defaults
('default_notification_sound', 'default', 'Default notification sound', 'notifications', 'string'),
('default_notification_ttl', '86400', 'Default notification TTL in seconds (24 hours)', 'notifications', 'number'),
('default_notification_priority', 'normal', 'Default notification priority', 'notifications', 'string'),

-- Rate Limits
('max_tokens_per_request', '1000', 'Maximum FCM tokens per request', 'limits', 'number'),
('max_bulk_notifications', '100', 'Maximum bulk notifications per request', 'limits', 'number'),
('max_message_length', '4000', 'Maximum notification message length', 'limits', 'number'),
('max_title_length', '100', 'Maximum notification title length', 'limits', 'number'),

-- API Rate Limiting
('rate_limit_window_ms', '900000', 'Rate limit window in milliseconds (15 minutes)', 'rate_limits', 'number'),
('rate_limit_max_requests', '1000', 'Maximum requests per rate limit window', 'rate_limits', 'number'),
('bulk_rate_limit_window_ms', '3600000', 'Bulk rate limit window (1 hour)', 'rate_limits', 'number'),
('bulk_rate_limit_max_requests', '10', 'Maximum bulk requests per window', 'rate_limits', 'number'),

-- Cache Configuration
('cache_default_ttl', '300', 'Default cache TTL in seconds (5 minutes)', 'cache', 'number'),
('stats_cache_ttl', '300', 'Statistics cache TTL in seconds', 'cache', 'number'),

-- Webhook Configuration
('webhook_max_retries', '3', 'Maximum webhook delivery retries', 'webhooks', 'number'),
('webhook_timeout_ms', '30000', 'Webhook timeout in milliseconds', 'webhooks', 'number'),
('webhook_retry_delay_ms', '5000', 'Webhook retry delay in milliseconds', 'webhooks', 'number'),

-- Data Retention
('cleanup_retention_days', '30', 'Data retention period in days', 'cleanup', 'number'),
('log_retention_days', '14', 'Log retention period in days', 'cleanup', 'number'),
('cache_cleanup_interval', '3600', 'Cache cleanup interval in seconds', 'cleanup', 'number'),

-- Monitoring
('enable_metrics_collection', 'true', 'Enable Prometheus metrics collection', 'monitoring', 'boolean'),
('metrics_collection_interval', '30', 'Metrics collection interval in seconds', 'monitoring', 'number'),

-- Logging
('log_level', 'info', 'Application log level', 'logging', 'string'),
('log_format', 'json', 'Log output format', 'logging', 'string'),
('enable_request_logging', 'true', 'Enable HTTP request logging', 'logging', 'boolean'),

-- System Settings
('maintenance_mode', 'false', 'System maintenance mode flag', 'system', 'boolean'),
('max_concurrent_notifications', '100', 'Maximum concurrent notification processing', 'performance', 'number'),
('queue_concurrency', '10', 'Queue processing concurrency', 'queue', 'number'),
('queue_max_attempts', '3', 'Maximum job retry attempts', 'queue', 'number'),

-- Database
('database_backup_enabled', 'true', 'Enable automatic database backups', 'backup', 'boolean'),
('database_backup_interval', '86400', 'Database backup interval in seconds (daily)', 'backup', 'number'),

-- WebSocket
('websocket_ping_interval', '25000', 'WebSocket ping interval in milliseconds', 'websocket', 'number'),
('websocket_ping_timeout', '60000', 'WebSocket ping timeout in milliseconds', 'websocket', 'number'),
('websocket_max_connections', '1000', 'Maximum WebSocket connections', 'websocket', 'number'),

-- Firebase Cloud Messaging
('fcm_max_concurrent_requests', '100', 'Maximum concurrent FCM requests', 'fcm', 'number'),
('fcm_request_timeout', '30000', 'FCM request timeout in milliseconds', 'fcm', 'number'),
('fcm_retry_attempts', '3', 'FCM retry attempts for failed requests', 'fcm', 'number'),
('fcm_batch_size', '500', 'FCM batch size for bulk operations', 'fcm', 'number');

-- ==========================================
-- OPTIMIZE DATABASE
-- ==========================================

-- Update table statistics
ANALYZE;

-- Compact database
PRAGMA optimize;