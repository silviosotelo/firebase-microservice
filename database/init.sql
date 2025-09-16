-- ==========================================
-- FIREBASE NOTIFICATION MICROSERVICE
-- Initial Database Schema
-- SQLite Database Structure
-- ==========================================

-- Enable foreign keys support
PRAGMA foreign_keys = ON;

-- ==========================================
-- NOTIFICATIONS TABLE
-- Main table for storing notification requests
-- ==========================================
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE NOT NULL,
    user_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'appointment', 'result', 'emergency', 'promotion', 'reminder')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    
    -- Delivery statistics
    total_sent INTEGER DEFAULT 0,
    successful INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    processing_time INTEGER DEFAULT 0, -- in milliseconds
    
    -- Notification content and metadata
    route TEXT, -- Deep link route
    sound TEXT DEFAULT 'default',
    icon TEXT, -- Icon URL
    image TEXT, -- Image URL
    extra_data TEXT, -- JSON string for additional data
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    completed_at DATETIME,
    
    -- Constraints
    CONSTRAINT check_success_rate CHECK (success_rate >= 0 AND success_rate <= 100),
    CONSTRAINT check_counts CHECK (successful >= 0 AND failed >= 0 AND total_sent >= 0),
    CONSTRAINT check_total_consistency CHECK (total_sent >= (successful + failed))
);

-- ==========================================
-- NOTIFICATION RESPONSES TABLE
-- Individual delivery responses from Firebase
-- ==========================================
CREATE TABLE IF NOT EXISTS notification_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    token TEXT, -- FCM token or topic name
    success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
    message_id TEXT, -- Firebase message ID
    error_code TEXT, -- Firebase error code
    error_message TEXT, -- Error description
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraint
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- ==========================================
-- SYSTEM CONFIGURATION TABLE
-- Key-value store for system settings
-- ==========================================
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    data_type TEXT DEFAULT 'string' CHECK (data_type IN ('string', 'number', 'boolean', 'json')),
    category TEXT DEFAULT 'general',
    is_sensitive INTEGER DEFAULT 0 CHECK (is_sensitive IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- STATISTICS CACHE TABLE
-- Cached statistics for performance
-- ==========================================
CREATE TABLE IF NOT EXISTS stats_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL, -- JSON string
    category TEXT DEFAULT 'general',
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Index for expiration cleanup
    CONSTRAINT check_expiry CHECK (expires_at > created_at)
);

-- ==========================================
-- WEBHOOK LOGS TABLE
-- Log of webhook deliveries and responses
-- ==========================================
CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_name TEXT NOT NULL,
    url TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON string
    http_status INTEGER,
    response_body TEXT,
    response_time INTEGER, -- in milliseconds
    success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- API USAGE LOGS TABLE
-- Track API usage for rate limiting and analytics
-- ==========================================
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_hash TEXT, -- Hashed API key for privacy
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    request_size INTEGER DEFAULT 0,
    response_status INTEGER,
    response_time INTEGER, -- in milliseconds
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Partitioning by date for efficient cleanup
    date_partition TEXT GENERATED ALWAYS AS (DATE(created_at)) STORED
);

-- ==========================================
-- MIGRATIONS TABLE
-- Track applied database migrations
-- ==========================================
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_name TEXT UNIQUE NOT NULL,
    description TEXT,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- PERFORMANCE INDEXES
-- Indexes for query optimization
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

-- Notification responses indexes
CREATE INDEX IF NOT EXISTS idx_responses_notification_id ON notification_responses(notification_id);
CREATE INDEX IF NOT EXISTS idx_responses_success ON notification_responses(success);
CREATE INDEX IF NOT EXISTS idx_responses_token ON notification_responses(token);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON notification_responses(created_at);
CREATE INDEX IF NOT EXISTS idx_responses_notification_success ON notification_responses(notification_id, success);
CREATE INDEX IF NOT EXISTS idx_responses_error_code ON notification_responses(error_code);

-- Statistics cache indexes
CREATE INDEX IF NOT EXISTS idx_stats_cache_key ON stats_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_stats_cache_expires ON stats_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_stats_cache_category ON stats_cache(category);

-- System config indexes
CREATE INDEX IF NOT EXISTS idx_config_category ON system_config(category);
CREATE INDEX IF NOT EXISTS idx_config_updated ON system_config(updated_at);

-- Webhook logs indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_name ON webhook_logs(webhook_name);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_success ON webhook_logs(success);

-- API usage logs indexes
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_usage_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_logs_date_partition ON api_usage_logs(date_partition);
CREATE INDEX IF NOT EXISTS idx_api_logs_ip ON api_usage_logs(ip_address);

-- ==========================================
-- TRIGGERS
-- Automatic timestamp updates and data validation
-- ==========================================

-- Update notifications timestamp trigger
CREATE TRIGGER IF NOT EXISTS update_notifications_timestamp 
    AFTER UPDATE ON notifications
    BEGIN
        UPDATE notifications 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- Update notification responses timestamp trigger
CREATE TRIGGER IF NOT EXISTS update_responses_timestamp 
    AFTER UPDATE ON notification_responses
    BEGIN
        UPDATE notification_responses 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE id = NEW.id;
    END;

-- Update system config timestamp trigger
CREATE TRIGGER IF NOT EXISTS update_config_timestamp 
    AFTER UPDATE ON system_config
    BEGIN
        UPDATE system_config 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE key = NEW.key;
    END;

-- Notification statistics update trigger
CREATE TRIGGER IF NOT EXISTS update_notification_stats
    AFTER INSERT ON notification_responses
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
                SELECT ROUND(
                    (CAST(SUM(success) AS REAL) / COUNT(*)) * 100, 2
                )
                FROM notification_responses 
                WHERE notification_id = NEW.notification_id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.notification_id;
    END;

-- ==========================================
-- VIEWS
-- Convenient views for common queries
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
    END AS total_processing_time_ms
FROM notifications n;

-- Daily statistics view
CREATE VIEW IF NOT EXISTS v_daily_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_notifications,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
    SUM(total_sent) as total_messages_sent,
    SUM(successful) as total_successful,
    SUM(failed) as total_failed,
    ROUND(AVG(success_rate), 2) as avg_success_rate,
    ROUND(AVG(processing_time), 2) as avg_processing_time
FROM notifications
WHERE created_at >= DATE('now', '-30 days')
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Error analysis view
CREATE VIEW IF NOT EXISTS v_error_analysis AS
SELECT 
    nr.error_code,
    nr.error_message,
    COUNT(*) as error_count,
    COUNT(DISTINCT nr.notification_id) as affected_notifications,
    COUNT(DISTINCT nr.token) as affected_tokens,
    MIN(nr.created_at) as first_occurrence,
    MAX(nr.created_at) as last_occurrence
FROM notification_responses nr
WHERE nr.success = 0 
    AND nr.created_at >= DATETIME('now', '-7 days')
GROUP BY nr.error_code, nr.error_message
ORDER BY error_count DESC;

-- ==========================================
-- INITIAL CONFIGURATION DATA
-- Default system configuration values
-- ==========================================

INSERT OR IGNORE INTO system_config (key, value, description, category) VALUES
('firebase_project_id', '', 'Firebase project ID', 'firebase'),
('default_notification_sound', 'default', 'Default notification sound', 'notifications'),
('default_notification_ttl', '86400', 'Default notification TTL in seconds (24 hours)', 'notifications'),
('max_tokens_per_request', '1000', 'Maximum FCM tokens per request', 'limits'),
('max_bulk_notifications', '100', 'Maximum bulk notifications per request', 'limits'),
('rate_limit_window_ms', '900000', 'Rate limit window in milliseconds (15 minutes)', 'rate_limits'),
('rate_limit_max_requests', '1000', 'Maximum requests per rate limit window', 'rate_limits'),
('cache_default_ttl', '300', 'Default cache TTL in seconds (5 minutes)', 'cache'),
('webhook_max_retries', '3', 'Maximum webhook delivery retries', 'webhooks'),
('webhook_timeout_ms', '30000', 'Webhook timeout in milliseconds', 'webhooks'),
('cleanup_retention_days', '30', 'Data retention period in days', 'cleanup'),
('enable_metrics_collection', 'true', 'Enable Prometheus metrics collection', 'monitoring'),
('log_level', 'info', 'Application log level', 'logging'),
('maintenance_mode', 'false', 'System maintenance mode flag', 'system'),
('max_concurrent_notifications', '100', 'Maximum concurrent notification processing', 'performance'),
('database_backup_enabled', 'true', 'Enable automatic database backups', 'backup'),
('websocket_ping_interval', '25000', 'WebSocket ping interval in milliseconds', 'websocket'),
('websocket_ping_timeout', '60000', 'WebSocket ping timeout in milliseconds', 'websocket'),
('queue_concurrency', '10', 'Queue processing concurrency', 'queue'),
('queue_max_attempts', '3', 'Maximum job retry attempts', 'queue');

-- Insert initial migration record
INSERT OR IGNORE INTO migrations (migration_name, description) VALUES
('001_initial_schema', 'Initial database schema creation');

-- ==========================================
-- VACUUM AND ANALYZE
-- Optimize database after initial setup
-- ==========================================

-- Optimize database structure
VACUUM;

-- Update statistics for query planner
ANALYZE;