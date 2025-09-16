// ==========================================
// CONFIGURATION - Configuración Central Simplificada
// Manejo robusto de configuración con fallbacks
// ==========================================

const path = require('path');
const { ENVIRONMENTS, LOG_LEVELS } = require('../utils/constants');

class ConfigurationManager {
    constructor() {
        this.env = process.env.NODE_ENV || ENVIRONMENTS.DEVELOPMENT;
        this._isDevelopment = this.env === ENVIRONMENTS.DEVELOPMENT;
        this._isProduction = this.env === ENVIRONMENTS.PRODUCTION;
        this._isTest = this.env === ENVIRONMENTS.TESTING;
        
        // Load configuration
        this.loadConfiguration();
    }

    loadConfiguration() {
        // Server Configuration
        this.server = {
            port: this.getNumber('PORT', 3000),
            host: this.getString('HOST', '0.0.0.0'),
            environment: this.env,
            logLevel: this.getString('LOG_LEVEL', LOG_LEVELS.INFO)
        };

        // Database Configuration
        this.database = {
            path: this.getString('DATABASE_PATH', './data/firebase_logs.db'),
            retentionDays: this.getNumber('DB_RETENTION_DAYS', 90),
            backupInterval: this.getNumber('DB_BACKUP_INTERVAL_HOURS', 24),
            vacuumInterval: this.getNumber('DB_VACUUM_INTERVAL_HOURS', 168) // 1 week
        };

        // Rate Limiting Configuration
        this.rateLimit = {
            enabled: this.getBoolean('ENABLE_RATE_LIMITING', !this._isDevelopment),
            api: {
                windowMs: this.getNumber('API_RATE_WINDOW', 15 * 60 * 1000), // 15 minutes
                max: this.getNumber('API_RATE_MAX', this._isDevelopment ? 10000 : 1000)
            },
            bulk: {
                windowMs: this.getNumber('BULK_RATE_WINDOW', 60 * 60 * 1000), // 1 hour
                max: this.getNumber('BULK_RATE_MAX', this._isDevelopment ? 100 : 10)
            }
        };

        // CORS Configuration
        this.cors = {
            origins: this.getArray('ALLOWED_ORIGINS', 
                this._isDevelopment ? ['*'] : ['http://localhost:3000']
            ),
            credentials: this.getBoolean('CORS_CREDENTIALS', true)
        };

        // Redis Configuration (Optional)
        this.redis = {
            enabled: this.getBoolean('REDIS_ENABLED', false),
            host: this.getString('REDIS_HOST', 'localhost'),
            port: this.getNumber('REDIS_PORT', 6379),
            password: this.getString('REDIS_PASSWORD', ''),
            db: this.getNumber('REDIS_DB', 0)
        };

        // Queue Configuration
        this.queue = {
            workerConcurrency: this.getNumber('WORKER_CONCURRENCY', 5),
            batchSize: this.getNumber('BATCH_SIZE', 100),
            retryAttempts: this.getNumber('RETRY_ATTEMPTS', 3),
            rateLimitDelay: this.getNumber('RATE_LIMIT_DELAY', 100),
            maxNotificationsPerBatch: this.getNumber('MAX_NOTIFICATIONS_PER_BATCH', 1000)
        };

        // Firebase Configuration
        this.firebase = {
            projectId: this.getString('FIREBASE_PROJECT_ID', ''),
            privateKey: this.getString('FIREBASE_PRIVATE_KEY', ''),
            clientEmail: this.getString('FIREBASE_CLIENT_EMAIL', ''),
            clientId: this.getString('FIREBASE_CLIENT_ID', ''),
            authUri: this.getString('FIREBASE_AUTH_URI', ''),
            tokenUri: this.getString('FIREBASE_TOKEN_URI', ''),
            authProviderX509CertUrl: this.getString('FIREBASE_AUTH_PROVIDER_X509_CERT_URL', ''),
            clientX509CertUrl: this.getString('FIREBASE_CLIENT_X509_CERT_URL', '')
        };

        // Authentication Configuration
        this.auth = {
            enabled: this.getBoolean('AUTH_ENABLED', !this._isDevelopment),
            apiKeys: {
                user: this.getString('API_KEY_USER', 'user-key-456'),
                admin: this.getString('API_KEY_ADMIN', 'admin-key-789'),
                superAdmin: this.getString('API_KEY_SUPER_ADMIN', 'super-admin-key-101')
            },
            jwt: {
                secret: this.getString('JWT_SECRET', 'default-jwt-secret-for-dev'),
                expiresIn: this.getString('JWT_EXPIRES_IN', '24h')
            },
            webhook: {
                secret: this.getString('WEBHOOK_SECRET', '')
            }
        };

        // Features Configuration
        this.features = {
            adminPanel: this.getBoolean('ENABLE_ADMIN_PANEL', true),
            websockets: this.getBoolean('ENABLE_WEBSOCKETS', true),
            monitoring: this.getBoolean('ENABLE_MONITORING', false),
            webhooks: this.getBoolean('ENABLE_WEBHOOKS', false),
            stats: this.getBoolean('ENABLE_STATS', true)
        };

        // Logging Configuration
        this.logging = {
            level: this.getString('LOG_LEVEL', this._isDevelopment ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO),
            file: this.getBoolean('LOG_TO_FILE', true),
            filePath: this.getString('LOG_FILE_PATH', './logs/app.log'),
            maxFiles: this.getNumber('LOG_MAX_FILES', 5),
            maxSize: this.getString('LOG_MAX_SIZE', '10m')
        };

        // Security Configuration
        this.security = {
            helmet: {
                enabled: this.getBoolean('HELMET_ENABLED', true),
                contentSecurityPolicy: this.getBoolean('CSP_ENABLED', !this._isDevelopment)
            },
            encryption: {
                key: this.getString('ENCRYPTION_KEY', 'default-encryption-key-for-dev')
            }
        };

        // Notification Configuration
        this.notifications = {
            defaultType: this.getString('DEFAULT_NOTIFICATION_TYPE', 'general'),
            defaultPriority: this.getString('DEFAULT_PRIORITY', 'normal'),
            maxTitleLength: this.getNumber('MAX_TITLE_LENGTH', 100),
            maxMessageLength: this.getNumber('MAX_MESSAGE_LENGTH', 4000),
            tokenCacheTTL: this.getNumber('TOKEN_CACHE_TTL', 300) // 5 minutes
        };
    }

    // Helper methods for environment variable parsing
    getString(key, defaultValue = '') {
        return process.env[key] || defaultValue;
    }

    getNumber(key, defaultValue = 0) {
        const value = process.env[key];
        if (value === undefined || value === '') return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    getBoolean(key, defaultValue = false) {
        const value = process.env[key];
        if (value === undefined || value === '') return defaultValue;
        return value.toLowerCase() === 'true' || value === '1';
    }

    getArray(key, defaultValue = []) {
        const value = process.env[key];
        if (!value) return defaultValue;
        
        try {
            // Try JSON parsing first
            return JSON.parse(value);
        } catch {
            // Fall back to comma-separated
            return value.split(',').map(item => item.trim()).filter(Boolean);
        }
    }

    getObject(key, defaultValue = {}) {
        const value = process.env[key];
        if (!value) return defaultValue;
        
        try {
            return JSON.parse(value);
        } catch {
            return defaultValue;
        }
    }

    // Validation methods
    isFirebaseConfigured() {
        return !!(
            this.firebase.projectId &&
            this.firebase.privateKey &&
            this.firebase.clientEmail
        );
    }

    isRedisConfigured() {
        return this.redis.enabled && !!(this.redis.host && this.redis.port);
    }

    isAuthenticationEnabled() {
        return this.auth.enabled && !this._isDevelopment;
    }

    // Configuration getters for easy access
    get isDev() {
        return this._isDevelopment;
    }

    get isProd() {
        return this._isProduction;
    }

    get isTest() {
        return this._isTest;
    }

    // Export configuration as plain object
    toObject() {
        return {
            server: this.server,
            database: this.database,
            rateLimit: this.rateLimit,
            cors: this.cors,
            redis: this.redis,
            queue: this.queue,
            firebase: this.firebase,
            auth: this.auth,
            features: this.features,
            logging: this.logging,
            security: this.security,
            notifications: this.notifications,
            environment: {
                isDevelopment: this._isDevelopment,
                isProduction: this._isProduction,
                isTest: this._isTest
            }
        };
    }

    // Get configuration summary for health checks
    getHealthSummary() {
        return {
            environment: this.env,
            features: {
                firebase: this.isFirebaseConfigured(),
                redis: this.isRedisConfigured(),
                auth: this.isAuthenticationEnabled(),
                websockets: this.features.websockets,
                monitoring: this.features.monitoring
            },
            services: {
                database: !!this.database.path,
                logging: this.logging.file,
                rateLimiting: this.rateLimit.enabled
            }
        };
    }

    // Validate configuration
    validate() {
        const errors = [];

        // Required configurations
        if (!this.server.port || this.server.port < 1 || this.server.port > 65535) {
            errors.push('Invalid server port');
        }

        if (!this.database.path) {
            errors.push('Database path is required');
        }

        // Firebase validation (only if trying to use it)
        if (this.firebase.projectId && !this.isFirebaseConfigured()) {
            errors.push('Incomplete Firebase configuration');
        }

        // Redis validation (only if enabled)
        if (this.redis.enabled && !this.isRedisConfigured()) {
            errors.push('Incomplete Redis configuration');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Update configuration at runtime
    updateConfig(updates) {
        try {
            Object.keys(updates).forEach(key => {
                if (this.hasOwnProperty(key) && typeof this[key] === 'object') {
                    Object.assign(this[key], updates[key]);
                }
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    // Get configuration for specific service
    getServiceConfig(serviceName) {
        const serviceConfigs = {
            database: this.database,
            redis: this.redis,
            firebase: this.firebase,
            queue: this.queue,
            auth: this.auth,
            logging: this.logging,
            notifications: this.notifications
        };

        return serviceConfigs[serviceName] || {};
    }
}

// Create singleton instance
const config = new ConfigurationManager();

// Validate configuration on load
const validation = config.validate();
if (!validation.valid && config.isProduction) {
    console.error('❌ Configuration validation failed:', validation.errors);
    // In development, just warn; in production, you might want to exit
    if (config._isProduction) {
        process.exit(1);
    }
}

// Export configuration instance and class
module.exports = config;
module.exports.ConfigurationManager = ConfigurationManager;