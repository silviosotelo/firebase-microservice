// ==========================================
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// JWT and API Key authentication
// ==========================================

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const AppLogger = require('../utils/logger');

class AuthenticationMiddleware {
    constructor() {
        this.logger = new AppLogger('AuthMiddleware');
        this.apiKeys = new Map(); // In-memory cache for API keys
        this.webhookSecrets = new Map(); // Webhook secrets cache
        this.adminUsers = new Map(); // Admin users cache
        this.initialized = false;
        this.models = null; // Will be injected from app.js
    }

    /**
     * Initialize default API keys and admin users (call AFTER database is ready)
     */
    async initializeDefaults() {
        if (this.initialized) {
            this.logger.info('🔐 Authentication already initialized, skipping...');
            return;
        }

        try {
            this.logger.info('🔐 Initializing authentication defaults...');

            // Use injected models directly - no waiting needed
            if (!this.models) {
                throw new Error('Models not injected into auth middleware');
            }
            
            this.logger.info('📦 Using injected models for auth configuration');
            
            // Generate default API key if not exists
            this.logger.info('🔍 Checking for existing DEFAULT_API_KEY...');
            let apiKey = this.models.Config.get('DEFAULT_API_KEY');
            if (!apiKey) {
                this.logger.info('🔑 Generating new API key...');
                apiKey = this.generateRandomString(32);
                this.logger.info('💾 Saving API key to database...');
                this.models.Config.set('DEFAULT_API_KEY', apiKey, 'Default API key for PL/SQL integration', 'string', false);
                this.logger.info(`🔑 Generated default API key: ${apiKey.substring(0, 8)}...`);
            } else {
                this.logger.info('🔑 Using existing API key from database');
            }
            
            this.apiKeys.set(apiKey, {
                name: 'Default API Key',
                role: 'admin',
                createdAt: new Date(),
                active: true
            });

            // Generate webhook secret if not exists
            this.logger.info('🔍 Checking for existing WEBHOOK_SECRET...');
            let webhookSecret = this.models.Config.get('WEBHOOK_SECRET');
            if (!webhookSecret) {
                this.logger.info('🔒 Generating new webhook secret...');
                webhookSecret = this.generateRandomString(64);
                this.logger.info('💾 Saving webhook secret to database...');
                this.models.Config.set('WEBHOOK_SECRET', webhookSecret, 'Secret for webhook authentication', 'string', false);
            } else {
                this.logger.info('🔒 Using existing webhook secret from database');
            }
            
            this.webhookSecrets.set('default', webhookSecret);

            // Create default admin user
            this.logger.info('🔍 Checking for existing ADMIN_PASSWORD...');
            let adminPassword = this.models.Config.get('ADMIN_PASSWORD');
            if (!adminPassword) {
                this.logger.info('👤 Generating new admin password...');
                const defaultPassword = this.generateRandomString(12);
                const hashedPassword = await bcrypt.hash(defaultPassword, 10);
                this.logger.info('💾 Saving admin password to database...');
                this.models.Config.set('ADMIN_PASSWORD', hashedPassword, 'Default admin password hash', 'string', true);
                this.logger.info(`👤 Default admin password: ${defaultPassword}`);
                adminPassword = hashedPassword;
            } else {
                this.logger.info('👤 Using existing admin password from database');
            }

            this.adminUsers.set('admin', {
                username: 'admin',
                passwordHash: adminPassword,
                role: 'super_admin',
                active: true
            });

            this.initialized = true;
            this.logger.info('🔐 Authentication system initialized successfully');

        } catch (error) {
            this.logger.error('❌ Failed to initialize authentication:', error.message || error);
            if (error.stack) {
                this.logger.error('📍 Auth error stack:', error.stack);
            }
            throw error;
        }
    }

    /**
     * Generate random string (local implementation)
     */
    generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * API Key authentication middleware
     */
    apiKeyAuth = async (req, res, next) => {
        try {
            // Ensure auth is initialized
            if (!this.initialized) {
                await this.initializeDefaults();
            }

            const apiKey = this.extractApiKey(req);
            
            if (!apiKey) {
                return this.sendAuthError(res, 'API key is required', 'MISSING_API_KEY');
            }

            const keyData = this.apiKeys.get(apiKey);
            if (!keyData || !keyData.active) {
                return this.sendAuthError(res, 'Invalid API key', 'INVALID_API_KEY');
            }

            // Attach key info to request
            req.auth = {
                type: 'api_key',
                apiKey: apiKey,
                role: keyData.role,
                name: keyData.name
            };

            // Log API usage
            this.logger.debug(`🔑 API key authenticated: ${keyData.name} (${req.method} ${req.path})`);

            next();

        } catch (error) {
            this.logger.error('❌ API key authentication failed:', error);
            return this.sendAuthError(res, 'Authentication failed', 'AUTH_ERROR');
        }
    };

    /**
     * Admin authentication middleware (JWT or session)
     */
    adminAuth = async (req, res, next) => {
        try {
            // Ensure auth is initialized
            if (!this.initialized) {
                await this.initializeDefaults();
            }

            const token = this.extractJwtToken(req);
            
            if (!token) {
                return this.sendAuthError(res, 'Authentication token required', 'MISSING_TOKEN');
            }

            const decoded = jwt.verify(token, this.getJwtSecret());
            
            if (!decoded.role || !['admin', 'super_admin'].includes(decoded.role)) {
                return this.sendAuthError(res, 'Admin access required', 'INSUFFICIENT_PRIVILEGES');
            }

            req.auth = {
                type: 'jwt',
                user: decoded,
                role: decoded.role
            };

            this.logger.debug(`👤 Admin authenticated: ${decoded.username} (${req.method} ${req.path})`);

            next();

        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                return this.sendAuthError(res, 'Invalid token', 'INVALID_TOKEN');
            } else if (error.name === 'TokenExpiredError') {
                return this.sendAuthError(res, 'Token expired', 'TOKEN_EXPIRED');
            }

            this.logger.error('❌ Admin authentication failed:', error);
            return this.sendAuthError(res, 'Authentication failed', 'AUTH_ERROR');
        }
    };

    /**
     * Webhook authentication middleware
     */
    webhookAuth = async (req, res, next) => {
        try {
            // Ensure auth is initialized
            if (!this.initialized) {
                await this.initializeDefaults();
            }

            const signature = req.headers['x-webhook-signature'];
            const timestamp = req.headers['x-webhook-timestamp'];
            
            if (!signature || !timestamp) {
                return this.sendAuthError(res, 'Missing webhook signature or timestamp', 'MISSING_WEBHOOK_AUTH');
            }

            // Check timestamp to prevent replay attacks (5 minutes tolerance)
            const now = Math.floor(Date.now() / 1000);
            const requestTime = parseInt(timestamp);
            
            if (Math.abs(now - requestTime) > 300) {
                return this.sendAuthError(res, 'Request timestamp too old', 'TIMESTAMP_EXPIRED');
            }

            // Verify signature
            const secret = this.webhookSecrets.get('default');
            const payload = JSON.stringify(req.body);
            const expectedSignature = this.generateWebhookSignature(payload, timestamp, secret);
            
            if (signature !== expectedSignature) {
                return this.sendAuthError(res, 'Invalid webhook signature', 'INVALID_SIGNATURE');
            }

            req.auth = {
                type: 'webhook',
                verified: true,
                timestamp: requestTime
            };

            next();

        } catch (error) {
            this.logger.error('❌ Webhook authentication failed:', error);
            return this.sendAuthError(res, 'Webhook authentication failed', 'WEBHOOK_AUTH_ERROR');
        }
    };

    /**
     * Socket.IO authentication middleware
     */
    socketAuth = async (socket, next) => {
        try {
            // Ensure auth is initialized
            if (!this.initialized) {
                await this.initializeDefaults();
            }

            const token = socket.handshake.auth.token || socket.handshake.query.token;
            
            if (!token) {
                // Allow anonymous connections with viewer role
                socket.user = {
                    id: `anonymous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    role: 'viewer',
                    authenticated: false
                };
                return next();
            }

            // Try API key first
            if (this.apiKeys.has(token)) {
                const keyData = this.apiKeys.get(token);
                socket.user = {
                    id: `api_${keyData.name.replace(/\s+/g, '_').toLowerCase()}`,
                    role: keyData.role,
                    authenticated: true,
                    authType: 'api_key'
                };
                return next();
            }

            // Try JWT token
            try {
                const decoded = jwt.verify(token, this.getJwtSecret());
                socket.user = {
                    id: decoded.id || decoded.username,
                    role: decoded.role || 'viewer',
                    authenticated: true,
                    authType: 'jwt',
                    username: decoded.username
                };
                return next();
            } catch (jwtError) {
                // JWT failed, continue as anonymous
                socket.user = {
                    id: `anonymous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    role: 'viewer',
                    authenticated: false
                };
                return next();
            }

        } catch (error) {
            this.logger.error('❌ Socket authentication failed:', error);
            return next(new Error('Authentication failed'));
        }
    };

    /**
     * Role-based authorization middleware
     */
    requireRole = (requiredRole) => {
        return (req, res, next) => {
            if (!req.auth) {
                return this.sendAuthError(res, 'Authentication required', 'NOT_AUTHENTICATED');
            }

            const userRole = req.auth.role;
            const roleHierarchy = {
                'viewer': 1,
                'admin': 2,
                'super_admin': 3
            };

            const userRoleLevel = roleHierarchy[userRole] || 0;
            const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

            if (userRoleLevel < requiredRoleLevel) {
                return this.sendAuthError(res, 'Insufficient privileges', 'INSUFFICIENT_PRIVILEGES');
            }

            next();
        };
    };

    /**
     * Login endpoint for admin users
     */
    login = async (req, res) => {
        try {
            // Ensure auth is initialized
            if (!this.initialized) {
                await this.initializeDefaults();
            }

            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Username and password are required'
                });
            }

            const user = this.adminUsers.get(username);
            if (!user || !user.active) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid credentials'
                });
            }

            const isValidPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid credentials'
                });
            }

            // Generate JWT token
            const token = jwt.sign(
                {
                    id: user.username,
                    username: user.username,
                    role: user.role
                },
                this.getJwtSecret(),
                { expiresIn: '24h' }
            );

            this.logger.info(`👤 User logged in: ${username}`);

            res.json({
                success: true,
                data: {
                    token,
                    user: {
                        username: user.username,
                        role: user.role
                    },
                    expiresIn: '24h'
                }
            });

        } catch (error) {
            this.logger.error('❌ Login failed:', error);
            res.status(500).json({
                success: false,
                error: 'Login failed'
            });
        }
    };

    /**
     * Generate new API key
     */
    generateApiKey = async (req, res) => {
        try {
            const { name, role = 'admin' } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: 'API key name is required'
                });
            }

            const apiKey = this.generateRandomString(32);
            
            this.apiKeys.set(apiKey, {
                name,
                role,
                createdAt: new Date(),
                createdBy: req.auth.user?.username || 'system',
                active: true
            });

            // Store in database
            this.setConfigValue(`API_KEY_${apiKey}`, JSON.stringify({
                name,
                role,
                createdAt: new Date().toISOString(),
                createdBy: req.auth.user?.username || 'system'
            }));

            this.logger.info(`🔑 New API key generated: ${name}`);

            res.json({
                success: true,
                data: {
                    apiKey,
                    name,
                    role,
                    createdAt: new Date().toISOString()
                }
            });

        } catch (error) {
            this.logger.error('❌ Failed to generate API key:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate API key'
            });
        }
    };

    // ==========================================
    // UTILITY METHODS
    // ==========================================

    /**
     * Extract API key from request
     */
    extractApiKey(req) {
        // Check header
        let apiKey = req.headers['x-api-key'] || req.headers['authorization'];
        
        // Remove Bearer prefix if present
        if (apiKey && apiKey.startsWith('Bearer ')) {
            apiKey = apiKey.substring(7);
        }
        
        // Check query parameter (less secure, for development only)
        if (!apiKey && process.env.NODE_ENV !== 'production') {
            apiKey = req.query.api_key;
        }
        
        return apiKey;
    }

    /**
     * Extract JWT token from request
     */
    extractJwtToken(req) {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        
        // Check cookie (for web sessions)
        if (req.cookies && req.cookies.token) {
            return req.cookies.token;
        }
        
        return null;
    }

    /**
     * Generate webhook signature
     */
    generateWebhookSignature(payload, timestamp, secret) {
        const crypto = require('crypto');
        const message = `${timestamp}.${payload}`;
        return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }

    /**
     * Send authentication error response
     */
    sendAuthError(res, message, code) {
        return res.status(401).json({
            success: false,
            error: message,
            code: code,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get JWT secret from config
     */
    getJwtSecret() {
        let secret = this.models.Config.get('JWT_SECRET');
        if (!secret) {
            secret = this.generateRandomString(64);
            this.models.Config.set('JWT_SECRET', secret, 'JWT signing secret', 'string', true);
        }
        return secret;
    }

    /**
     * Get configuration value
     */
    getConfigValue(key) {
        try {
            return this.models.Config.get(key);
        } catch (error) {
            this.logger.error(`❌ Failed to get config ${key}:`, error.message);
            return null;
        }
    }

    /**
     * Set configuration value
     */
    setConfigValue(key, value, description, type = 'string', encrypted = false) {
        try {
            this.models.Config.set(key, value, description, type, encrypted);
        } catch (error) {
            this.logger.error(`❌ Failed to set config ${key}:`, error.message);
        }
    }

    /**
     * Refresh API keys cache from database
     */
    async refreshApiKeysCache() {
        try {
            const configs = this.models.Config.getAll();
            
            this.apiKeys.clear();
            
            for (const config of configs) {
                if (config.key.startsWith('API_KEY_')) {
                    const apiKey = config.key.replace('API_KEY_', '');
                    const keyData = JSON.parse(config.value);
                    
                    this.apiKeys.set(apiKey, {
                        ...keyData,
                        active: true
                    });
                }
            }
            
            this.logger.info(`🔄 Refreshed ${this.apiKeys.size} API keys from database`);
            
        } catch (error) {
            this.logger.error('❌ Failed to refresh API keys cache:', error);
        }
    }

    /**
     * Revoke API key
     */
    async revokeApiKey(apiKey) {
        try {
            this.apiKeys.delete(apiKey);
            
            // Set as inactive in database
            this.setConfigValue(`API_KEY_${apiKey}`, JSON.stringify({ active: false }));
            
            this.logger.info(`🔑 API key revoked: ${apiKey.substring(0, 8)}...`);
            
        } catch (error) {
            this.logger.error('❌ Failed to revoke API key:', error);
        }
    }

    /**
     * Get authentication statistics
     */
    getAuthStats() {
        return {
            initialized: this.initialized,
            activeApiKeys: this.apiKeys.size,
            adminUsers: this.adminUsers.size,
            webhookSecrets: this.webhookSecrets.size,
            lastRefresh: new Date().toISOString()
        };
    }
}

// Create singleton instance
const authMiddleware = new AuthenticationMiddleware();

module.exports = {
    // Middleware functions
    apiKeyAuth: authMiddleware.apiKeyAuth,
    adminAuth: authMiddleware.adminAuth,
    webhookAuth: authMiddleware.webhookAuth,
    socketAuth: authMiddleware.socketAuth,
    requireRole: authMiddleware.requireRole,
    
    // Auth endpoints
    login: authMiddleware.login,
    generateApiKey: authMiddleware.generateApiKey,
    
    // Utility methods
    refreshApiKeysCache: () => authMiddleware.refreshApiKeysCache(),
    revokeApiKey: (apiKey) => authMiddleware.revokeApiKey(apiKey),
    getAuthStats: () => authMiddleware.getAuthStats(),
    
    // Instance for advanced usage
    authMiddleware
};