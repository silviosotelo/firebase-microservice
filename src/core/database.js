// ==========================================
// CORE DATABASE MODULE - Optimized & Robust
// Simplified SQLite implementation with better error handling
// ==========================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const AppLogger = require('../utils/logger');

class DatabaseCore {
    constructor() {
        this.logger = new AppLogger('DatabaseCore');
        this.db = null;
        this.dbPath = this.getDatabasePath();
        this.initialized = false;
        this.models = null;
        
        // Connection pool settings
        this.maxConnections = 10;
        this.connectionTimeout = 30000;
        
        // Prepared statements cache
        this.statements = new Map();
    }

    /**
     * Get database path with fallback
     */
    getDatabasePath() {
        const envPath = process.env.DATABASE_PATH;
        
        if (envPath) {
            return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
        }

        const defaultPath = path.join(process.cwd(), 'data', 'firebase_logs.db');
        
        // Ensure data directory exists
        const dataDir = path.dirname(defaultPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        return defaultPath;
    }

    /**
     * Initialize database connection
     */
    async initialize() {
        if (this.initialized) {
            this.logger.info('🗄️ Database already initialized');
            return this.models;
        }

        try {
            this.logger.info('🗄️ Initializing database...');
            this.logger.info(`📍 Database path: ${this.dbPath}`);
            
            await this.connect();
            await this.initializeSchema();
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
        return new Promise((resolve, reject) => {
            try {
                this.db = new sqlite3.Database(this.dbPath, (err) => {
                    if (err) {
                        this.logger.error('❌ SQLite connection failed:', err);
                        reject(err);
                        return;
                    }

                    this.logger.info('✅ SQLite database connected');
                    
                    // Configure database settings
                    this.db.serialize(() => {
                        this.db.run('PRAGMA journal_mode = WAL');
                        this.db.run('PRAGMA synchronous = NORMAL');
                        this.db.run('PRAGMA cache_size = 10000');
                        this.db.run('PRAGMA foreign_keys = ON');
                        this.db.run('PRAGMA temp_store = memory');
                    });

                    resolve();
                });

                // Set timeout
                this.db.configure('busyTimeout', this.connectionTimeout);

            } catch (error) {
                this.logger.error('❌ Database connection error:', error);
                reject(error);
            }
        });
    }

    /**
     * Initialize database schema
     */
    async initializeSchema() {
        return new Promise((resolve, reject) => {
            const schema = `
                -- Notifications table
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT UNIQUE NOT NULL,
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
                    processing_time REAL DEFAULT 0,
                    firebase_response TEXT,
                    error_message TEXT,
                    scheduled_at DATETIME,
                    started_at DATETIME,
                    completed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                -- Firebase responses table
                CREATE TABLE IF NOT EXISTS firebase_responses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    notification_id INTEGER NOT NULL,
                    token TEXT,
                    success INTEGER DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    firebase_message_id TEXT,
                    attempt_number INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
                );

                -- Configuration table
                CREATE TABLE IF NOT EXISTS config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    description TEXT,
                    type TEXT DEFAULT 'string',
                    encrypted INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                -- Jobs table for queue management
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
                    scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    started_at DATETIME,
                    completed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
                );

                -- Create indexes for performance
                CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
                CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
                CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
                CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
                CREATE INDEX IF NOT EXISTS idx_notifications_request ON notifications(request_id);
                
                CREATE INDEX IF NOT EXISTS idx_responses_notification ON firebase_responses(notification_id);
                CREATE INDEX IF NOT EXISTS idx_responses_token ON firebase_responses(token);
                CREATE INDEX IF NOT EXISTS idx_responses_success ON firebase_responses(success);
                
                CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority DESC, scheduled_at ASC);
                CREATE INDEX IF NOT EXISTS idx_jobs_notification ON jobs(notification_id);
                CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
                
                CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);

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

            this.db.exec(schema, (err) => {
                if (err) {
                    this.logger.error('❌ Schema initialization failed:', err);
                    reject(err);
                    return;
                }

                this.logger.info('✅ Database schema initialized');
                this.insertDefaultConfig();
                resolve();
            });
        });
    }

    /**
     * Insert default configuration
     */
    insertDefaultConfig() {
        const defaultConfigs = [
            ['BATCH_SIZE', '500', 'Default batch size for notifications', 'number'],
            ['RETRY_ATTEMPTS', '3', 'Number of retry attempts', 'number'],
            ['WORKER_CONCURRENCY', '5', 'Number of concurrent workers', 'number'],
            ['TOKEN_CACHE_TTL', '300', 'Token cache TTL in seconds', 'number'],
            ['LOG_LEVEL', 'info', 'Application log level', 'string'],
            ['ENABLE_WEBHOOKS', 'false', 'Enable webhook notifications', 'boolean']
        ];

        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO config (key, value, description, type) 
            VALUES (?, ?, ?, ?)
        `);

        defaultConfigs.forEach(([key, value, description, type]) => {
            stmt.run(key, value, description, type);
        });

        stmt.finalize();
        this.logger.info('✅ Default configuration inserted');
    }

    /**
     * Initialize models
     */
    async initializeModels() {
        try {
            const NotificationModel = require('../models/notification');
            const ResponseModel = require('../models/response');
            const ConfigModel = require('../models/config');
            
            this.models = {
                Notification: new NotificationModel(this.db),
                Response: new ResponseModel(this.db),
                Config: new ConfigModel(this.db)
            };

            this.logger.info('✅ Models initialized');
            
        } catch (error) {
            this.logger.error('❌ Models initialization failed:', error);
            throw error;
        }
    }

    /**
     * Get database connection
     */
    getConnection() {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        return this.db;
    }

    /**
     * Get models
     */
    getModels() {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        return this.models;
    }

    /**
     * Execute query with promise wrapper
     */
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Execute single query
     */
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Execute insert/update/delete
     */
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.initialized) {
                return { healthy: false, error: 'Database not initialized' };
            }

            const result = await this.get('SELECT 1 as test');
            
            return {
                healthy: true,
                database: 'sqlite3',
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
     * Close database connection
     */
    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        this.logger.error('❌ Error closing database:', err);
                    } else {
                        this.logger.info('✅ Database connection closed');
                    }
                    this.db = null;
                    this.models = null;
                    this.initialized = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// Create singleton instance
const databaseCore = new DatabaseCore();

module.exports = databaseCore;