// ==========================================
// CONFIG MODEL
// Configuration management with encryption support
// ==========================================

const crypto = require('crypto');
const AppLogger = require('../utils/logger');

class ConfigModel {
    constructor(db) {
        this.db = db;
        this.logger = new AppLogger('ConfigModel');
        this.encryptionKey = this.getEncryptionKey();
        
        // Prepared statements
        this.getStmt = this.db.prepare('SELECT * FROM config WHERE key = ?');
        this.setStmt = this.db.prepare(`
            INSERT OR REPLACE INTO config (key, value, description, type, encrypted) 
            VALUES (?, ?, ?, ?, ?)
        `);
        this.getAllStmt = this.db.prepare('SELECT * FROM config ORDER BY key');
        this.deleteStmt = this.db.prepare('DELETE FROM config WHERE key = ?');
        this.getAllByTypeStmt = this.db.prepare('SELECT * FROM config WHERE type = ? ORDER BY key');
        this.searchStmt = this.db.prepare('SELECT * FROM config WHERE key LIKE ? ORDER BY key');
    }

    /**
     * Get encryption key from environment or generate default
     */
    getEncryptionKey() {
        const key = process.env.ENCRYPTION_KEY || process.env.CONFIG_ENCRYPTION_KEY;
        
        if (!key) {
            // Generate a default key based on some system properties
            // In production, this should be set via environment variable
            const defaultKeySource = process.env.NODE_ENV + '_firebase_microservice_2024';
            return crypto.createHash('sha256').update(defaultKeySource).digest();
        }
        
        // If key is provided as hex string
        if (key.length === 64) {
            return Buffer.from(key, 'hex');
        }
        
        // Hash the provided key to ensure proper length
        return crypto.createHash('sha256').update(key).digest();
    }

/**
     * Encrypt sensitive value
     */
    encrypt(value) {
        if (!value) return value;
        
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
            
            let encrypted = cipher.update(String(value), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // Combine IV and encrypted data
            return iv.toString('hex') + ':' + encrypted;
            
        } catch (error) {
            this.logger.error('❌ Encryption failed:', error.message);
            this.logger.error('❌ Encryption error details:', error);
            throw new Error('Failed to encrypt configuration value');
        }
    }

    /**
     * Decrypt sensitive value
     */
    decrypt(encryptedValue) {
        if (!encryptedValue || typeof encryptedValue !== 'string') {
            return encryptedValue;
        }
        
        // Check if value is encrypted (contains ':' separator)
        if (!encryptedValue.includes(':')) {
            return encryptedValue;
        }
        
        try {
            const [ivHex, encrypted] = encryptedValue.split(':');
            
            if (!ivHex || !encrypted) {
                return encryptedValue;
            }
            
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
            
        } catch (error) {
            this.logger.error('❌ Decryption failed for config value:', error.message);
            // Return original value if decryption fails
            return encryptedValue;
        }
    }

    /**
     * Get configuration value
     */
    get(key) {
        try {
            const result = this.getStmt.get(key);
            
            if (!result) {
                return null;
            }

            let value = result.value;
            
            // Decrypt if encrypted
            if (result.encrypted) {
                value = this.decrypt(value);
            }

            // Parse value based on type
            return this.parseConfigValue(value, result.type);

        } catch (error) {
            this.logger.error(`❌ Failed to get config ${key}:`, error);
            throw new Error(`Failed to get configuration: ${error.message}`);
        }
    }

/**
     * Set configuration value
     */
    set(key, value, description = null, type = 'string', encrypted = false) {
        try {
            this.logger.debug(`🔧 Setting config: ${key} (type: ${type}, encrypted: ${encrypted})`);
            
            let stringValue = this.stringifyConfigValue(value, type);
            this.logger.debug(`📝 Stringified value: ${stringValue}`);
            
            // Encrypt if requested
            if (encrypted && stringValue) {
                this.logger.debug(`🔒 Encrypting value for ${key}...`);
                stringValue = this.encrypt(stringValue);
                this.logger.debug(`🔒 Value encrypted successfully`);
            }

            // Convert boolean to integer for SQLite
            const encryptedInt = encrypted ? 1 : 0;
            this.logger.debug(`💾 Executing setStmt with params: key=${key}, value=${stringValue.substring(0, 20)}..., description=${description}, type=${type}, encrypted=${encryptedInt}`);
            
            const result = this.setStmt.run(key, stringValue, description, type, encryptedInt);
            this.logger.debug(`✅ setStmt executed successfully, changes: ${result.changes}`);
            
            this.logger.debug(`⚙️ Config set: ${key} = ${encrypted ? '***ENCRYPTED***' : stringValue}`);
            
            return this.get(key);

        } catch (error) {
            this.logger.error(`❌ Failed to set config ${key}:`, error.message);
            this.logger.error(`❌ Error details:`, error);
            this.logger.error(`❌ Error stack:`, error.stack);
            throw new Error(`Failed to set configuration: ${error.message}`);
        }
    }

    /**
     * Get all configuration
     */
    getAll(includeEncrypted = false) {
        try {
            const configs = this.getAllStmt.all();
            
            return configs.map(config => {
                let value = config.value;
                
                // Handle encrypted values
                if (config.encrypted) {
                    if (includeEncrypted) {
                        value = this.decrypt(value);
                        value = this.parseConfigValue(value, config.type);
                    } else {
                        value = '***HIDDEN***';
                    }
                } else {
                    value = this.parseConfigValue(value, config.type);
                }
                
                return {
                    ...config,
                    value
                };
            });

        } catch (error) {
            this.logger.error('❌ Failed to get all configs:', error);
            throw new Error(`Failed to get all configurations: ${error.message}`);
        }
    }

    /**
     * Get configurations by type
     */
    getByType(type) {
        try {
            const configs = this.getAllByTypeStmt.all(type);
            
            return configs.map(config => {
                let value = config.encrypted ? '***HIDDEN***' : this.parseConfigValue(config.value, config.type);
                
                return {
                    ...config,
                    value
                };
            });

        } catch (error) {
            this.logger.error(`❌ Failed to get configs by type ${type}:`, error);
            throw new Error(`Failed to get configurations by type: ${error.message}`);
        }
    }

    /**
     * Search configurations
     */
    search(pattern) {
        try {
            const searchPattern = `%${pattern}%`;
            const configs = this.searchStmt.all(searchPattern);
            
            return configs.map(config => {
                let value = config.encrypted ? '***HIDDEN***' : this.parseConfigValue(config.value, config.type);
                
                return {
                    ...config,
                    value
                };
            });

        } catch (error) {
            this.logger.error(`❌ Failed to search configs with pattern ${pattern}:`, error);
            throw new Error(`Failed to search configurations: ${error.message}`);
        }
    }

    /**
     * Delete configuration
     */
    delete(key) {
        try {
            const result = this.deleteStmt.run(key);
            
            this.logger.info(`🗑️ Config deleted: ${key}`);
            
            return result.changes > 0;

        } catch (error) {
            this.logger.error(`❌ Failed to delete config ${key}:`, error);
            throw new Error(`Failed to delete configuration: ${error.message}`);
        }
    }

    /**
     * Get Firebase-specific configuration
     */
    getFirebaseConfig() {
        try {
            return {
                projectId: this.get('FIREBASE_PROJECT_ID'),
                privateKey: this.get('FIREBASE_PRIVATE_KEY'),
                clientEmail: this.get('FIREBASE_CLIENT_EMAIL'),
                clientId: this.get('FIREBASE_CLIENT_ID'),
                authUri: this.get('FIREBASE_AUTH_URI'),
                tokenUri: this.get('FIREBASE_TOKEN_URI'),
                authProviderX509CertUrl: this.get('FIREBASE_AUTH_PROVIDER_X509_CERT_URL'),
                clientX509CertUrl: this.get('FIREBASE_CLIENT_X509_CERT_URL')
            };

        } catch (error) {
            this.logger.error('❌ Failed to get Firebase config:', error);
            throw new Error(`Failed to get Firebase configuration: ${error.message}`);
        }
    }

    /**
     * Set Firebase configuration
     */
    setFirebaseConfig(config) {
        try {
            const configs = [
                ['FIREBASE_PROJECT_ID', config.project_id, 'Firebase Project ID'],
                ['FIREBASE_PRIVATE_KEY', config.private_key, 'Service Account Private Key', 'string', true],
                ['FIREBASE_CLIENT_EMAIL', config.client_email, 'Service Account Email'],
                ['FIREBASE_CLIENT_ID', config.client_id, 'Service Account Client ID'],
                ['FIREBASE_AUTH_URI', config.auth_uri, 'OAuth2 Auth URI'],
                ['FIREBASE_TOKEN_URI', config.token_uri, 'OAuth2 Token URI'],
                ['FIREBASE_AUTH_PROVIDER_X509_CERT_URL', config.auth_provider_x509_cert_url, 'Auth Provider Cert URL'],
                ['FIREBASE_CLIENT_X509_CERT_URL', config.client_x509_cert_url, 'Client Cert URL']
            ];

            for (const [key, value, description, type = 'string', encrypted = false] of configs) {
                if (value !== undefined && value !== null) {
                    this.set(key, value, description, type, encrypted);
                }
            }

            this.logger.info('🔥 Firebase configuration updated');
            
            return this.getFirebaseConfig();

        } catch (error) {
            this.logger.error('❌ Failed to set Firebase config:', error);
            throw new Error(`Failed to set Firebase configuration: ${error.message}`);
        }
    }

    /**
     * Get application settings
     */
    getAppSettings() {
        try {
            return {
                batchSize: this.get('BATCH_SIZE') || 500,
                retryAttempts: this.get('RETRY_ATTEMPTS') || 3,
                rateLimitDelay: this.get('RATE_LIMIT_DELAY') || 100,
                workerConcurrency: this.get('WORKER_CONCURRENCY') || 5,
                tokenCacheTTL: this.get('TOKEN_CACHE_TTL') || 300,
                enableWebhooks: this.get('ENABLE_WEBHOOKS') || false,
                webhookUrl: this.get('WEBHOOK_URL'),
                logLevel: this.get('LOG_LEVEL') || 'info',
                statsRetentionDays: this.get('STATS_RETENTION_DAYS') || 90
            };

        } catch (error) {
            this.logger.error('❌ Failed to get app settings:', error);
            throw new Error(`Failed to get application settings: ${error.message}`);
        }
    }

    /**
     * Export configuration
     */
    exportConfig(includeEncrypted = false, format = 'json') {
        try {
            const configs = this.getAll(includeEncrypted);
            const exportData = {
                exported_at: new Date().toISOString(),
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                total_configs: configs.length,
                configs: configs
            };

            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            } else if (format === 'yaml') {
                // Would require yaml library
                throw new Error('YAML export not implemented');
            } else {
                throw new Error(`Unsupported export format: ${format}`);
            }

        } catch (error) {
            this.logger.error('❌ Failed to export config:', error);
            throw new Error(`Failed to export configuration: ${error.message}`);
        }
    }

    /**
     * Import configuration
     */
    importConfig(configData, overwrite = false) {
        try {
            let configs;
            
            if (typeof configData === 'string') {
                configs = JSON.parse(configData);
            } else {
                configs = configData;
            }

            const imported = [];
            const errors = [];

            if (configs.configs && Array.isArray(configs.configs)) {
                for (const config of configs.configs) {
                    try {
                        // Check if config exists
                        const existing = this.get(config.key);
                        
                        if (existing && !overwrite) {
                            errors.push({
                                key: config.key,
                                error: 'Configuration already exists and overwrite is disabled'
                            });
                            continue;
                        }

                        this.set(
                            config.key,
                            config.value,
                            config.description,
                            config.type,
                            config.encrypted
                        );

                        imported.push(config.key);

                    } catch (error) {
                        errors.push({
                            key: config.key,
                            error: error.message
                        });
                    }
                }
            }

            this.logger.info(`📥 Config import: ${imported.length} imported, ${errors.length} errors`);

            return {
                imported: imported.length,
                errors: errors.length,
                importedKeys: imported,
                errorDetails: errors
            };

        } catch (error) {
            this.logger.error('❌ Failed to import config:', error);
            throw new Error(`Failed to import configuration: ${error.message}`);
        }
    }

    /**
     * Backup configuration
     */
    backup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backup = {
                timestamp,
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                configs: this.getAll(true) // Include encrypted values in backup
            };

            this.logger.info(`💾 Configuration backed up: ${backup.configs.length} configs`);

            return backup;

        } catch (error) {
            this.logger.error('❌ Failed to backup config:', error);
            throw new Error(`Failed to backup configuration: ${error.message}`);
        }
    }

    /**
     * Restore configuration from backup
     */
    restore(backupData, clearExisting = false) {
        try {
            if (clearExisting) {
                // Clear all existing configuration
                const allConfigs = this.getAll();
                for (const config of allConfigs) {
                    this.delete(config.key);
                }
            }

            const result = this.importConfig(backupData, true);
            
            this.logger.info(`📥 Configuration restored: ${result.imported} configs`);
            
            return result;

        } catch (error) {
            this.logger.error('❌ Failed to restore config:', error);
            throw new Error(`Failed to restore configuration: ${error.message}`);
        }
    }

    /**
     * Parse configuration value based on type
     */
    parseConfigValue(value, type) {
        if (value === null || value === undefined) {
            return value;
        }

        switch (type) {
            case 'number':
                return parseFloat(value);
            case 'boolean':
                return value === 'true' || value === true;
            case 'json':
                try {
                    return JSON.parse(value);
                } catch (e) {
                    return value;
                }
            case 'array':
                try {
                    return Array.isArray(value) ? value : JSON.parse(value);
                } catch (e) {
                    return typeof value === 'string' ? value.split(',') : value;
                }
            default:
                return String(value);
        }
    }

    /**
     * Convert value to string for storage
     */
    stringifyConfigValue(value, type) {
        if (value === null || value === undefined) {
            return '';
        }

        switch (type) {
            case 'json':
            case 'array':
                return JSON.stringify(value);
            case 'boolean':
                return value ? 'true' : 'false';
            default:
                return String(value);
        }
    }

    /**
     * Validate configuration key
     */
    validateKey(key) {
        if (!key || typeof key !== 'string') {
            throw new Error('Configuration key must be a non-empty string');
        }

        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
            throw new Error('Configuration key must contain only uppercase letters, numbers and underscores');
        }

        if (key.length > 100) {
            throw new Error('Configuration key must be 100 characters or less');
        }

        return true;
    }

    /**
     * Get configuration statistics
     */
    getStats() {
        try {
            const allConfigs = this.getAllStmt.all();
            const stats = {
                total: allConfigs.length,
                encrypted: allConfigs.filter(c => c.encrypted).length,
                byType: {}
            };

            // Count by type
            for (const config of allConfigs) {
                stats.byType[config.type] = (stats.byType[config.type] || 0) + 1;
            }

            return stats;

        } catch (error) {
            this.logger.error('❌ Failed to get config stats:', error);
            throw new Error(`Failed to get configuration statistics: ${error.message}`);
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Test database connection
            const testConfig = this.getStmt.get('NONEXISTENT_KEY');
            
            return {
                healthy: true,
                stats: this.getStats(),
                encryptionEnabled: !!this.encryptionKey,
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

module.exports = ConfigModel;