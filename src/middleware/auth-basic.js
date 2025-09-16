// ==========================================
// BASIC AUTHENTICATION MIDDLEWARE
// Simple auth without external dependencies
// ==========================================

const AppLogger = require('../utils/logger');

class BasicAuthMiddleware {
    constructor() {
        this.logger = new AppLogger('BasicAuth');
        this.models = null;
        this.initialized = false;
        
        // Basic in-memory auth
        this.defaultApiKey = process.env.DEFAULT_API_KEY || 'dev-api-key-12345';
        this.defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    }

    /**
     * Set models (called from app.js after DB init)
     */
    setModels(models) {
        this.models = models;
        this.logger.info('📦 Models set for authentication');
    }

    /**
     * Initialize defaults (optional, works with or without models)
     */
    async initializeDefaults() {
        if (this.initialized) {
            this.logger.info('🔐 Basic auth already initialized, skipping...');
            return;
        }
        
        try {
            this.logger.info('🔐 Initializing basic authentication...');
            
            if (this.models && this.models.Config) {
                this.logger.info('📦 Using database configuration...');
                // Try to use database config if available
                try {
                    let apiKey = this.models.Config.get('DEFAULT_API_KEY');
                    if (!apiKey) {
                        this.models.Config.set('DEFAULT_API_KEY', this.defaultApiKey, 'Default API key');
                        this.logger.info('🔑 Saved default API key to database');
                    } else {
                        this.defaultApiKey = apiKey;
                        this.logger.info('🔑 Loaded API key from database');
                    }
                } catch (dbError) {
                    this.logger.warn('⚠️ Database config failed, using defaults:', dbError.message);
                }
            } else {
                this.logger.info('🔑 Using environment/default configuration (no database)');
            }
            
            this.initialized = true;
            this.logger.info(`✅ Basic auth initialized (API Key: ${this.defaultApiKey.substring(0, 8)}...)`);
            
        } catch (error) {
            this.logger.error('❌ Basic auth initialization failed:', error.message);
            this.logger.error('📍 Auth error stack:', error.stack);
            this.logger.info('🔄 Falling back to hardcoded defaults');
            this.initialized = true; // Continue anyway
        }
    }

    /**
     * Simple API key auth
     */
    apiKeyAuth = async (req, res, next) => {
        try {
            const apiKey = this.extractApiKey(req);
            
            if (!apiKey) {
                return res.status(401).json({
                    success: false,
                    error: 'API key required',
                    code: 'MISSING_API_KEY'
                });
            }

            // Check against default key or env
            if (apiKey === this.defaultApiKey || apiKey === process.env.API_KEY) {
                req.auth = {
                    type: 'api_key',
                    apiKey: apiKey,
                    role: 'admin'
                };
                next();
            } else {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid API key',
                    code: 'INVALID_API_KEY'
                });
            }

        } catch (error) {
            this.logger.error('❌ API key auth failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Authentication error'
            });
        }
    };

    /**
     * Simple admin auth
     */
    adminAuth = async (req, res, next) => {
        try {
            // For basic version, use same API key auth
            return this.apiKeyAuth(req, res, next);
        } catch (error) {
            return res.status(401).json({
                success: false,
                error: 'Admin authentication failed'
            });
        }
    };

    /**
     * Simple webhook auth
     */
    webhookAuth = async (req, res, next) => {
        try {
            // For basic version, allow all webhooks or check simple secret
            const secret = req.headers['x-webhook-secret'];
            const expectedSecret = process.env.WEBHOOK_SECRET || 'webhook-secret-123';
            
            if (secret === expectedSecret) {
                req.auth = { type: 'webhook', verified: true };
                next();
            } else {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid webhook secret'
                });
            }
        } catch (error) {
            return res.status(401).json({
                success: false,
                error: 'Webhook authentication failed'
            });
        }
    };

    /**
     * Simple socket auth
     */
    socketAuth = async (socket, next) => {
        try {
            // Allow all connections in basic mode
            socket.user = {
                id: `user_${Date.now()}`,
                role: 'viewer',
                authenticated: false
            };
            next();
        } catch (error) {
            next(new Error('Socket authentication failed'));
        }
    };

    /**
     * Extract API key from request
     */
    extractApiKey(req) {
        let apiKey = req.headers['x-api-key'] || req.headers['authorization'];
        
        if (apiKey && apiKey.startsWith('Bearer ')) {
            apiKey = apiKey.substring(7);
        }
        
        // Also check query param for development
        if (!apiKey && process.env.NODE_ENV !== 'production') {
            apiKey = req.query.api_key;
        }
        
        return apiKey;
    }
}

// Create instance
const basicAuth = new BasicAuthMiddleware();

module.exports = {
    apiKeyAuth: basicAuth.apiKeyAuth,
    adminAuth: basicAuth.adminAuth,
    webhookAuth: basicAuth.webhookAuth,
    socketAuth: basicAuth.socketAuth,
    authMiddleware: basicAuth
};