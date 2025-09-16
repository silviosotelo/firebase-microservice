// ==========================================
// FIREBASE SERVICE - Modular & Robust
// Handles all Firebase FCM communication
// ==========================================

const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const AppLogger = require('../utils/logger');
const { Config } = require('../models');
const { 
    FIREBASE_SCOPES, 
    NOTIFICATION_TYPES, 
    PRIORITY_LEVELS,
    MAX_BATCH_SIZE 
} = require('../utils/constants');

class FirebaseService {
    constructor() {
        this.logger = new AppLogger('FirebaseService');
        this.accessTokenCache = null;
        this.accessTokenExpiry = null;
        this.auth = null;
        this.projectId = null;
        this.initialized = false;
    }

    /**
     * Initialize Firebase service with configuration
     */
    async initialize() {
        try {
            this.logger.info('🔥 Initializing Firebase service...');
            
            await this.loadConfiguration();
            await this.initializeAuth();
            
            this.initialized = true;
            this.logger.info('✅ Firebase service initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Firebase service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Load Firebase configuration from database
     */
    async loadConfiguration() {
        try {
            const configs = await Config.getFirebaseConfig();
            
            if (!configs.projectId || !configs.privateKey || !configs.clientEmail) {
                throw new Error('Incomplete Firebase configuration. Please configure all required fields.');
            }

            this.projectId = configs.projectId;
            this.firebaseConfig = {
                type: 'service_account',
                project_id: configs.projectId,
                private_key: configs.privateKey.replace(/\\n/g, '\n'),
                client_email: configs.clientEmail
            };

            this.logger.info(`🎯 Firebase project configured: ${this.projectId}`);
            
        } catch (error) {
            this.logger.error('❌ Failed to load Firebase configuration:', error);
            throw error;
        }
    }

    /**
     * Initialize Google Auth
     */
    async initializeAuth() {
        try {
            this.auth = new GoogleAuth({
                credentials: this.firebaseConfig,
                scopes: FIREBASE_SCOPES
            });

            this.logger.info('🔐 Google Auth initialized');
            
        } catch (error) {
            this.logger.error('❌ Google Auth initialization failed:', error);
            throw error;
        }
    }

    /**
     * Get access token with caching
     */
    async getAccessToken() {
        try {
            // Check cache first
            if (this.accessTokenCache && this.accessTokenExpiry > Date.now()) {
                this.logger.debug('🎯 Using cached access token');
                return this.accessTokenCache;
            }

            this.logger.debug('🔄 Refreshing access token...');
            
            const accessToken = await this.auth.getAccessToken();
            
            // Cache token (expires in 55 minutes to be safe)
            this.accessTokenCache = accessToken;
            this.accessTokenExpiry = Date.now() + (55 * 60 * 1000);
            
            this.logger.debug('✅ Access token refreshed and cached');
            return accessToken;
            
        } catch (error) {
            this.logger.error('❌ Failed to get access token:', error);
            
            // Clear cache on error
            this.accessTokenCache = null;
            this.accessTokenExpiry = null;
            
            throw error;
        }
    }

    /**
     * Send single notification
     */
    async sendNotification(message, retryCount = 0) {
        const maxRetries = 3;
        
        try {
            if (!this.initialized) {
                throw new Error('Firebase service not initialized');
            }

            const accessToken = await this.getAccessToken();
            const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;

            this.logger.debug(`📤 Sending notification to FCM...`);

            const response = await axios.post(url, { message }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            });

            this.logger.debug('✅ Notification sent successfully');
            
            return {
                success: true,
                messageId: response.data.name,
                response: response.data,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error(`❌ Failed to send notification (attempt ${retryCount + 1}):`, error);

            // Handle specific error types
            if (error.response) {
                const statusCode = error.response.status;
                const errorData = error.response.data;

                // Don't retry client errors (400-499) except 401, 403, 429
                const retryableStatusCodes = [401, 403, 429, 500, 502, 503, 504];
                const shouldRetry = retryableStatusCodes.includes(statusCode) && retryCount < maxRetries;

                if (statusCode === 401) {
                    // Token expired, clear cache
                    this.accessTokenCache = null;
                    this.accessTokenExpiry = null;
                    this.logger.warn('🔄 Access token expired, cleared cache');
                }

                if (shouldRetry) {
                    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                    this.logger.info(`⏱️ Retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                    
                    await this.sleep(delay);
                    return this.sendNotification(message, retryCount + 1);
                }

                return {
                    success: false,
                    error: {
                        code: statusCode,
                        message: errorData?.error?.message || error.message,
                        details: errorData?.error?.details || null,
                        retryable: shouldRetry
                    },
                    timestamp: new Date().toISOString()
                };
            }

            // Network or other errors
            if (retryCount < maxRetries) {
                const delay = Math.pow(2, retryCount) * 1000;
                this.logger.info(`⏱️ Network error, retrying in ${delay}ms...`);
                
                await this.sleep(delay);
                return this.sendNotification(message, retryCount + 1);
            }

            return {
                success: false,
                error: {
                    code: 'NETWORK_ERROR',
                    message: error.message,
                    retryable: false
                },
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Send batch notifications (multicast)
     */
    async sendBatchNotifications(messages, batchSize = 100) {
        try {
            this.logger.info(`📬 Sending batch of ${messages.length} notifications...`);
            
            const results = [];
            const actualBatchSize = Math.min(batchSize, MAX_BATCH_SIZE);
            
            // Split into batches
            for (let i = 0; i < messages.length; i += actualBatchSize) {
                const batch = messages.slice(i, i + actualBatchSize);
                
                this.logger.debug(`📦 Processing batch ${Math.floor(i/actualBatchSize) + 1}/${Math.ceil(messages.length/actualBatchSize)}`);
                
                // Send batch concurrently
                const batchPromises = batch.map((message, index) => 
                    this.sendNotification(message).catch(error => ({
                        success: false,
                        error: error.message,
                        index: i + index
                    }))
                );
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                
                // Rate limiting delay between batches
                if (i + actualBatchSize < messages.length) {
                    await this.sleep(100); // 100ms delay
                }
            }

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.length - successCount;

            this.logger.info(`📊 Batch complete: ${successCount} success, ${failureCount} failed`);

            return {
                success: true,
                totalSent: results.length,
                successCount,
                failureCount,
                successRate: (successCount / results.length) * 100,
                results,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('❌ Batch notification failed:', error);
            throw error;
        }
    }

    /**
     * Create FCM message object
     */
    createMessage({
        token = null,
        topic = null,
        condition = null,
        title,
        body,
        type = NOTIFICATION_TYPES.GENERAL,
        data = {},
        priority = PRIORITY_LEVELS.NORMAL,
        sound = 'default',
        icon = null,
        image = null,
        badge = null,
        clickAction = null,
        channelId = null
    }) {
        try {
            // Validate required fields
            if (!title || !body) {
                throw new Error('Title and body are required');
            }

            if (!token && !topic && !condition) {
                throw new Error('Must specify token, topic, or condition');
            }

            const message = {
                notification: {
                    title: title.substring(0, 100), // FCM limit
                    body: body.substring(0, 4000)   // FCM limit
                },
                data: {
                    type,
                    timestamp: new Date().toISOString(),
                    priority,
                    ...data
                }
            };

            // Add image if provided
            if (image) {
                message.notification.image = image;
            }

            // Set target
            if (token) {
                message.token = token;
            } else if (topic) {
                message.topic = topic;
            } else if (condition) {
                message.condition = condition;
            }

            // Android specific config
            message.android = {
                priority: priority === PRIORITY_LEVELS.HIGH ? 'high' : 'normal',
                notification: {
                    channel_id: channelId || this.getDefaultChannelId(type),
                    sound: sound,
                    priority: priority === PRIORITY_LEVELS.HIGH ? 'high' : 'normal',
                    default_sound: sound === 'default',
                    default_vibrate_timings: true,
                    default_light_settings: true
                }
            };

            if (icon) {
                message.android.notification.icon = icon;
            }

            if (clickAction) {
                message.android.notification.click_action = clickAction;
            }

            // iOS specific config
            message.apns = {
                payload: {
                    aps: {
                        sound: sound,
                        badge: badge || 1,
                        'content-available': 1
                    }
                }
            };

            if (priority === PRIORITY_LEVELS.HIGH) {
                message.apns.headers = {
                    'apns-priority': '10'
                };
                message.apns.payload.aps.priority = 10;
            }

            // Web specific config
            message.webpush = {
                notification: {
                    icon: icon,
                    badge: icon,
                    image: image,
                    requireInteraction: priority === PRIORITY_LEVELS.HIGH,
                    silent: priority === PRIORITY_LEVELS.LOW
                }
            };

            if (clickAction) {
                message.webpush.fcm_options = {
                    link: clickAction
                };
            }

            this.logger.debug('📝 FCM message created successfully');
            return message;

        } catch (error) {
            this.logger.error('❌ Failed to create FCM message:', error);
            throw error;
        }
    }

    /**
     * Get default channel ID based on notification type
     */
    getDefaultChannelId(type) {
        const channelMap = {
            [NOTIFICATION_TYPES.GENERAL]: 'default_channel',
            [NOTIFICATION_TYPES.EMERGENCY]: 'emergency_channel',
            [NOTIFICATION_TYPES.APPOINTMENT]: 'appointment_channel',
            [NOTIFICATION_TYPES.RESULT]: 'result_channel',
            [NOTIFICATION_TYPES.PROMOTION]: 'promotion_channel',
            [NOTIFICATION_TYPES.REMINDER]: 'reminder_channel'
        };
        
        return channelMap[type] || 'default_channel';
    }

    /**
     * Validate FCM token format
     */
    validateToken(token) {
        if (!token || typeof token !== 'string') {
            return false;
        }

        // Basic FCM token validation
        const tokenRegex = /^[A-Za-z0-9_-]{140,}$/;
        return tokenRegex.test(token);
    }

    /**
     * Validate topic name format
     */
    validateTopic(topic) {
        if (!topic || typeof topic !== 'string') {
            return false;
        }

        // FCM topic validation: alphanumeric and hyphens, no spaces
        const topicRegex = /^[a-zA-Z0-9-_.~%]{1,900}$/;
        return topicRegex.test(topic);
    }

    /**
     * Get service health status
     */
    async getHealthStatus() {
        try {
            const status = {
                service: 'FirebaseService',
                status: 'healthy',
                initialized: this.initialized,
                hasValidConfig: !!this.firebaseConfig,
                hasAccessToken: !!this.accessTokenCache,
                tokenExpiry: this.accessTokenExpiry ? new Date(this.accessTokenExpiry).toISOString() : null,
                projectId: this.projectId,
                timestamp: new Date().toISOString()
            };

            // Test access token if available
            if (this.initialized) {
                try {
                    await this.getAccessToken();
                    status.tokenStatus = 'valid';
                } catch (error) {
                    status.tokenStatus = 'invalid';
                    status.tokenError = error.message;
                    status.status = 'degraded';
                }
            }

            return status;

        } catch (error) {
            return {
                service: 'FirebaseService',
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Refresh configuration
     */
    async refreshConfiguration() {
        try {
            this.logger.info('🔄 Refreshing Firebase configuration...');
            
            await this.loadConfiguration();
            await this.initializeAuth();
            
            // Clear cached token to force refresh
            this.accessTokenCache = null;
            this.accessTokenExpiry = null;
            
            this.logger.info('✅ Configuration refreshed successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to refresh configuration:', error);
            throw error;
        }
    }

    /**
     * Utility method for delays
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.logger.info('🧹 Cleaning up Firebase service...');
        
        this.accessTokenCache = null;
        this.accessTokenExpiry = null;
        this.auth = null;
        this.initialized = false;
        
        this.logger.info('✅ Firebase service cleaned up');
    }
}

module.exports = FirebaseService;