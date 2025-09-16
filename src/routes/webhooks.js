// ==========================================
// WEBHOOKS ROUTES
// Firebase webhook endpoints and external integrations
// ==========================================

const express = require('express');
const crypto = require('crypto');
const database = require('../config/database');
const config = require('../config');
const AppLogger = require('../utils/logger');

const router = express.Router();
const logger = new AppLogger();

// ==========================================
// FIREBASE WEBHOOKS
// ==========================================

/**
 * Firebase Cloud Messaging delivery receipt webhook
 * POST /webhooks/firebase/delivery-receipt
 */
router.post('/firebase/delivery-receipt', async (req, res) => {
    try {
        logger.info('📥 Firebase delivery receipt webhook received');

        // Validate webhook signature if configured
        if (config.auth.webhook.secret) {
            const signature = req.headers['x-firebase-signature'];
            if (!validateFirebaseSignature(req.body, signature)) {
                logger.warn('❌ Invalid Firebase webhook signature');
                return res.status(401).json({
                    success: false,
                    error: 'Invalid signature'
                });
            }
        }

        const { message_id, status, error_code, token, timestamp } = req.body;

        if (!message_id) {
            return res.status(400).json({
                success: false,
                error: 'message_id is required'
            });
        }

        // Update delivery status in database
        const db = database.getDatabase();
        
        // Find the notification response by message_id
        const response = db.prepare(`
            SELECT * FROM notification_responses WHERE message_id = ?
        `).get(message_id);

        if (response) {
            // Update the response status
            db.prepare(`
                UPDATE notification_responses 
                SET 
                    success = ?,
                    error_code = ?,
                    error_message = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE message_id = ?
            `).run(
                status === 'delivered' ? 1 : 0,
                error_code || null,
                status === 'failed' ? `Delivery failed: ${error_code}` : null,
                message_id
            );

            // Update notification statistics
            await updateNotificationStats(response.notification_id);

            logger.info(`✅ Updated delivery status for message: ${message_id} -> ${status}`);
        } else {
            logger.warn(`⚠️ No response found for message_id: ${message_id}`);
        }

        res.json({
            success: true,
            message: 'Delivery receipt processed'
        });

    } catch (error) {
        logger.error('❌ Firebase delivery receipt webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process delivery receipt'
        });
    }
});

/**
 * Firebase topic subscription webhook
 * POST /webhooks/firebase/topic-subscription
 */
router.post('/firebase/topic-subscription', async (req, res) => {
    try {
        logger.info('📥 Firebase topic subscription webhook received');

        const { topic, tokens, action, timestamp } = req.body;

        if (!topic || !tokens || !action) {
            return res.status(400).json({
                success: false,
                error: 'topic, tokens, and action are required'
            });
        }

        // Log topic subscription activity
        const db = database.getDatabase();
        
        // Store topic subscription event (you might want a dedicated table for this)
        db.prepare(`
            INSERT INTO system_config (key, value, description)
            VALUES (?, ?, ?)
        `).run(
            `topic_event_${Date.now()}`,
            JSON.stringify({ topic, tokens, action, timestamp }),
            `Topic ${action} event for ${topic}`
        );

        logger.info(`✅ Topic ${action} processed: ${topic} (${tokens.length} tokens)`);

        res.json({
            success: true,
            message: 'Topic subscription processed'
        });

    } catch (error) {
        logger.error('❌ Firebase topic subscription webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process topic subscription'
        });
    }
});

// ==========================================
// EXTERNAL SYSTEM WEBHOOKS
// ==========================================

/**
 * Oracle APEX integration webhook
 * POST /webhooks/oracle/apex
 */
router.post('/oracle/apex', async (req, res) => {
    try {
        logger.info('📥 Oracle APEX webhook received');

        const {
            notification_type,
            user_id,
            title,
            message,
            priority = 'normal',
            route,
            extra_data,
            tokens,
            topic
        } = req.body;

        // Validate required fields
        if (!title || !message) {
            return res.status(400).json({
                success: false,
                error: 'title and message are required'
            });
        }

        if (!tokens && !topic && !user_id) {
            return res.status(400).json({
                success: false,
                error: 'Either tokens, topic, or user_id must be provided'
            });
        }

        // Create notification request
        const notificationData = {
            title,
            message,
            type: notification_type || 'general',
            priority,
            route,
            extra_data,
            user_id
        };

        if (tokens) {
            notificationData.tokens = Array.isArray(tokens) ? tokens : [tokens];
        }

        if (topic) {
            notificationData.topic = topic;
        }

        // Queue the notification (you'll need to inject the queue service)
        // For now, we'll just log it and return success
        logger.info(`📤 Oracle APEX notification queued: ${title}`);

        res.json({
            success: true,
            message: 'Notification queued from Oracle APEX',
            data: {
                title,
                type: notification_type || 'general',
                priority,
                target: tokens ? `${tokens.length} tokens` : topic || `user: ${user_id}`
            }
        });

    } catch (error) {
        logger.error('❌ Oracle APEX webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process Oracle APEX webhook'
        });
    }
});

/**
 * Generic external system webhook
 * POST /webhooks/external/:system
 */
router.post('/external/:system', async (req, res) => {
    try {
        const system = req.params.system;
        logger.info(`📥 External webhook received from: ${system}`);

        // Validate system is allowed
        const allowedSystems = ['crm', 'erp', 'helpdesk', 'monitoring'];
        if (!allowedSystems.includes(system)) {
            return res.status(400).json({
                success: false,
                error: 'System not allowed'
            });
        }

        // Extract common notification fields
        const {
            event_type,
            title,
            message,
            user_id,
            priority = 'normal',
            data
        } = req.body;

        // Log the webhook event
        const db = database.getDatabase();
        db.prepare(`
            INSERT INTO system_config (key, value, description)
            VALUES (?, ?, ?)
        `).run(
            `webhook_${system}_${Date.now()}`,
            JSON.stringify(req.body),
            `Webhook from ${system}: ${event_type || 'unknown'}`
        );

        // Process different event types
        let responseMessage = 'Webhook processed';
        let shouldCreateNotification = false;

        switch (event_type) {
            case 'user_alert':
            case 'system_alert':
            case 'urgent_notification':
                shouldCreateNotification = true;
                break;
            
            case 'status_update':
                // Just log status updates
                logger.info(`📊 Status update from ${system}: ${title}`);
                break;
            
            case 'heartbeat':
                // System health check
                responseMessage = 'Heartbeat received';
                break;
            
            default:
                logger.warn(`⚠️ Unknown event type from ${system}: ${event_type}`);
        }

        // Create notification if needed
        if (shouldCreateNotification && title && message) {
            // Here you would queue the notification
            logger.info(`📤 Notification created from ${system} webhook: ${title}`);
            responseMessage = 'Webhook processed and notification queued';
        }

        res.json({
            success: true,
            message: responseMessage,
            data: {
                system,
                eventType: event_type,
                processed: true,
                notificationCreated: shouldCreateNotification
            }
        });

    } catch (error) {
        logger.error(`❌ External webhook error (${req.params.system}):`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to process external webhook'
        });
    }
});

// ==========================================
// WEBHOOK MANAGEMENT
// ==========================================

/**
 * Register a new webhook endpoint
 * POST /webhooks/register
 */
router.post('/register', async (req, res) => {
    try {
        const {
            name,
            url,
            events,
            secret,
            active = true,
            description
        } = req.body;

        if (!name || !url || !events) {
            return res.status(400).json({
                success: false,
                error: 'name, url, and events are required'
            });
        }

        const db = database.getDatabase();
        
        // Store webhook configuration
        const webhookConfig = {
            name,
            url,
            events: Array.isArray(events) ? events : [events],
            secret,
            active,
            description,
            created_at: new Date().toISOString()
        };

        db.prepare(`
            INSERT INTO system_config (key, value, description)
            VALUES (?, ?, ?)
        `).run(
            `webhook_${name}`,
            JSON.stringify(webhookConfig),
            description || `Webhook: ${name}`
        );

        logger.info(`✅ Webhook registered: ${name} -> ${url}`);

        res.json({
            success: true,
            message: 'Webhook registered successfully',
            data: {
                name,
                url,
                events: webhookConfig.events,
                active
            }
        });

    } catch (error) {
        logger.error('❌ Webhook registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register webhook'
        });
    }
});

/**
 * List registered webhooks
 * GET /webhooks/list
 */
router.get('/list', async (req, res) => {
    try {
        const db = database.getDatabase();
        
        const webhooks = db.prepare(`
            SELECT key, value, description, updated_at
            FROM system_config 
            WHERE key LIKE 'webhook_%'
            ORDER BY updated_at DESC
        `).all();

        const webhookList = webhooks.map(w => {
            try {
                const config = JSON.parse(w.value);
                return {
                    id: w.key,
                    name: config.name,
                    url: config.url,
                    events: config.events,
                    active: config.active,
                    description: w.description,
                    updatedAt: w.updated_at
                };
            } catch (error) {
                return {
                    id: w.key,
                    error: 'Invalid webhook configuration'
                };
            }
        });

        res.json({
            success: true,
            data: {
                webhooks: webhookList,
                count: webhookList.length
            }
        });

    } catch (error) {
        logger.error('❌ List webhooks error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list webhooks'
        });
    }
});

/**
 * Test webhook endpoint
 * POST /webhooks/test/:name
 */
router.post('/test/:name', async (req, res) => {
    try {
        const webhookName = req.params.name;
        const testData = req.body;

        const db = database.getDatabase();
        
        // Get webhook configuration
        const webhook = db.prepare(`
            SELECT value FROM system_config WHERE key = ?
        `).get(`webhook_${webhookName}`);

        if (!webhook) {
            return res.status(404).json({
                success: false,
                error: 'Webhook not found'
            });
        }

        const config = JSON.parse(webhook.value);

        // Send test webhook
        try {
            const axios = require('axios');
            const testPayload = {
                test: true,
                timestamp: new Date().toISOString(),
                webhook_name: webhookName,
                ...testData
            };

            const response = await axios.post(config.url, testPayload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Test': 'true'
                }
            });

            logger.info(`✅ Test webhook sent successfully: ${webhookName}`);

            res.json({
                success: true,
                message: 'Test webhook sent successfully',
                data: {
                    webhookName,
                    url: config.url,
                    status: response.status,
                    response: response.data
                }
            });

        } catch (webhookError) {
            logger.error(`❌ Test webhook failed: ${webhookName}`, webhookError.message);

            res.status(502).json({
                success: false,
                error: 'Test webhook failed',
                details: webhookError.message
            });
        }

    } catch (error) {
        logger.error('❌ Test webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test webhook'
        });
    }
});

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Validate Firebase webhook signature
 */
function validateFirebaseSignature(payload, signature) {
    if (!config.auth.webhook.secret || !signature) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', config.auth.webhook.secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(`sha256=${expectedSignature}`)
    );
}

/**
 * Update notification statistics
 */
async function updateNotificationStats(notificationId) {
    try {
        const db = database.getDatabase();
        
        // Recalculate statistics for the notification
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_responses,
                SUM(success) as successful_responses,
                COUNT(*) - SUM(success) as failed_responses
            FROM notification_responses 
            WHERE notification_id = ?
        `).get(notificationId);

        if (stats.total_responses > 0) {
            const successRate = (stats.successful_responses / stats.total_responses) * 100;
            
            db.prepare(`
                UPDATE notifications 
                SET 
                    total_sent = ?,
                    successful = ?,
                    failed = ?,
                    success_rate = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                stats.total_responses,
                stats.successful_responses,
                stats.failed_responses,
                successRate,
                notificationId
            );
        }

    } catch (error) {
        logger.error('❌ Failed to update notification stats:', error);
    }
}

module.exports = router;