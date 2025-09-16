// ==========================================
// FIREBASE CONFIGURATION
// Firebase service account and credentials management
// ==========================================

const fs = require('fs');
const path = require('path');
const AppLogger = require('../utils/logger');

class FirebaseConfig {
    constructor() {
        this.logger = new AppLogger('FirebaseConfig');
        this.credentials = null;
        this.projectId = null;
        this.initialized = false;
    }

    /**
     * Initialize Firebase configuration
     */
    async initialize() {
        try {
            this.logger.info('🔥 Loading Firebase configuration...');
            
            // Try multiple sources for credentials
            this.credentials = await this.loadCredentials();
            
            if (!this.credentials) {
                throw new Error('Firebase credentials not found. Please configure service account credentials.');
            }

            this.projectId = this.credentials.project_id;
            this.initialized = true;
            
            this.logger.info(`✅ Firebase configured for project: ${this.projectId}`);
            
            return this.credentials;

        } catch (error) {
            this.logger.error('❌ Firebase configuration failed:', error);
            throw error;
        }
    }

    /**
     * Load credentials from multiple sources
     */
    async loadCredentials() {
        // Priority order:
        // 1. Environment variables (individual)
        // 2. Service account file path from env
        // 3. Database configuration
        // 4. Default service account file locations

        // 1. Individual environment variables
        const envCredentials = this.loadFromEnvironmentVariables();
        if (envCredentials) {
            this.logger.info('🔐 Loaded Firebase credentials from environment variables');
            return envCredentials;
        }

        // 2. Service account file from environment
        const fileFromEnv = await this.loadFromServiceAccountFile(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        if (fileFromEnv) {
            this.logger.info('🔐 Loaded Firebase credentials from GOOGLE_APPLICATION_CREDENTIALS');
            return fileFromEnv;
        }

        // 3. Database configuration
        const dbCredentials = await this.loadFromDatabase();
        if (dbCredentials) {
            this.logger.info('🔐 Loaded Firebase credentials from database');
            return dbCredentials;
        }

        // 4. Default locations
        const defaultCredentials = await this.loadFromDefaultLocations();
        if (defaultCredentials) {
            this.logger.info('🔐 Loaded Firebase credentials from default location');
            return defaultCredentials;
        }

        return null;
    }

    /**
     * Load from individual environment variables
     */
    loadFromEnvironmentVariables() {
        const {
            FIREBASE_PROJECT_ID,
            FIREBASE_PRIVATE_KEY,
            FIREBASE_CLIENT_EMAIL,
            FIREBASE_CLIENT_ID,
            FIREBASE_AUTH_URI,
            FIREBASE_TOKEN_URI,
            FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
            FIREBASE_CLIENT_X509_CERT_URL
        } = process.env;

        if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
            return null;
        }

        return {
            type: 'service_account',
            project_id: FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: FIREBASE_CLIENT_EMAIL,
            client_id: FIREBASE_CLIENT_ID,
            auth_uri: FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
            token_uri: FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
            client_x509_cert_url: FIREBASE_CLIENT_X509_CERT_URL
        };
    }

    /**
     * Load from service account file
     */
    async loadFromServiceAccountFile(filePath) {
        if (!filePath) {
            return null;
        }

        try {
            const resolvedPath = path.resolve(filePath);
            
            if (!fs.existsSync(resolvedPath)) {
                this.logger.warn(`Service account file not found: ${resolvedPath}`);
                return null;
            }

            const fileContent = fs.readFileSync(resolvedPath, 'utf8');
            const credentials = JSON.parse(fileContent);
            
            // Validate required fields
            if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
                throw new Error('Invalid service account file format');
            }

            return credentials;

        } catch (error) {
            this.logger.error(`Failed to load service account file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Load from database configuration
     */
    async loadFromDatabase() {
        try {
            // This will be called after database is initialized
            const { Config } = require('../models');
            
            if (!Config) {
                return null;
            }

            const firebaseConfig = await Config.getFirebaseConfig();
            
            if (!firebaseConfig.projectId || !firebaseConfig.privateKey || !firebaseConfig.clientEmail) {
                return null;
            }

            return {
                type: 'service_account',
                project_id: firebaseConfig.projectId,
                private_key: firebaseConfig.privateKey.replace(/\\n/g, '\n'),
                client_email: firebaseConfig.clientEmail
            };

        } catch (error) {
            // Database not ready or no config found
            return null;
        }
    }

    /**
     * Load from default file locations
     */
    async loadFromDefaultLocations() {
        const defaultPaths = [
            path.join(process.cwd(), 'firebase-service-account.json'),
            path.join(process.cwd(), 'service-account.json'),
            path.join(process.cwd(), 'config', 'firebase-service-account.json'),
            path.join(process.cwd(), 'credentials', 'firebase-service-account.json'),
            path.join(process.cwd(), 'keys', 'firebase-service-account.json')
        ];

        for (const filePath of defaultPaths) {
            const credentials = await this.loadFromServiceAccountFile(filePath);
            if (credentials) {
                return credentials;
            }
        }

        return null;
    }

    /**
     * Get credentials
     */
    getCredentials() {
        if (!this.initialized) {
            throw new Error('Firebase configuration not initialized');
        }
        return this.credentials;
    }

    /**
     * Get project ID
     */
    getProjectId() {
        if (!this.initialized) {
            throw new Error('Firebase configuration not initialized');
        }
        return this.projectId;
    }

    /**
     * Validate credentials
     */
    validateCredentials(credentials) {
        const requiredFields = [
            'type',
            'project_id',
            'private_key',
            'client_email'
        ];

        for (const field of requiredFields) {
            if (!credentials[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        if (credentials.type !== 'service_account') {
            throw new Error('Only service account credentials are supported');
        }

        return true;
    }

    /**
     * Update credentials in database
     */
    async updateCredentials(newCredentials) {
        try {
            this.validateCredentials(newCredentials);
            
            const { Config } = require('../models');
            
            // Store credentials in database
            await Config.set('FIREBASE_PROJECT_ID', newCredentials.project_id, 'Firebase Project ID');
            await Config.set('FIREBASE_PRIVATE_KEY', newCredentials.private_key, 'Service Account Private Key', 'string', true);
            await Config.set('FIREBASE_CLIENT_EMAIL', newCredentials.client_email, 'Service Account Email');
            
            // Update current credentials
            this.credentials = newCredentials;
            this.projectId = newCredentials.project_id;
            
            this.logger.info(`✅ Firebase credentials updated for project: ${this.projectId}`);
            
            return true;

        } catch (error) {
            this.logger.error('❌ Failed to update Firebase credentials:', error);
            throw error;
        }
    }

    /**
     * Create sample service account file
     */
    createSampleServiceAccountFile() {
        const sampleContent = {
            "type": "service_account",
            "project_id": "your-firebase-project-id",
            "private_key_id": "your-private-key-id",
            "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n",
            "client_email": "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com",
            "client_id": "your-client-id",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40your-project-id.iam.gserviceaccount.com"
        };

        const samplePath = path.join(process.cwd(), 'firebase-service-account.json.example');
        
        fs.writeFileSync(samplePath, JSON.stringify(sampleContent, null, 2));
        
        this.logger.info(`📄 Sample service account file created: ${samplePath}`);
        
        return samplePath;
    }

    /**
     * Get configuration status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            hasCredentials: !!this.credentials,
            projectId: this.projectId,
            clientEmail: this.credentials?.client_email,
            hasPrivateKey: !!(this.credentials?.private_key),
            credentialsSource: this.getCredentialsSource()
        };
    }

    /**
     * Get credentials source
     */
    getCredentialsSource() {
        if (!this.credentials) {
            return 'none';
        }

        // This is simplified - in a real implementation you'd track the source
        if (process.env.FIREBASE_PROJECT_ID) {
            return 'environment';
        }
        
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            return 'service_account_file';
        }
        
        return 'database_or_default';
    }

    /**
     * Health check
     */
    async healthCheck() {
        return {
            healthy: this.initialized && !!this.credentials,
            initialized: this.initialized,
            hasCredentials: !!this.credentials,
            projectId: this.projectId,
            credentialsSource: this.getCredentialsSource(),
            timestamp: new Date().toISOString()
        };
    }
}

// Create singleton instance
const firebaseConfig = new FirebaseConfig();

module.exports = firebaseConfig;