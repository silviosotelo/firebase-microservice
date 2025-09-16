// ==========================================
// WEBSOCKET CONFIGURATION
// Socket.IO configuration and options
// ==========================================

const AppLogger = require('../utils/logger');
const config = require('./index');

class WebSocketConfig {
    constructor() {
        this.logger = new AppLogger('WebSocketConfig');
        this.options = {};
        this.initialized = false;
    }

    /**
     * Initialize WebSocket configuration
     */
    initialize() {
        try {
            this.logger.info('🔌 Initializing WebSocket configuration...');
            
            this.options = this.buildSocketOptions();
            this.initialized = true;
            
            this.logger.info('✅ WebSocket configuration initialized');
            
            return this.options;

        } catch (error) {
            this.logger.error('❌ WebSocket configuration failed:', error);
            throw error;
        }
    }

    /**
     * Build Socket.IO options
     */
    buildSocketOptions() {
        const wsConfig = config.get('websocket', {});
        const serverConfig = config.get('server', {});

        return {
            // CORS configuration
            cors: {
                origin: serverConfig.cors?.origins || ['http://localhost:3000'],
                methods: ['GET', 'POST'],
                credentials: true,
                allowedHeaders: ['Content-Type', 'Authorization']
            },

            // Transport configuration
            transports: wsConfig.transports || ['websocket', 'polling'],

            // Connection options
            pingTimeout: wsConfig.pingTimeout || 60000,
            pingInterval: wsConfig.pingInterval || 25000,
            
            // Upgrade timeout
            upgradeTimeout: wsConfig.upgradeTimeout || 10000,
            
            // Max HTTP buffer size
            maxHttpBufferSize: wsConfig.maxHttpBufferSize || 1e6, // 1MB
            
            // Allow upgrades
            allowUpgrades: wsConfig.allowUpgrades !== false,
            
            // Compression
            compression: wsConfig.compression !== false,
            
            // Perfer compression
            perMessageDeflate: wsConfig.perMessageDeflate !== false,
            
            // HTTP compression threshold
            httpCompression: wsConfig.httpCompression !== false,
            
            // Cookie configuration
            cookie: {
                name: wsConfig.cookieName || 'firebase-ws',
                httpOnly: wsConfig.cookieHttpOnly !== false,
                sameSite: wsConfig.cookieSameSite || 'strict',
                secure: config.isProduction(),
                maxAge: wsConfig.cookieMaxAge || 3600000 // 1 hour
            },

            // Rate limiting
            rateLimit: this.buildRateLimitOptions(),

            // Connection state recovery
            connectionStateRecovery: {
                maxDisconnectionDuration: wsConfig.maxDisconnectionDuration || 2 * 60 * 1000, // 2 minutes
                skipMiddlewares: true
            },

            // Server options
            serveClient: config.isDevelopment(),
            
            // Adapter options (for clustering)
            adapter: this.buildAdapterOptions()
        };
    }

    /**
     * Build rate limiting options
     */
    buildRateLimitOptions() {
        const rateLimitConfig = config.get('rateLimiting', {});
        
        if (!rateLimitConfig.enabled) {
            return undefined;
        }

        return {
            // Max connections per IP
            maxConnectionsPerIp: rateLimitConfig.websocket?.maxConnectionsPerIp || 50,
            
            // Max events per connection per minute
            maxEventsPerMinute: rateLimitConfig.websocket?.maxEventsPerMinute || 100,
            
            // Burst allowance
            burstAllowance: rateLimitConfig.websocket?.burstAllowance || 10
        };
    }

    /**
     * Build adapter options
     */
    buildAdapterOptions() {
        const redisConfig = config.get('redis', {});
        
        if (!redisConfig.enabled) {
            return undefined;
        }

        // Redis adapter configuration for clustering
        return {
            type: 'redis',
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db || 1, // Use different DB for WebSocket
            key: 'firebase-ws'
        };
    }

    /**
     * Get namespace configurations
     */
    getNamespaceConfigs() {
        return {
            // Main namespace (default)
            '/': {
                // Default namespace options
            },

            // Admin namespace
            '/admin': {
                // Admin-specific middleware will handle auth
                middleware: ['adminAuth']
            },

            // Public stats namespace
            '/stats': {
                // Public stats for dashboards
                rateLimit: {
                    maxEventsPerMinute: 30
                }
            },

            // Notifications namespace
            '/notifications': {
                // Real-time notification updates
                middleware: ['apiKeyAuth']
            }
        };
    }

    /**
     * Get event configurations
     */
    getEventConfigs() {
        return {
            // System events
            system: {
                maxListeners: 100,
                timeout: 30000
            },

            // Notification events
            notifications: {
                maxListeners: 1000,
                timeout: 10000,
                rateLimited: true
            },

            // Stats events
            stats: {
                maxListeners: 50,
                timeout: 5000,
                broadcast: true
            },

            // Admin events
            admin: {
                maxListeners: 10,
                timeout: 60000,
                requireAuth: true
            }
        };
    }

    /**
     * Get room configurations
     */
    getRoomConfigs() {
        return {
            // Maximum users per room
            maxUsersPerRoom: 1000,
            
            // Room cleanup interval
            cleanupInterval: 300000, // 5 minutes
            
            // Inactive room timeout
            inactiveTimeout: 600000, // 10 minutes
            
            // Room naming patterns
            patterns: {
                user: 'user:{userId}',
                notification: 'notification:{notificationId}',
                stats: 'stats',
                admin: 'admin',
                logs: 'logs'
            }
        };
    }

    /**
     * Get security configurations
     */
    getSecurityConfigs() {
        return {
            // Authentication timeout
            authTimeout: 10000,
            
            // Max authentication attempts
            maxAuthAttempts: 3,
            
            // Session timeout
            sessionTimeout: config.get('security.sessionTimeout', 1800000),
            
            // CSRF protection
            csrf: {
                enabled: config.isProduction(),
                key: config.get('security.encryptionKey')
            },
            
            // IP whitelist (optional)
            ipWhitelist: config.get('security.ipWhitelist', []),
            
            // IP blacklist (optional)
            ipBlacklist: config.get('security.ipBlacklist', []),
            
            // User agent filtering
            userAgentBlacklist: [
                /bot/i,
                /crawler/i,
                /spider/i
            ]
        };
    }

    /**
     * Get monitoring configurations
     */
    getMonitoringConfigs() {
        return {
            // Enable connection monitoring
            enabled: config.get('monitoring.enabled', false),
            
            // Metrics collection interval
            metricsInterval: 5000,
            
            // Health check interval
            healthCheckInterval: 30000,
            
            // Performance monitoring
            performance: {
                enabled: true,
                slowEventThreshold: 1000, // 1 second
                memoryThreshold: 100 * 1024 * 1024 // 100MB
            },
            
            // Error monitoring
            errorMonitoring: {
                enabled: true,
                maxErrorsPerMinute: 100,
                errorLogLevel: 'error'
            }
        };
    }

    /**
     * Get client configurations
     */
    getClientConfigs() {
        return {
            // Auto-connect on page load
            autoConnect: true,
            
            // Reconnection settings
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            
            // Timeout settings
            timeout: 20000,
            
            // Buffering
            buffer: true,
            
            // Force new connection
            forceNew: false,
            
            // Try multiple transports
            tryAllTransports: true
        };
    }

    /**
     * Validate configuration
     */
    validateConfig() {
        const errors = [];

        // Validate transport options
        const validTransports = ['websocket', 'polling'];
        const transports = this.options.transports || [];
        
        for (const transport of transports) {
            if (!validTransports.includes(transport)) {
                errors.push(`Invalid transport: ${transport}`);
            }
        }

        // Validate timeout values
        if (this.options.pingTimeout < 1000) {
            errors.push('Ping timeout must be at least 1000ms');
        }

        if (this.options.pingInterval < 1000) {
            errors.push('Ping interval must be at least 1000ms');
        }

        // Validate buffer size
        if (this.options.maxHttpBufferSize < 1024) {
            errors.push('Max HTTP buffer size must be at least 1024 bytes');
        }

        if (errors.length > 0) {
            throw new Error(`WebSocket configuration validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    /**
     * Get options
     */
    getOptions() {
        if (!this.initialized) {
            throw new Error('WebSocket configuration not initialized');
        }
        return this.options;
    }

    /**
     * Update options
     */
    updateOptions(newOptions) {
        this.options = { ...this.options, ...newOptions };
        this.validateConfig();
        return this.options;
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            enabled: config.get('websocket.enabled', true),
            transports: this.options.transports,
            cors: this.options.cors?.origin,
            pingTimeout: this.options.pingTimeout,
            pingInterval: this.options.pingInterval
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: this.initialized,
            initialized: this.initialized,
            options: this.getStatus(),
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const webSocketConfig = new WebSocketConfig();

module.exports = webSocketConfig;