// ==========================================
// DATABASE CONFIGURATION - VERSIÓN ROBUSTA
// Configuración simplificada y a prueba de errores
// ==========================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const AppLogger = require('../utils/logger');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.models = null;
        this.dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'firebase_logs.db');
        this.logger = new AppLogger('DatabaseManager');
        this.initialized = false;
    }

    /**
     * Initialize database connection and models
     */
    async initialize() {
        try {
            this.logger.info('📊 Initializing database...');
            
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
                this.logger.info(`📁 Created data directory: ${dataDir}`);
            }

            // Connect to database
            await this.connect();
            
            // Initialize schema
            await this.initializeSchema();
            
            // Initialize models
            await this.initializeModels();
            
            this.initialized = true;
            this.logger.info('✅ Database initialized successfully');
            
            return this.models;
            
        } catch (error) {
            this.logger.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    /**
     * Connect to SQLite database
     */
    async connect() {
        try {
            this.logger.info(`🔌 Connecting to database: ${this.dbPath}`);
            
            this.db = new Database(this.dbPath, {
                verbose: this.logger.debug.bind(this.logger),
                fileMustExist: false
            });

            // Configure database settings
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 1000');
            this.db.pragma('temp_store = memory');
            this.db.pragma('foreign_keys = ON');

            this.logger.info('✅ Database connected successfully');
            
        } catch (error) {
            this.logger.error('❌ Database connection failed:', error);
            throw error;
        }
    }

    /**
     * Initialize database schema
     */
    async initializeSchema() {
        try {
            this.logger.info('📋 Initializing database schema...');
            
            // Notifications table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT UNIQUE,
                    user_id TEXT,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    type TEXT DEFAULT 'general',
                    method TEXT,
                    target_data TEXT,
                    extra_data TEXT,
                    priority TEXT DEFAULT 'normal',
                    status TEXT DEFAULT 'queued',
                    total_sent INTEGER DEFAULT 0,
                    successful INTEGER DEFAULT 0,
                    failed INTEGER DEFAULT 0,
                    success_rate REAL DEFAULT 0,
                    processing_time REAL,
                    firebase_response TEXT,
                    error_message TEXT,
                    scheduled_at TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Firebase responses table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS firebase_responses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    notification_id INTEGER,
                    token TEXT,
                    success INTEGER DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    firebase_message_id TEXT,
                    attempt_number INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
                )
            `);

            // Configuration table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    description TEXT,
                    type TEXT DEFAULT 'string',
                    encrypted INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Jobs table for queue
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT UNIQUE NOT NULL,
                    type TEXT NOT NULL,
                    notification_id INTEGER,
                    payload TEXT NOT NULL,
                    priority INTEGER DEFAULT 5,
                    status TEXT DEFAULT 'pending',
                    worker_id TEXT,
                    attempts INTEGER DEFAULT 0,
                    max_attempts INTEGER DEFAULT 3,
                    error_message TEXT,
                    scheduled_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    started_at TEXT,
                    completed_at TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
                )
            `);

            // Users table (basic)
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT UNIQUE NOT NULL,
                    email TEXT,
                    name TEXT,
                    role TEXT DEFAULT 'user',
                    active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // API keys table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS api_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_id TEXT UNIQUE NOT NULL,
                    key_hash TEXT NOT NULL,
                    name TEXT,
                    role TEXT DEFAULT 'user',
                    active INTEGER DEFAULT 1,
                    last_used_at TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT
                )
            `);

            // Create indexes for better performance
            this.createIndexes();

            this.logger.info('✅ Database schema initialized');
            
        } catch (error) {
            this.logger.error('❌ Schema initialization failed:', error);
            throw error;
        }
    }

    /**
     * Create database indexes
     */
    createIndexes() {
        try {
            // Indexes for notifications
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_request_id ON notifications(request_id)');

            // Indexes for responses
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_responses_notification_id ON firebase_responses(notification_id)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_responses_token ON firebase_responses(token)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_responses_success ON firebase_responses(success)');

            // Indexes for jobs
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority)');

            // Indexes for config
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_config_key ON config(key)');

            this.logger.info('✅ Database indexes created');
            
        } catch (error) {
            this.logger.warn('⚠️ Index creation failed:', error);
        }
    }

    /**
     * Initialize models
     */
    async initializeModels() {
        try {
            this.logger.info('📦 Initializing models...');
            
            // Import model classes
            const { NotificationModel, ResponseModel, ConfigModel } = require('../models');
            
            // Initialize models with database connection
            this.models = {
                Notification: new NotificationModel(this.db),
                Response: new ResponseModel(this.db),
                Config: new ConfigModel(this.db)
            };

            this.logger.info('✅ Models initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Models initialization failed:', error);
            
            // Create fallback models
            this.models = {
                Notification: this.createFallbackNotificationModel(),
                Response: this.createFallbackResponseModel(),
                Config: this.createFallbackConfigModel()
            };
            
            this.logger.warn('⚠️ Using fallback models');
        }
    }

    /**
     * Create fallback notification model
     */
    createFallbackNotificationModel() {
        return {
            create: async (data) => {
                const stmt = this.db.prepare(`
                    INSERT INTO notifications (request_id, user_id, title, message, type, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);
                const result = stmt.run(
                    data.request_id || `req_${Date.now()}`,
                    data.user_id,
                    data.title,
                    data.message,
                    data.type || 'general',
                    data.status || 'queued'
                );
                return { id: result.lastInsertRowid, ...data };
            },
            
            findById: async (id) => {
                const stmt = this.db.prepare('SELECT * FROM notifications WHERE id = ?');
                return stmt.get(id);
            },
            
            updateStatus: async (id, status) => {
                const stmt = this.db.prepare('UPDATE notifications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
                stmt.run(status, id);
                return true;
            },
            
            updateWithResult: async (id, result) => {
                const stmt = this.db.prepare(`
                    UPDATE notifications SET 
                        status = ?, total_sent = ?, successful = ?, failed = ?, 
                        success_rate = ?, processing_time = ?, error_message = ?,
                        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `);
                stmt.run(
                    result.status, result.total_sent || 0, result.successful || 0, 
                    result.failed || 0, result.success_rate || 0, result.processing_time || 0,
                    result.error_message, id
                );
                return true;
            },
            
            findMany: async (options) => {
                const { limit = 50, offset = 0 } = options;
                const stmt = this.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?');
                const data = stmt.all(limit, offset);
                const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM notifications');
                const { total } = countStmt.get();
                return { data, total };
            }
        };
    }

    /**
     * Create fallback response model
     */
    createFallbackResponseModel() {
        return {
            create: async (data) => {
                const stmt = this.db.prepare(`
                    INSERT INTO firebase_responses (notification_id, token, success, error_code, error_message)
                    VALUES (?, ?, ?, ?, ?)
                `);
                const result = stmt.run(
                    data.notification_id,
                    data.token,
                    data.success ? 1 : 0,
                    data.error_code,
                    data.error_message
                );
                return result.lastInsertRowid;
            },
            
            getByNotificationId: async (notificationId) => {
                const stmt = this.db.prepare('SELECT * FROM firebase_responses WHERE notification_id = ?');
                return stmt.all(notificationId);
            }
        };
    }

    /**
     * Create fallback config model
     */
    createFallbackConfigModel() {
        return {
            get: async (key) => {
                const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
                const result = stmt.get(key);
                return result ? result.value : null;
            },
            
            set: async (key, value, description = null) => {
                const stmt = this.db.prepare(`
                    INSERT OR REPLACE INTO config (key, value, description, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                `);
                stmt.run(key, value, description);
                return true;
            },
            
            getAll: async () => {
                const stmt = this.db.prepare('SELECT * FROM config ORDER BY key');
                return stmt.all();
            }
        };
    }

    /**
     * Get database connection
     */
    getConnection() {
        return this.db;
    }

    /**
     * Get models
     */
    getModels() {
        return this.models;
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.db) {
                return { healthy: false, error: 'Database not connected' };
            }

            const result = this.db.prepare('SELECT 1 as test').get();
            
            return {
                healthy: true,
                database: 'sqlite',
                path: this.dbPath,
                test: result.test,
                initialized: this.initialized,
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

    /**
     * Insert default data
     */
    async insertDefaults() {
        try {
            this.logger.info('📋 Inserting default data...');
            
            // Insert default config
            const configStmt = this.db.prepare(`
                INSERT OR IGNORE INTO config (key, value, description) VALUES (?, ?, ?)
            `);
            
            configStmt.run('BATCH_SIZE', '500', 'Default batch size for notifications');
            configStmt.run('RETRY_ATTEMPTS', '3', 'Default retry attempts');
            configStmt.run('ENABLE_WEBHOOKS', 'false', 'Enable webhook notifications');
            configStmt.run('LOG_LEVEL', 'info', 'Application log level');
            
            // Insert default user
            const userStmt = this.db.prepare(`
                INSERT OR IGNORE INTO users (user_id, email, name, role) VALUES (?, ?, ?, ?)
            `);
            
            userStmt.run('admin', 'admin@example.com', 'Administrator', 'admin');
            
            this.logger.info('✅ Default data inserted');
            
        } catch (error) {
            this.logger.warn('⚠️ Failed to insert default data:', error.message);
        }
    }

    /**
     * Backup database
     */
    async backup(backupPath = null) {
        try {
            if (!backupPath) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                backupPath = path.join(path.dirname(this.dbPath), `backup-${timestamp}.db`);
            }

            await this.db.backup(backupPath);
            this.logger.info(`💾 Database backed up to: ${backupPath}`);
            
            return backupPath;
            
        } catch (error) {
            this.logger.error('❌ Database backup failed:', error);
            throw error;
        }
    }

    /**
     * Vacuum database
     */
    vacuum() {
        try {
            this.db.exec('VACUUM');
            this.logger.info('🧹 Database vacuumed');
        } catch (error) {
            this.logger.error('❌ Database vacuum failed:', error);
        }
    }

    /**
     * Close database connection
     */
    async close() {
        try {
            if (this.db) {
                this.db.close();
                this.db = null;
                this.models = null;
                this.initialized = false;
                this.logger.info('✅ Database connection closed');
            }
        } catch (error) {
            this.logger.error('❌ Failed to close database:', error);
        }
    }
}

// Create singleton instance
const databaseManager = new DatabaseManager();

module.exports = databaseManager;