// ==========================================
// DATABASE CONFIGURATION
// SQLite configuration and connection management
// ==========================================

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AppLogger = require('../utils/logger');

class DatabaseConfig {
    constructor() {
        this.logger = new AppLogger('DatabaseConfig');
        this.dbPath = this.getDatabasePath();
        this.db = null;
        this.models = null;
        this.initialized = false;
    }

    /**
     * Get database path from environment or default
     */
    getDatabasePath() {
        const envPath = process.env.DATABASE_PATH;
        
        if (envPath) {
            // Resolve relative paths
            return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
        }

        // Default path
        const defaultPath = path.join(process.cwd(), 'data', 'firebase_logs.db');
        
        // Ensure data directory exists
        const dataDir = path.dirname(defaultPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        return defaultPath;
    }

/**
 * Initialize database schema
 */
initializeSchema() {
    const schema = `
        -- Notifications table
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT UNIQUE,
            user_id TEXT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'general',
            method TEXT CHECK (method IN ('token', 'topic', 'multicast')),
            target_data TEXT, -- JSON
            extra_data TEXT, -- JSON
            priority TEXT DEFAULT 'normal',
            total_sent INTEGER DEFAULT 0,
            successful INTEGER DEFAULT 0,
            failed INTEGER DEFAULT 0,
            success_rate REAL DEFAULT 0,
            processing_time REAL DEFAULT 0,
            firebase_response TEXT, -- JSON
            error_message TEXT,
            status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
            retry_of INTEGER,
            retry_count INTEGER DEFAULT 0,
            scheduled_at DATETIME,
            started_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (retry_of) REFERENCES notifications (id)
        );

        -- Jobs table for SQLite Queue Service
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL CHECK (type IN ('notification', 'bulk', 'retry')),
            notification_id INTEGER, -- Can be NULL for bulk jobs
            payload TEXT NOT NULL, -- JSON data
            priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
            scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
            worker_id TEXT, -- NULL when not being processed
            started_at DATETIME, -- When processing started
            completed_at DATETIME, -- When job completed
            attempts INTEGER NOT NULL DEFAULT 0,
            error_message TEXT, -- Error details for failed jobs
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
        );

        -- Firebase responses table
        CREATE TABLE IF NOT EXISTS firebase_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_id INTEGER NOT NULL,
            token TEXT,
            success BOOLEAN NOT NULL,
            error_code TEXT,
            error_message TEXT,
            firebase_message_id TEXT,
            attempt_number INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
        );

        -- Configuration table
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            type TEXT DEFAULT 'string' CHECK (type IN ('string', 'number', 'boolean', 'json', 'array')),
            encrypted BOOLEAN DEFAULT FALSE,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Indexes for notifications performance
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
        CREATE INDEX IF NOT EXISTS idx_notifications_request ON notifications(request_id);
        
        -- Indexes for jobs performance (optimized for queue operations)
        CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority DESC, scheduled_at ASC);
        CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_at) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id) WHERE status = 'processing';
        CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
        CREATE INDEX IF NOT EXISTS idx_jobs_notification ON jobs(notification_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);
        
        -- Indexes for firebase responses
        CREATE INDEX IF NOT EXISTS idx_responses_notification ON firebase_responses(notification_id);
        CREATE INDEX IF NOT EXISTS idx_responses_token ON firebase_responses(token);
        CREATE INDEX IF NOT EXISTS idx_responses_success ON firebase_responses(success);

        -- Triggers for updated_at
        CREATE TRIGGER IF NOT EXISTS trigger_notifications_updated_at 
            AFTER UPDATE ON notifications
        BEGIN
            UPDATE notifications SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trigger_jobs_updated_at 
            AFTER UPDATE ON jobs
        BEGIN
            UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trigger_config_updated_at 
            AFTER UPDATE ON config
        BEGIN
            UPDATE config SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
        END;
    `;

    this.db.exec(schema);
    this.insertDefaultConfig();
}

    /**
     * Insert default configuration values
     */
    insertDefaultConfig() {
        try {
            const defaultConfigs = [
                ['SCHEMA_VERSION', '1', 'Database schema version', 'number', false],
                ['FIREBASE_PROJECT_ID', '', 'Firebase Project ID', 'string', false],
                ['FIREBASE_PRIVATE_KEY', '', 'Service Account Private Key', 'string', true],
                ['FIREBASE_CLIENT_EMAIL', '', 'Service Account Email', 'string', false],
                ['BATCH_SIZE', '500', 'Maximum batch size for multicast', 'number', false],
                ['RETRY_ATTEMPTS', '3', 'Number of retry attempts', 'number', false],
                ['RATE_LIMIT_DELAY', '100', 'Delay between requests (ms)', 'number', false],
                ['WORKER_CONCURRENCY', '5', 'Number of concurrent workers', 'number', false],
                ['TOKEN_CACHE_TTL', '300', 'Token cache TTL in seconds', 'number', false],
                ['ENABLE_WEBHOOKS', 'false', 'Enable webhook notifications', 'boolean', false],
                ['WEBHOOK_URL', '', 'Webhook endpoint URL', 'string', false],
                ['LOG_LEVEL', 'info', 'Application log level', 'string', false],
                ['STATS_RETENTION_DAYS', '90', 'Statistics retention period', 'number', false],
                // Agregar al array defaultConfigs en insertDefaultConfig():
                ['QUEUE_WORKER_CONCURRENCY', '3', 'Number of queue workers', 'number', false],
                ['QUEUE_POLL_INTERVAL', '1000', 'Queue polling interval (ms)', 'number', false],
                ['QUEUE_MAX_POLL_INTERVAL', '10000', 'Maximum queue polling interval (ms)', 'number', false],
                ['QUEUE_CLEANUP_HOURS', '24', 'Hours to keep completed jobs', 'number', false],
                ['QUEUE_MAX_ATTEMPTS', '3', 'Default max attempts for jobs', 'number', false],
            ];

            const insertConfig = this.db.prepare(`
                INSERT OR IGNORE INTO config (key, value, description, type, encrypted) 
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const [key, value, description, type, encrypted] of defaultConfigs) {
                // Convert boolean to integer for SQLite
                const encryptedInt = encrypted ? 1 : 0;
                insertConfig.run(key, value, description, type, encryptedInt);
            }
            
        } catch (configError) {
            this.logger.error('❌ Default config insertion failed:');
            this.logger.error(`❌ Config Error: ${configError.message}`);
            throw new Error(`Default config insertion failed: ${configError.message}`);
        }
    }

    /**
     * Initialize database
     */
    async initialize() {
        if (this.initialized) {
            this.logger.info('🗄️ Database already initialized');
            return this.models;
        }

        try {
            this.logger.info('🗄️ Initializing database connection...');
            this.logger.info(`📍 Database path: ${this.dbPath}`);
            
            // Verify directory exists and is writable
            const dbDir = path.dirname(this.dbPath);
            this.logger.info(`📁 Database directory: ${dbDir}`);
            
            if (!fs.existsSync(dbDir)) {
                this.logger.info('📁 Creating database directory...');
                fs.mkdirSync(dbDir, { recursive: true });
            }

            // Test write permissions
            try {
                const testFile = path.join(dbDir, 'test_write.tmp');
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                this.logger.info('✅ Write permissions verified');
            } catch (permError) {
                throw new Error(`No write permissions in ${dbDir}: ${permError.message}`);
            }

            // Create database connection
            this.logger.info('🔗 Creating SQLite connection...');
            try {
                this.db = new Database(this.dbPath, { 
                    verbose: null,
                    fileMustExist: false 
                });
                this.logger.info('📄 SQLite database file created/opened');
                
                // Test connection
                const testResult = this.db.prepare('SELECT 1 as test').get();
                this.logger.info(`🔍 Connection test result: ${JSON.stringify(testResult)}`);
                this.logger.info('✅ Database connection established');
                
            } catch (sqliteError) {
                this.logger.error('❌ SQLite connection failed:');
                this.logger.error(`❌ SQLite Error Code: ${sqliteError.code}`);
                this.logger.error(`❌ SQLite Error Message: ${sqliteError.message}`);
                this.logger.error(`❌ SQLite Stack: ${sqliteError.stack}`);
                throw new Error(`SQLite connection failed: ${sqliteError.message}`);
            }

            // Set pragmas
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('foreign_keys = ON');
            this.logger.info('⚙️ Database pragmas configured');

            // Initialize schema
            this.logger.info('📋 Initializing database schema...');
            this.initializeSchema();
            this.logger.info('✅ Database schema initialized');
            
            // Initialize models with DB connection AFTER schema is created
            this.logger.info('🏗️ Importing model classes...');
            const NotificationModel = require('../models/notification');
            const ResponseModel = require('../models/response');
            const ConfigModel = require('../models/config');
            this.logger.info('✅ Model classes imported');
            
            this.logger.info('🏗️ Initializing models...');
            this.models = {
                Notification: new NotificationModel(this.db),
                Response: new ResponseModel(this.db),
                Config: new ConfigModel(this.db)
            };
            this.logger.info('✅ Models initialized');
            
            this.initialized = true;
            this.logger.info(`✅ Database fully initialized: ${this.dbPath}`);
            
            return this.models;

        } catch (error) {
            this.logger.error(`❌ Database initialization failed: ${this.dbPath}`);
            this.logger.error(`❌ Error details:`, error);
            
            // Cleanup on failure
            if (this.db) {
                try {
                    this.db.close();
                } catch (closeError) {
                    this.logger.error('❌ Error closing database on cleanup:', closeError);
                }
                this.db = null;
            }
            
            throw error;
        }
    }

    /**
     * Get database connection
     */
    getConnection() {
        if (!this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.db;
    }

    /**
     * Get models
     */
    getModels() {
        if (!this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.models;
    }

    /**
     * Close database connection
     */
    async close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.models = null;
            this.initialized = false;
            this.logger.info('🗄️ Database connection closed');
        }
    }

    /**
     * Get database information
     */
    getInfo() {
        return {
            path: this.dbPath,
            initialized: this.initialized,
            size: this.getDatabaseSize(),
            exists: fs.existsSync(this.dbPath)
        };
    }

    /**
     * Get database file size
     */
    getDatabaseSize() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const stats = fs.statSync(this.dbPath);
                return stats.size;
            }
            return 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Backup database
     */
    async backup(backupPath = null) {
        try {
            if (!fs.existsSync(this.dbPath)) {
                throw new Error('Database file does not exist');
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const defaultBackupPath = path.join(
                path.dirname(this.dbPath),
                'backups',
                `firebase_logs_${timestamp}.db`
            );

            const finalBackupPath = backupPath || defaultBackupPath;
            
            // Ensure backup directory exists
            const backupDir = path.dirname(finalBackupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Copy database file
            fs.copyFileSync(this.dbPath, finalBackupPath);
            
            this.logger.info(`💾 Database backed up to: ${finalBackupPath}`);
            
            return {
                success: true,
                backupPath: finalBackupPath,
                size: fs.statSync(finalBackupPath).size
            };

        } catch (error) {
            this.logger.error('❌ Database backup failed:', error);
            throw error;
        }
    }

    /**
     * Get database schema version
     */
    getSchemaVersion() {
        try {
            if (!this.initialized || !this.models) {
                return null;
            }

            return this.models.Config.get('SCHEMA_VERSION') || 1;

        } catch (error) {
            return 1; // Default version
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.initialized) {
                return {
                    healthy: false,
                    error: 'Database not initialized'
                };
            }

            const result = this.db.prepare('SELECT 1 as test').get();
            
            return {
                healthy: result.test === 1,
                path: this.dbPath,
                size: this.getDatabaseSize(),
                schemaVersion: this.getSchemaVersion(),
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Create singleton instance
let databaseConfig = null;

function getDatabaseConfig() {
    if (!databaseConfig) {
        databaseConfig = new DatabaseConfig();
    }
    return databaseConfig;
}

module.exports = getDatabaseConfig();