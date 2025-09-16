// ==========================================
// WEBSOCKET HANDLERS
// WebSocket event handlers and connection management
// ==========================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const database = require('../config/database');
const AppLogger = require('../utils/logger');
const {
    SERVER_EVENTS,
    CLIENT_EVENTS,
    ROOMS,
    ERROR_CODES,
    EventHelpers
} = require('./events');

class WebSocketHandlers {
    constructor(io, statsService = null, queueService = null) {
        this.io = io;
        this.statsService = statsService;
        this.queueService = queueService;
        this.logger = new AppLogger();
        
        // Client management
        this.connectedClients = new Map();
        this.clientSubscriptions = new Map();
        this.rateLimitStore = new Map();
        
        // Authentication cache
        this.authCache = new Map();
        
        this.setupEventHandlers();
    }

    /**
     * Setup main event handlers
     */
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });

        // Clean up rate limit store periodically
        setInterval(() => {
            this.cleanupRateLimitStore();
        }, 60000); // Every minute
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(socket) {
        const clientId = socket.id;
        const clientIP = socket.handshake.address;
        
        this.logger.info(`🔌 New WebSocket connection: ${clientId} from ${clientIP}`);

        // Initialize client data
        this.connectedClients.set(clientId, {
            id: clientId,
            socket,
            ip: clientIP,
            authenticated: false,
            user: null,
            role: null,
            connectedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        });

        this.clientSubscriptions.set(clientId, new Set());

        // Send connection confirmation
        socket.emit(SERVER_EVENTS.CONNECTED, {
            clientId,
            timestamp: new Date().toISOString(),
            serverVersion: process.env.npm_package_version || '1.0.0'
        });

        // Setup event handlers for this socket
        this.setupSocketHandlers(socket);

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            this.handleDisconnection(socket, reason);
        });

        // Update stats
        this.updateConnectionStats();
    }

    /**
     * Setup event handlers for a specific socket
     */
    setupSocketHandlers(socket) {
        const clientId = socket.id;

        // Authentication
        socket.on(CLIENT_EVENTS.AUTHENTICATE, (data) => {
            this.handleAuthentication(socket, data);
        });

        // Subscription management
        socket.on(CLIENT_EVENTS.SUBSCRIBE_NOTIFICATIONS, (data) => {
            this.handleSubscribeNotifications(socket, data);
        });

        socket.on(CLIENT_EVENTS.UNSUBSCRIBE_NOTIFICATIONS, (data) => {
            this.handleUnsubscribeNotifications(socket, data);
        });

        socket.on(CLIENT_EVENTS.SUBSCRIBE_STATS, (data) => {
            this.handleSubscribeStats(socket, data);
        });

        socket.on(CLIENT_EVENTS.UNSUBSCRIBE_STATS, (data) => {
            this.handleUnsubscribeStats(socket, data);
        });

        socket.on(CLIENT_EVENTS.SUBSCRIBE_QUEUE, (data) => {
            this.handleSubscribeQueue(socket, data);
        });

        socket.on(CLIENT_EVENTS.SUBSCRIBE_LOGS, (data) => {
            this.handleSubscribeLogs(socket, data);
        });

        socket.on(CLIENT_EVENTS.SUBSCRIBE_USER_NOTIFICATIONS, (data) => {
            this.handleSubscribeUserNotifications(socket, data);
        });

        // Data requests
        socket.on(CLIENT_EVENTS.GET_DASHBOARD_DATA, (data) => {
            this.handleGetDashboardData(socket, data);
        });

        socket.on(CLIENT_EVENTS.GET_REALTIME_STATS, (data) => {
            this.handleGetRealtimeStats(socket, data);
        });

        socket.on(CLIENT_EVENTS.GET_NOTIFICATION_STATUS, (data) => {
            this.handleGetNotificationStatus(socket, data);
        });

        // Notification actions
        socket.on(CLIENT_EVENTS.CANCEL_NOTIFICATION, (data) => {
            this.handleCancelNotification(socket, data);
        });

        socket.on(CLIENT_EVENTS.RETRY_NOTIFICATION, (data) => {
            this.handleRetryNotification(socket, data);
        });

        // Admin actions
        socket.on(CLIENT_EVENTS.PAUSE_QUEUE, (data) => {
            this.handlePauseQueue(socket, data);
        });

        socket.on(CLIENT_EVENTS.RESUME_QUEUE, (data) => {
            this.handleResumeQueue(socket, data);
        });

        socket.on(CLIENT_EVENTS.CLEAR_FAILED_JOBS, (data) => {
            this.handleClearFailedJobs(socket, data);
        });

        // Health checks
        socket.on(CLIENT_EVENTS.PING, (data) => {
            this.handlePing(socket, data);
        });

        socket.on(CLIENT_EVENTS.GET_SYSTEM_STATUS, (data) => {
            this.handleGetSystemStatus(socket, data);
        });

        // Error handling
        socket.on('error', (error) => {
            this.logger.error(`❌ WebSocket error for client ${clientId}:`, error);
        });
    }

    /**
     * Handle client authentication
     */
    async handleAuthentication(socket, data) {
        const clientId = socket.id;
        
        try {
            if (!this.validateClientEvent(socket, CLIENT_EVENTS.AUTHENTICATE, data)) {
                return;
            }

            const { token, role } = data;
            const client = this.connectedClients.get(clientId);

            // Verify token (simplified - in production you'd validate against your auth system)
            let user = null;
            let userRole = 'user';

            if (token) {
                try {
                    // Check if it's an API key
                    if (config.auth.apiKeys.admin.includes(token)) {
                        userRole = 'admin';
                        user = { id: 'admin', role: 'admin' };
                    } else if (config.auth.apiKeys.superAdmin.includes(token)) {
                        userRole = 'super_admin';
                        user = { id: 'super_admin', role: 'super_admin' };
                    } else if (config.auth.apiKeys.user.includes(token)) {
                        userRole = 'user';
                        user = { id: 'user', role: 'user' };
                    } else {
                        // Try JWT token
                        const decoded = jwt.verify(token, config.auth.jwt.secret);
                        user = decoded.user || decoded;
                        userRole = user.role || role || 'user';
                    }
                } catch (jwtError) {
                    this.sendError(socket, ERROR_CODES.INVALID_TOKEN, 'Invalid authentication token');
                    return;
                }
            }

            // Update client data
            client.authenticated = true;
            client.user = user;
            client.role = userRole;
            client.lastActivity = new Date().toISOString();

            // Join role-based rooms
            socket.join(ROOMS.ALL_USERS);
            if (userRole === 'admin' || userRole === 'super_admin') {
                socket.join(ROOMS.ADMINS);
            }
            if (userRole === 'super_admin') {
                socket.join(ROOMS.SUPER_ADMINS);
            }

            // Cache authentication
            this.authCache.set(clientId, { user, role: userRole });

            socket.emit(SERVER_EVENTS.AUTHENTICATED, {
                success: true,
                user: user ? { id: user.id, role: userRole } : null,
                permissions: this.getUserPermissions(userRole),
                timestamp: new Date().toISOString()
            });

            this.logger.info(`✅ Client authenticated: ${clientId} (role: ${userRole})`);

        } catch (error) {
            this.logger.error(`❌ Authentication error for client ${clientId}:`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Authentication failed');
        }
    }

    /**
     * Handle subscription to notifications
     */
    handleSubscribeNotifications(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            const { types = [], priorities = [] } = data;
            
            // Join notification room
            socket.join(ROOMS.NOTIFICATIONS);
            this.addSubscription(clientId, 'notifications');

            // Join specific type rooms if specified
            if (types.length > 0) {
                types.forEach(type => {
                    const room = EventHelpers.getTypeRoom(type);
                    socket.join(room);
                    this.addSubscription(clientId, `type_${type}`);
                });
            }

            // Join specific priority rooms if specified
            if (priorities.length > 0) {
                priorities.forEach(priority => {
                    const room = EventHelpers.getPriorityRoom(priority);
                    socket.join(room);
                    this.addSubscription(clientId, `priority_${priority}`);
                });
            }

            socket.emit('subscription_confirmed', {
                type: 'notifications',
                filters: { types, priorities },
                timestamp: new Date().toISOString()
            });

            this.logger.info(`📬 Client subscribed to notifications: ${clientId}`);

        } catch (error) {
            this.logger.error(`❌ Subscribe notifications error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Subscription failed');
        }
    }

    /**
     * Handle subscription to user-specific notifications
     */
    handleSubscribeUserNotifications(socket, data) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;
        if (!this.validateClientEvent(socket, CLIENT_EVENTS.SUBSCRIBE_USER_NOTIFICATIONS, data)) return;

        try {
            const { userId } = data;
            const client = this.connectedClients.get(clientId);

            // Check if user can subscribe to this user's notifications
            if (client.role !== 'admin' && client.role !== 'super_admin' && 
                client.user && client.user.id !== userId) {
                this.sendError(socket, ERROR_CODES.INSUFFICIENT_PERMISSIONS, 
                    'Cannot subscribe to other user notifications');
                return;
            }

            const userRoom = EventHelpers.getUserRoom(userId);
            socket.join(userRoom);
            this.addSubscription(clientId, `user_${userId}`);

            socket.emit('subscription_confirmed', {
                type: 'user_notifications',
                userId,
                timestamp: new Date().toISOString()
            });

            this.logger.info(`👤 Client subscribed to user notifications: ${clientId} -> ${userId}`);

        } catch (error) {
            this.logger.error(`❌ Subscribe user notifications error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'User subscription failed');
        }
    }

    /**
     * Handle subscription to statistics
     */
    handleSubscribeStats(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            socket.join(ROOMS.STATS);
            this.addSubscription(clientId, 'stats');

            // Send current stats immediately
            if (this.statsService) {
                const realtimeStats = this.statsService.getRealtimeStats();
                socket.emit(SERVER_EVENTS.REALTIME_STATS, realtimeStats);
            }

            socket.emit('subscription_confirmed', {
                type: 'stats',
                timestamp: new Date().toISOString()
            });

            this.logger.info(`📊 Client subscribed to stats: ${clientId}`);

        } catch (error) {
            this.logger.error(`❌ Subscribe stats error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Stats subscription failed');
        }
    }

    /**
     * Handle subscription to queue status
     */
    handleSubscribeQueue(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            socket.join(ROOMS.QUEUE);
            this.addSubscription(clientId, 'queue');

            socket.emit('subscription_confirmed', {
                type: 'queue',
                timestamp: new Date().toISOString()
            });

            this.logger.info(`📋 Client subscribed to queue: ${clientId}`);

        } catch (error) {
            this.logger.error(`❌ Subscribe queue error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Queue subscription failed');
        }
    }

    /**
     * Handle subscription to logs (admin only)
     */
    handleSubscribeLogs(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket, ['admin', 'super_admin'])) return;

        try {
            socket.join(ROOMS.LOGS);
            this.addSubscription(clientId, 'logs');

            socket.emit('subscription_confirmed', {
                type: 'logs',
                timestamp: new Date().toISOString()
            });

            this.logger.info(`📝 Admin subscribed to logs: ${clientId}`);

        } catch (error) {
            this.logger.error(`❌ Subscribe logs error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Logs subscription failed');
        }
    }

    /**
     * Handle dashboard data request
     */
    async handleGetDashboardData(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            if (!this.statsService) {
                this.sendError(socket, ERROR_CODES.SERVICE_UNAVAILABLE, 'Stats service not available');
                return;
            }

            const dashboardData = {
                overall: await this.statsService.getOverallStats(),
                daily: await this.statsService.getDailyStats(7),
                byType: await this.statsService.getStatsByType(),
                realtime: this.statsService.getRealtimeStats(),
                timestamp: new Date().toISOString()
            };

            socket.emit(SERVER_EVENTS.DASHBOARD_DATA_UPDATED, dashboardData);

        } catch (error) {
            this.logger.error(`❌ Get dashboard data error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to get dashboard data');
        }
    }

    /**
     * Handle real-time stats request
     */
    handleGetRealtimeStats(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            if (!this.statsService) {
                this.sendError(socket, ERROR_CODES.SERVICE_UNAVAILABLE, 'Stats service not available');
                return;
            }

            const realtimeStats = this.statsService.getRealtimeStats();
            socket.emit(SERVER_EVENTS.REALTIME_STATS, realtimeStats);

        } catch (error) {
            this.logger.error(`❌ Get realtime stats error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to get realtime stats');
        }
    }

    /**
     * Handle notification status request
     */
    async handleGetNotificationStatus(socket, data) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;
        if (!this.validateClientEvent(socket, CLIENT_EVENTS.GET_NOTIFICATION_STATUS, data)) return;

        try {
            const { notificationId } = data;
            const db = database.getDatabase();

            const notification = db.prepare(`
                SELECT id, request_id, title, status, total_sent, successful, failed, 
                       success_rate, created_at, updated_at, completed_at
                FROM notifications 
                WHERE id = ? OR request_id = ?
            `).get(notificationId, notificationId);

            if (!notification) {
                this.sendError(socket, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
                return;
            }

            socket.emit('notification_status_response', {
                notificationId,
                status: notification,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error(`❌ Get notification status error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to get notification status');
        }
    }

    /**
     * Handle ping request
     */
    handlePing(socket, data = {}) {
        const client = this.connectedClients.get(socket.id);
        if (client) {
            client.lastActivity = new Date().toISOString();
        }

        socket.emit('pong', {
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    }

    /**
     * Handle system status request
     */
    async handleGetSystemStatus(socket, data = {}) {
        const clientId = socket.id;
        
        if (!this.requireAuth(socket)) return;

        try {
            const systemStatus = {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                connections: this.connectedClients.size,
                database: await database.healthCheck(),
                timestamp: new Date().toISOString()
            };

            socket.emit('system_status_response', systemStatus);

        } catch (error) {
            this.logger.error(`❌ Get system status error: ${clientId}`, error);
            this.sendError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to get system status');
        }
    }

    /**
     * Handle disconnection
     */
    handleDisconnection(socket, reason) {
        const clientId = socket.id;
        const client = this.connectedClients.get(clientId);

        if (client) {
            this.logger.info(`🔌 Client disconnected: ${clientId} (reason: ${reason})`);
            
            // Clean up
            this.connectedClients.delete(clientId);
            this.clientSubscriptions.delete(clientId);
            this.authCache.delete(clientId);
            
            // Update stats
            this.updateConnectionStats();
        }
    }

    // ==========================================
    // BROADCAST METHODS
    // ==========================================

    /**
     * Broadcast notification event
     */
    broadcastNotificationEvent(eventType, notificationData) {
        try {
            const event = EventHelpers.createNotificationEvent(eventType, notificationData);
            
            // Broadcast to all notification subscribers
            this.io.to(ROOMS.NOTIFICATIONS).emit(eventType, event);
            
            // Broadcast to specific type room
            if (notificationData.type) {
                const typeRoom = EventHelpers.getTypeRoom(notificationData.type);
                this.io.to(typeRoom).emit(eventType, event);
            }
            
            // Broadcast to specific priority room
            if (notificationData.priority) {
                const priorityRoom = EventHelpers.getPriorityRoom(notificationData.priority);
                this.io.to(priorityRoom).emit(eventType, event);
            }
            
            // Broadcast to user-specific room
            if (notificationData.user_id) {
                const userRoom = EventHelpers.getUserRoom(notificationData.user_id);
                this.io.to(userRoom).emit(eventType, event);
            }

        } catch (error) {
            this.logger.error('❌ Failed to broadcast notification event:', error);
        }
    }

    /**
     * Broadcast stats update
     */
    broadcastStatsUpdate(statsData, type = 'general') {
        try {
            const event = EventHelpers.createStatsEvent(type, statsData);
            this.io.to(ROOMS.STATS).emit(SERVER_EVENTS.STATS_UPDATED, event);

        } catch (error) {
            this.logger.error('❌ Failed to broadcast stats update:', error);
        }
    }

    /**
     * Broadcast system alert
     */
    broadcastSystemAlert(level, message, code = null, details = {}) {
        try {
            const alert = EventHelpers.createSystemAlert(level, message, code, details);
            
            // Send to appropriate audiences based on level
            if (level === 'critical' || level === 'error') {
                this.io.to(ROOMS.ADMINS).emit(SERVER_EVENTS.SYSTEM_ALERT, alert);
            } else {
                this.io.to(ROOMS.ALL_USERS).emit(SERVER_EVENTS.SYSTEM_ALERT, alert);
            }

        } catch (error) {
            this.logger.error('❌ Failed to broadcast system alert:', error);
        }
    }

    /**
     * Broadcast queue status update
     */
    broadcastQueueUpdate(queueName, status) {
        try {
            const event = EventHelpers.createQueueStatusEvent(queueName, status);
            this.io.to(ROOMS.QUEUE).emit(SERVER_EVENTS.QUEUE_STATUS_UPDATED, event);

        } catch (error) {
            this.logger.error('❌ Failed to broadcast queue update:', error);
        }
    }

    // ==========================================
    // UTILITY METHODS
    // ==========================================

    /**
     * Validate client event and rate limiting
     */
    validateClientEvent(socket, eventName, data) {
        const clientId = socket.id;

        // Rate limiting check
        if (EventHelpers.isRateLimited(eventName, clientId, this.rateLimitStore)) {
            this.sendError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED, 
                `Rate limit exceeded for ${eventName}`);
            return false;
        }

        // Data validation
        const validation = EventHelpers.validateEventData(eventName, data || {});
        if (!validation.valid) {
            this.sendError(socket, ERROR_CODES.INVALID_DATA_FORMAT, 
                validation.errors.join(', '));
            return false;
        }

        // Update activity
        this.updateClientActivity(clientId);
        return true;
    }

    /**
     * Require authentication
     */
    requireAuth(socket, requiredRoles = null) {
        const clientId = socket.id;
        const client = this.connectedClients.get(clientId);

        if (!client || !client.authenticated) {
            this.sendError(socket, ERROR_CODES.AUTH_REQUIRED, 'Authentication required');
            return false;
        }

        if (requiredRoles && !requiredRoles.includes(client.role)) {
            this.sendError(socket, ERROR_CODES.INSUFFICIENT_PERMISSIONS, 
                'Insufficient permissions');
            return false;
        }

        return true;
    }

    /**
     * Send error to client
     */
    sendError(socket, code, message, details = {}) {
        socket.emit(SERVER_EVENTS.ERROR, {
            code,
            message,
            details,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Add subscription for client
     */
    addSubscription(clientId, subscription) {
        const subscriptions = this.clientSubscriptions.get(clientId);
        if (subscriptions) {
            subscriptions.add(subscription);
        }
    }

    /**
     * Update client activity
     */
    updateClientActivity(clientId) {
        const client = this.connectedClients.get(clientId);
        if (client) {
            client.lastActivity = new Date().toISOString();
        }
    }

    /**
     * Update connection statistics
     */
    updateConnectionStats() {
        if (this.statsService) {
            this.statsService.realtimeStats.activeConnections = this.connectedClients.size;
        }
    }

    /**
     * Get user permissions based on role
     */
    getUserPermissions(role) {
        const permissions = {
            user: ['read_notifications', 'read_stats'],
            admin: ['read_notifications', 'read_stats', 'manage_notifications', 'read_logs'],
            super_admin: ['all']
        };

        return permissions[role] || permissions.user;
    }

    /**
     * Clean up rate limit store
     */
    cleanupRateLimitStore() {
        const now = Date.now();
        for (const [key, data] of this.rateLimitStore.entries()) {
            // Remove entries older than 1 hour
            if (now - data.windowStart > 3600000) {
                this.rateLimitStore.delete(key);
            }
        }
    }

    /**
     * Get connection statistics
     */
    getConnectionStats() {
        const stats = {
            totalConnections: this.connectedClients.size,
            authenticatedConnections: 0,
            adminConnections: 0,
            subscriptions: {}
        };

        for (const client of this.connectedClients.values()) {
            if (client.authenticated) {
                stats.authenticatedConnections++;
                if (client.role === 'admin' || client.role === 'super_admin') {
                    stats.adminConnections++;
                }
            }
        }

        for (const subscriptions of this.clientSubscriptions.values()) {
            for (const subscription of subscriptions) {
                stats.subscriptions[subscription] = (stats.subscriptions[subscription] || 0) + 1;
            }
        }

        return stats;
    }

    // Placeholder handlers for admin actions (implement based on your queue service)
    async handlePauseQueue(socket, data) {
        if (!this.requireAuth(socket, ['admin', 'super_admin'])) return;
        // Implementation depends on your queue service
        this.sendError(socket, 'NOT_IMPLEMENTED', 'Queue pause not implemented');
    }

    async handleResumeQueue(socket, data) {
        if (!this.requireAuth(socket, ['admin', 'super_admin'])) return;
        // Implementation depends on your queue service
        this.sendError(socket, 'NOT_IMPLEMENTED', 'Queue resume not implemented');
    }

    async handleClearFailedJobs(socket, data) {
        if (!this.requireAuth(socket, ['admin', 'super_admin'])) return;
        // Implementation depends on your queue service
        this.sendError(socket, 'NOT_IMPLEMENTED', 'Clear failed jobs not implemented');
    }

    async handleCancelNotification(socket, data) {
        if (!this.requireAuth(socket)) return;
        // Implementation depends on your notification service
        this.sendError(socket, 'NOT_IMPLEMENTED', 'Cancel notification not implemented');
    }

    async handleRetryNotification(socket, data) {
        if (!this.requireAuth(socket)) return;
        // Implementation depends on your notification service
        this.sendError(socket, 'NOT_IMPLEMENTED', 'Retry notification not implemented');
    }

    // Placeholder unsubscribe handlers
    handleUnsubscribeNotifications(socket, data) {
        const clientId = socket.id;
        socket.leave(ROOMS.NOTIFICATIONS);
        this.logger.info(`📬 Client unsubscribed from notifications: ${clientId}`);
    }

    handleUnsubscribeStats(socket, data) {
        const clientId = socket.id;
        socket.leave(ROOMS.STATS);
        this.logger.info(`📊 Client unsubscribed from stats: ${clientId}`);
    }
}

module.exports = WebSocketHandlers;