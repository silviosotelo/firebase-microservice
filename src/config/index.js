// ==========================================
// MAIN CONFIGURATION
// Centralized configuration management
// ==========================================

const path = require('path');
const AppLogger = require('../utils/logger');

class Config {
    constructor() {
        this.logger = new AppLogger('Config');
        this.environment = process.env.NODE_ENV || 'development';
        this.config = {};
        this.initialized = false;
    }

    /**
     * Initialize configuration
     */
    async initialize() {
        try {
            this.logger.info('⚙️ Initializing configuration...');
            
            // Load environment-specific configuration
            this.loadEnvironmentConfig();
            
            // Load default configuration
            this.loadDefaultConfig();
            
            // Validate required configuration
            this.validateConfig();
            
            this.initialized = true;
            this.logger.info('✅ Configuration initialized successfully');
            
            return this.config;

        } catch (error) {
            this.logger.error('❌ Configuration initialization failed:', error);
            throw error;
        }
    }

    /**
     * Load default configuration
     */
    loadDefaultConfig() {
        this.config = {
            // Server configuration
            server: {
                port: parseInt(process.env.PORT) || 3000,
                host: process.env.HOST || '0.0.0.0',
                environment: this.environment,
                cors: {
                    enabled: process.env.ENABLE_CORS !== 'false',
                    origins: this.parseArray(process.env.ALLOWED_ORIGINS, [
                        'http://localhost:3000',
                        'http://localhost:8080'
                    ])
                },
                compression: process.env.ENABLE_COMPRESSION !== 'false',
                helmet: process.env.ENABLE_HELMET !== 'false'
            },

            // Database configuration
            database: {
                path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'firebase_logs.db'),
                backupPath: process.env.DATABASE_BACKUP_PATH || path.join(process.cwd(), 'data', 'backups'),
                retentionDays: parseInt(process.env.DB_RETENTION_DAYS) || 90
            },

            // Redis configuration
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: parseInt(process.env.REDIS_DB) || 0,
                enabled: process.env.REDIS_ENABLED !== 'false'
            },

            // Firebase configuration
            firebase: {
                projectId: process.env.FIREBASE_PROJECT_ID,
                privateKey: process.env.FIREBASE_PRIVATE_KEY,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
            },

            // Queue configuration
            queue: {
                concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 5,
                retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
                retryDelay: parseInt(process.env.RETRY_DELAY) || 2000,
                batchSize: parseInt(process.env.BATCH_SIZE) || 500,
                rateLimitDelay: parseInt(process.env.RATE_LIMIT_DELAY) || 100
            },

            // Notification configuration
            notification: {
                maxTitleLength: parseInt(process.env.MAX_TITLE_LENGTH) || 100,
                maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH) || 4000,
                maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE) || 1000,
                defaultType: process.env.DEFAULT_NOTIFICATION_TYPE || 'general',
                defaultPriority: process.env.DEFAULT_PRIORITY || 'normal'
            },

            // Security configuration
            security: {
                jwtSecret: process.env.JWT_SECRET,
                jwtExpiry: process.env.JWT_EXPIRY || '24h',
                apiKeyLength: parseInt(process.env.API_KEY_LENGTH) || 32,
                webhookSecretLength: parseInt(process.env.WEBHOOK_SECRET_LENGTH) || 64,
                sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 1800000, // 30 minutes
                encryptionKey: process.env.ENCRYPTION_KEY
            },

            // Rate limiting
            rateLimiting: {
                enabled: process.env.ENABLE_RATE_LIMITING !== 'false',
                api: {
                    windowMs: parseInt(process.env.API_RATE_WINDOW) || 900000, // 15 minutes
                    max: parseInt(process.env.API_RATE_MAX) || 1000
                },
                bulk: {
                    windowMs: parseInt(process.env.BULK_RATE_WINDOW) || 3600000, // 1 hour
                    max: parseInt(process.env.BULK_RATE_MAX) || 100
                },
                test: {
                    windowMs: parseInt(process.env.TEST_RATE_WINDOW) || 60000, // 1 minute
                    max: parseInt(process.env.TEST_RATE_MAX) || 10
                }
            },

            // Logging configuration
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                file: {
                    enabled: process.env.FILE_LOGGING !== 'false',
                    path: process.env.LOG_FILE_PATH || 'logs',
                    maxSize: process.env.LOG_MAX_SIZE || '20m',
                    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 14,
                    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
                },
                console: {
                    enabled: process.env.CONSOLE_LOGGING !== 'false',
                    colorize: process.env.LOG_COLORIZE !== 'false',
                    timestamp: process.env.LOG_TIMESTAMP !== 'false'
                }
            },

            // Webhooks configuration
            webhooks: {
                enabled: process.env.ENABLE_WEBHOOKS === 'true',
                timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 30000,
                retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS) || 3,
                retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY) || 5000
            },

            // WebSocket configuration
            websocket: {
                enabled: process.env.ENABLE_WEBSOCKETS !== 'false',
                transports: this.parseArray(process.env.WEBSOCKET_TRANSPORTS, ['websocket', 'polling']),
                pingTimeout: parseInt(process.env.WEBSOCKET_PING_TIMEOUT) || 60000,
                pingInterval: parseInt(process.env.WEBSOCKET_PING_INTERVAL) || 25000
            },

            // Monitoring configuration
            monitoring: {
                enabled: process.env.ENABLE_MONITORING === 'true',
                metricsPath: process.env.METRICS_PATH || '/api/metrics',
                healthPath: process.env.HEALTH_PATH || '/health',
                statsInterval: parseInt(process.env.STATS_INTERVAL) || 5000
            },

            // Feature flags
            features: {
                adminPanel: process.env.ENABLE_ADMIN_PANEL !== 'false',
                bulkOperations: process.env.ENABLE_BULK_OPERATIONS !== 'false',
                tokenValidation: process.env.ENABLE_TOKEN_VALIDATION !== 'false',
                queueManagement: process.env.ENABLE_QUEUE_MANAGEMENT !== 'false',
                exportFeatures: process.env.ENABLE_EXPORT_FEATURES !== 'false'
            },

            // Cache configuration
            cache: {
                enabled: process.env.ENABLE_CACHE !== 'false',
                ttl: {
                    short: parseInt(process.env.CACHE_TTL_SHORT) || 300,
                    medium: parseInt(process.env.CACHE_TTL_MEDIUM) || 1800,
                    long: parseInt(process.env.CACHE_TTL_LONG) || 3600
                }
            }
        };
    }

    /**
     * Load environment-specific configuration
     */
    loadEnvironmentConfig() {
        const envConfigPath = path.join(__dirname, `${this.environment}.js`);
        
        try {
            if (require('fs').existsSync(envConfigPath)) {
                const envConfig = require(envConfigPath);
                this.logger.info(`📄 Loaded environment config: ${this.environment}`);
                return envConfig;
            }
        } catch (error) {
            this.logger.warn(`⚠️ Could not load environment config for ${this.environment}:`, error.message);
        }
        
        return {};
    }

    /**
     * Validate required configuration
     */
    validateConfig() {
        const requiredFields = {
            'server.port': this.config.server.port,
            'database.path': this.config.database.path
        };

        const missingFields = [];

        for (const [field, value] of Object.entries(requiredFields)) {
            if (value === undefined || value === null || value === '') {
                missingFields.push(field);
            }
        }

        if (missingFields.length > 0) {
            throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
        }

        // Validate types
        if (isNaN(this.config.server.port) || this.config.server.port < 1 || this.config.server.port > 65535) {
            throw new Error('Server port must be a valid port number (1-65535)');
        }

        // Validate paths
        try {
            path.resolve(this.config.database.path);
        } catch (error) {
            throw new Error(`Invalid database path: ${this.config.database.path}`);
        }
    }

    /**
     * Get configuration value
     */
    get(keyPath, defaultValue = undefined) {
        const keys = keyPath.split('.');
        let value = this.config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    /**
     * Set configuration value
     */
    set(keyPath, value) {
        const keys = keyPath.split('.');
        let target = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in target) || typeof target[key] !== 'object') {
                target[key] = {};
            }
            target = target[key];
        }

        target[keys[keys.length - 1]] = value;
    }

    /**
     * Get full configuration
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * Get safe configuration (without sensitive data)
     */
    getSafe() {
        const safeConfig = { ...this.config };
        
        // Remove sensitive fields
        if (safeConfig.firebase) {
            safeConfig.firebase.privateKey = safeConfig.firebase.privateKey ? '***HIDDEN***' : undefined;
        }
        
        if (safeConfig.security) {
            safeConfig.security.jwtSecret = safeConfig.security.jwtSecret ? '***HIDDEN***' : undefined;
            safeConfig.security.encryptionKey = safeConfig.security.encryptionKey ? '***HIDDEN***' : undefined;
        }
        
        if (safeConfig.redis && safeConfig.redis.password) {
            safeConfig.redis.password = '***HIDDEN***';
        }

        return safeConfig;
    }

    /**
     * Check if running in production
     */
    isProduction() {
        return this.environment === 'production';
    }

    /**
     * Check if running in development
     */
    isDevelopment() {
        return this.environment === 'development';
    }

    /**
     * Check if running in test mode
     */
    isTest() {
        return this.environment === 'test';
    }

    /**
     * Parse array from string
     */
    parseArray(str, defaultValue = []) {
        if (!str) return defaultValue;
        if (Array.isArray(str)) return str;
        
        try {
            // Try JSON parsing first
            return JSON.parse(str);
        } catch {
            // Fall back to comma-separated values
            return str.split(',').map(item => item.trim());
        }
    }

    /**
     * Parse boolean from string
     */
    parseBoolean(value, defaultValue = false) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
        }
        return defaultValue;
    }

    /**
     * Get environment info
     */
    getEnvironmentInfo() {
        return {
            nodeEnv: this.environment,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: this.initialized,
            initialized: this.initialized,
            environment: this.environment,
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const config = new Config();

module.exports = config;