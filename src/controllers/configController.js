// ==========================================
// CONFIG CONTROLLER
// Handles system configuration management
// ==========================================

const AppLogger = require('../utils/logger');
const { Config } = require('../models');
const { validateConfig } = require('../utils/validators');
const FirebaseService = require('../services/firebaseService');
const { HTTP_STATUS } = require('../utils/constants');

class ConfigController {
    constructor() {
        this.logger = new AppLogger('ConfigController');
        this.configCache = new Map();
        this.lastCacheRefresh = null;
    }

    /**
     * Get system configuration
     */
    async getConfig(req, res, next) {
        try {
            const { include_sensitive = false } = req.query;
            
            const configs = await Config.getAll();
            
            // Filter sensitive values if requested
            const sanitizedConfigs = configs.map(config => ({
                ...config,
                value: (config.encrypted && !include_sensitive) 
                    ? '***HIDDEN***' 
                    : config.value
            }));

            // Group by category for better organization
            const groupedConfigs = this.groupConfigsByCategory(sanitizedConfigs);

            res.json({
                success: true,
                data: {
                    configs: sanitizedConfigs,
                    grouped: groupedConfigs,
                    total: configs.length,
                    lastUpdated: this.lastCacheRefresh
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get configuration:', error);
            next(error);
        }
    }

    /**
     * Update configuration
     */
    async updateConfig(req, res, next) {
        try {
            const updates = req.body;
            
            if (!Array.isArray(updates) && typeof updates !== 'object') {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Configuration updates must be an object or array'
                });
            }

            const configUpdates = Array.isArray(updates) ? updates : [updates];
            const results = [];
            const errors = [];

            // Process each configuration update
            for (const update of configUpdates) {
                try {
                    // Validate update
                    const { error, value } = validateConfig(update);
                    if (error) {
                        errors.push({
                            key: update.key,
                            error: error.details.map(d => d.message).join(', ')
                        });
                        continue;
                    }

                    // Update configuration
                    const result = await Config.set(
                        value.key,
                        value.value,
                        value.description,
                        value.type,
                        value.encrypted
                    );

                    results.push({
                        key: value.key,
                        success: true,
                        value: value.encrypted ? '***HIDDEN***' : result.value
                    });

                    this.logger.info(`⚙️ Configuration updated: ${value.key}`);

                } catch (error) {
                    errors.push({
                        key: update.key,
                        error: error.message
                    });
                }
            }

            // Clear cache to force refresh
            this.configCache.clear();
            
            // Notify services that might need to refresh their config
            await this.notifyConfigChange(results.map(r => r.key));

            res.json({
                success: errors.length === 0,
                data: {
                    updated: results,
                    errors: errors,
                    total: results.length,
                    failed: errors.length
                },
                message: `Updated ${results.length} configuration(s), ${errors.length} failed`,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to update configuration:', error);
            next(error);
        }
    }

    /**
     * Get Firebase configuration status
     */
    async getFirebaseConfig(req, res, next) {
        try {
            const firebaseConfig = await Config.getFirebaseConfig();
            
            const status = {
                configured: !!(firebaseConfig.projectId && firebaseConfig.privateKey && firebaseConfig.clientEmail),
                projectId: firebaseConfig.projectId || null,
                clientEmail: firebaseConfig.clientEmail || null,
                privateKeyConfigured: !!firebaseConfig.privateKey,
                privateKeyLength: firebaseConfig.privateKey ? firebaseConfig.privateKey.length : 0
            };

            // Test Firebase connection if fully configured
            if (status.configured) {
                try {
                    const firebaseService = new FirebaseService();
                    await firebaseService.initialize();
                    const healthStatus = await firebaseService.getHealthStatus();
                    
                    status.connectionStatus = healthStatus.status;
                    status.tokenStatus = healthStatus.tokenStatus;
                    status.lastTested = new Date().toISOString();
                    
                } catch (error) {
                    status.connectionStatus = 'error';
                    status.connectionError = error.message;
                }
            }

            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to get Firebase configuration:', error);
            next(error);
        }
    }

    /**
     * Test current configuration
     */
    async testConfiguration(req, res, next) {
        try {
            const { component = 'all' } = req.body;
            const testResults = {};

            // Test Firebase configuration
            if (component === 'all' || component === 'firebase') {
                try {
                    const firebaseService = new FirebaseService();
                    await firebaseService.initialize();
                    const healthStatus = await firebaseService.getHealthStatus();
                    
                    testResults.firebase = {
                        status: 'success',
                        message: 'Firebase configuration is valid',
                        details: healthStatus
                    };
                    
                } catch (error) {
                    testResults.firebase = {
                        status: 'error',
                        message: 'Firebase configuration test failed',
                        error: error.message
                    };
                }
            }

            // Test database configuration
            if (component === 'all' || component === 'database') {
                try {
                    const { db } = require('../models');
                    const testQuery = await db.getConnection().prepare('SELECT 1 as test').get();
                    
                    testResults.database = {
                        status: 'success',
                        message: 'Database connection is healthy',
                        details: { testResult: testQuery.test }
                    };
                    
                } catch (error) {
                    testResults.database = {
                        status: 'error',
                        message: 'Database connection test failed',
                        error: error.message
                    };
                }
            }

            // Test Redis configuration (if queue service is available)
            if (component === 'all' || component === 'redis') {
                try {
                    const { getQueueService } = require('../app');
                    const queueService = getQueueService();
                    
                    if (queueService && queueService.redis) {
                        const pingResult = await queueService.redis.ping();
                        
                        testResults.redis = {
                            status: 'success',
                            message: 'Redis connection is healthy',
                            details: { ping: pingResult }
                        };
                    } else {
                        testResults.redis = {
                            status: 'warning',
                            message: 'Redis service not available or not configured'
                        };
                    }
                    
                } catch (error) {
                    testResults.redis = {
                        status: 'error',
                        message: 'Redis connection test failed',
                        error: error.message
                    };
                }
            }

            // Overall status
            const hasErrors = Object.values(testResults).some(result => result.status === 'error');
            const overallStatus = hasErrors ? 'error' : 'success';

            res.json({
                success: !hasErrors,
                data: {
                    overall: overallStatus,
                    tests: testResults,
                    testedAt: new Date().toISOString()
                },
                message: hasErrors ? 'Some configuration tests failed' : 'All configuration tests passed',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to test configuration:', error);
            next(error);
        }
    }

    /**
     * Register webhook endpoint
     */
    async registerWebhook(req, res, next) {
        try {
            const { url, events, secret, active = true } = req.body;

            if (!url) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Webhook URL is required'
                });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch (error) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Invalid webhook URL format'
                });
            }

            // Get existing webhooks
            const webhooksConfig = await Config.get('WEBHOOKS') || '[]';
            const webhooks = JSON.parse(webhooksConfig);

            // Check if webhook already exists
            const existingIndex = webhooks.findIndex(wh => wh.url === url);
            
            const webhookData = {
                id: existingIndex >= 0 ? webhooks[existingIndex].id : this.generateWebhookId(),
                url,
                events: events || ['notification.sent', 'notification.delivered', 'notification.failed'],
                secret: secret || this.generateWebhookSecret(),
                active,
                createdAt: existingIndex >= 0 ? webhooks[existingIndex].createdAt : new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (existingIndex >= 0) {
                webhooks[existingIndex] = webhookData;
            } else {
                webhooks.push(webhookData);
            }

            // Save updated webhooks
            await Config.set('WEBHOOKS', JSON.stringify(webhooks), 'Registered webhook endpoints', 'json');

            this.logger.info(`🔗 Webhook ${existingIndex >= 0 ? 'updated' : 'registered'}: ${url}`);

            res.json({
                success: true,
                data: {
                    ...webhookData,
                    secret: '***HIDDEN***' // Don't expose secret in response
                },
                message: `Webhook ${existingIndex >= 0 ? 'updated' : 'registered'} successfully`,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to register webhook:', error);
            next(error);
        }
    }

    /**
     * List registered webhooks
     */
    async listWebhooks(req, res, next) {
        try {
            const webhooksConfig = await Config.get('WEBHOOKS') || '[]';
            const webhooks = JSON.parse(webhooksConfig);

            // Hide secrets in response
            const safeWebhooks = webhooks.map(webhook => ({
                ...webhook,
                secret: '***HIDDEN***',
                secretLength: webhook.secret ? webhook.secret.length : 0
            }));

            res.json({
                success: true,
                data: {
                    webhooks: safeWebhooks,
                    total: webhooks.length,
                    active: webhooks.filter(wh => wh.active).length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to list webhooks:', error);
            next(error);
        }
    }

    /**
     * Delete webhook
     */
    async deleteWebhook(req, res, next) {
        try {
            const { id } = req.params;

            const webhooksConfig = await Config.get('WEBHOOKS') || '[]';
            const webhooks = JSON.parse(webhooksConfig);

            const webhookIndex = webhooks.findIndex(wh => wh.id === id);
            if (webhookIndex === -1) {
                return res.status(HTTP_STATUS.NOT_FOUND).json({
                    success: false,
                    error: 'Webhook not found'
                });
            }

            const deletedWebhook = webhooks.splice(webhookIndex, 1)[0];

            // Save updated webhooks
            await Config.set('WEBHOOKS', JSON.stringify(webhooks), 'Registered webhook endpoints', 'json');

            this.logger.info(`🗑️ Webhook deleted: ${deletedWebhook.url}`);

            res.json({
                success: true,
                data: {
                    deletedWebhook: {
                        ...deletedWebhook,
                        secret: '***HIDDEN***'
                    }
                },
                message: 'Webhook deleted successfully',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to delete webhook:', error);
            next(error);
        }
    }

    /**
     * Reset configuration to defaults
     */
    async resetToDefaults(req, res, next) {
        try {
            const { confirm } = req.body;

            if (confirm !== 'RESET_ALL_CONFIG') {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Confirmation required. Send { "confirm": "RESET_ALL_CONFIG" }'
                });
            }

            // Reset critical configurations (keeping Firebase settings)
            const defaultConfigs = [
                ['BATCH_SIZE', '500', 'Maximum batch size for multicast', 'number'],
                ['RETRY_ATTEMPTS', '3', 'Number of retry attempts', 'number'],
                ['RATE_LIMIT_DELAY', '100', 'Delay between requests (ms)', 'number'],
                ['WORKER_CONCURRENCY', '5', 'Number of concurrent workers', 'number'],
                ['TOKEN_CACHE_TTL', '300', 'Token cache TTL in seconds', 'number'],
                ['ENABLE_WEBHOOKS', 'false', 'Enable webhook notifications', 'boolean'],
                ['LOG_LEVEL', 'info', 'Application log level'],
                ['STATS_RETENTION_DAYS', '90', 'Statistics retention period', 'number']
            ];

            const resetResults = [];
            for (const [key, value, description, type] of defaultConfigs) {
                try {
                    await Config.set(key, value, description, type || 'string');
                    resetResults.push({ key, success: true });
                } catch (error) {
                    resetResults.push({ key, success: false, error: error.message });
                }
            }

            // Clear cache
            this.configCache.clear();

            this.logger.warn('⚠️ Configuration reset to defaults');

            res.json({
                success: true,
                data: {
                    reset: resetResults,
                    total: resetResults.length,
                    successful: resetResults.filter(r => r.success).length
                },
                message: 'Configuration reset to defaults',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('❌ Failed to reset configuration:', error);
            next(error);
        }
    }

    /**
     * Export configuration
     */
    async exportConfig(req, res, next) {
        try {
            const { include_sensitive = false, format = 'json' } = req.query;

            const configs = await Config.getAll();

            const exportData = {
                exported_at: new Date().toISOString(),
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                configs: configs.map(config => ({
                    key: config.key,
                    value: (config.encrypted && !include_sensitive) ? '***HIDDEN***' : config.value,
                    description: config.description,
                    type: config.type,
                    encrypted: config.encrypted
                }))
            };

            if (format === 'yaml') {
                // Would implement YAML export here
                res.setHeader('Content-Type', 'application/x-yaml');
                res.setHeader('Content-Disposition', 'attachment; filename="config.yaml"');
                res.send('# YAML export not implemented yet\n');
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
                res.json(exportData);
            }

        } catch (error) {
            this.logger.error('❌ Failed to export configuration:', error);
            next(error);
        }
    }

    // ==========================================
    // PRIVATE HELPER METHODS
    // ==========================================

    /**
     * Group configurations by category for better organization
     */
    groupConfigsByCategory(configs) {
        const groups = {
            firebase: [],
            queue: [],
            notification: [],
            security: [],
            system: [],
            other: []
        };

        configs.forEach(config => {
            const key = config.key.toLowerCase();
            
            if (key.includes('firebase')) {
                groups.firebase.push(config);
            } else if (key.includes('queue') || key.includes('worker') || key.includes('batch')) {
                groups.queue.push(config);
            } else if (key.includes('notification') || key.includes('retry') || key.includes('webhook')) {
                groups.notification.push(config);
            } else if (key.includes('api_key') || key.includes('secret') || key.includes('password') || key.includes('jwt')) {
                groups.security.push(config);
            } else if (key.includes('log') || key.includes('debug') || key.includes('retention')) {
                groups.system.push(config);
            } else {
                groups.other.push(config);
            }
        });

        return groups;
    }

    /**
     * Notify services about configuration changes
     */
    async notifyConfigChange(changedKeys) {
        try {
            // Notify Firebase service if Firebase config changed
            const firebaseKeys = changedKeys.filter(key => 
                key.includes('FIREBASE_') || key === 'FIREBASE_PROJECT_ID'
            );
            
            if (firebaseKeys.length > 0) {
                try {
                    const { getFirebaseService } = require('../app');
                    const firebaseService = getFirebaseService();
                    if (firebaseService && firebaseService.refreshConfiguration) {
                        await firebaseService.refreshConfiguration();
                        this.logger.info('🔄 Firebase service configuration refreshed');
                    }
                } catch (error) {
                    this.logger.warn('⚠️ Could not refresh Firebase service configuration:', error.message);
                }
            }

            // Notify other services as needed
            // This could include queue service, webhook service, etc.

        } catch (error) {
            this.logger.error('❌ Failed to notify services of config change:', error);
        }
    }

    /**
     * Generate webhook ID
     */
    generateWebhookId() {
        return 'wh_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    /**
     * Generate webhook secret
     */
    generateWebhookSecret() {
        const { generateRandomString } = require('../utils/validators');
        return generateRandomString(32);
    }
}

module.exports = new ConfigController();