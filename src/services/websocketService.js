// ==========================================
// WEBSOCKET SERVICE - Real-time Tracking
// Handles real-time notifications and stats
// ==========================================

const AppLogger = require('../utils/logger');
const { WEBSOCKET_EVENTS, USER_ROLES } = require('../utils/constants');

class WebSocketService {
    constructor(dependencies = {}, options = {}) {
        this.io = options.io;
        this.logger = new AppLogger('WebSocketService');
        this.connections = new Map(); // userId -> socket mapping
        this.rooms = new Set(); // Active rooms
        this.stats = {
            totalConnections: 0,
            activeConnections: 0,
            totalMessages: 0,
            messagesPerSecond: 0
        };
        this.messageCounter = 0;
        this.lastMessageTime = Date.now();
        this.initialized = false;
    }

    /**
     * Initialize WebSocket service
     */
    async initialize() {
        try {
            this.logger.info('🔌 Initializing WebSocket service...');
            
            this.setupConnectionHandlers();
            this.setupPeriodicTasks();
            
            this.initialized = true;
            this.logger.info('✅ WebSocket service initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ WebSocket service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Setup connection handlers
     */
    setupConnectionHandlers() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(socket) {
        const userId = socket.user?.id || 'anonymous';
        const userRole = socket.user?.role || USER_ROLES.VIEWER;
        
        this.logger.info(`🔗 New WebSocket connection: ${userId} (${socket.id})`);
        
        // Update stats
        this.stats.totalConnections++;
        this.stats.activeConnections++;
        
        // Store connection
        this.connections.set(socket.id, {
            socket,
            userId,
            userRole,
            connectedAt: new Date(),
            lastActivity: new Date()
        });

        // Join user-specific room
        socket.join(`user:${userId}`);
        
        // Join role-based rooms
        socket.join(`role:${userRole}`);
        
        // Admin users join admin room
        if (userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN) {
            socket.join('admin');
            this.rooms.add('admin');
        }

        // Send welcome message
        socket.emit(WEBSOCKET_EVENTS.CONNECTED, {
            message: 'Connected to Firebase Notification Service',
            userId,
            role: userRole,
            timestamp: new Date().toISOString(),
            stats: this.getPublicStats()
        });

        // Setup event handlers
        this.setupSocketEventHandlers(socket);

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            this.handleDisconnection(socket, reason);
        });

        // Broadcast new connection to admins
        this.broadcastToRole(USER_ROLES.ADMIN, WEBSOCKET_EVENTS.USER_CONNECTED, {
            userId,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Setup socket event handlers
     */
    setupSocketEventHandlers(socket) {
        const connection = this.connections.get(socket.id);
        
        // Subscribe to specific notification updates
        socket.on(WEBSOCKET_EVENTS.SUBSCRIBE_NOTIFICATION, (data) => {
            this.handleNotificationSubscription(socket, data);
        });

        // Unsubscribe from notification updates
        socket.on(WEBSOCKET_EVENTS.UNSUBSCRIBE_NOTIFICATION, (data) => {
            this.handleNotificationUnsubscription(socket, data);
        });

        // Subscribe to stats updates
        socket.on(WEBSOCKET_EVENTS.SUBSCRIBE_STATS, () => {
            socket.join('stats');
            this.rooms.add('stats');
            this.logger.debug(`📊 ${connection.userId} subscribed to stats updates`);
        });

        // Subscribe to live logs (admin only)
        socket.on(WEBSOCKET_EVENTS.SUBSCRIBE_LOGS, () => {
            if (connection.userRole === USER_ROLES.ADMIN || connection.userRole === USER_ROLES.SUPER_ADMIN) {
                socket.join('logs');
                this.rooms.add('logs');
                this.logger.debug(`📝 ${connection.userId} subscribed to live logs`);
            } else {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    message: 'Insufficient permissions to subscribe to logs',
                    code: 'PERMISSION_DENIED'
                });
            }
        });

        // Get real-time notification status
        socket.on(WEBSOCKET_EVENTS.GET_NOTIFICATION_STATUS, async (data) => {
            await this.handleGetNotificationStatus(socket, data);
        });

        // Heartbeat/ping
        socket.on('ping', () => {
            connection.lastActivity = new Date();
            socket.emit('pong', { timestamp: new Date().toISOString() });
        });

        // Update activity on any message
        socket.onAny(() => {
            connection.lastActivity = new Date();
            this.messageCounter++;
        });
    }

    /**
     * Handle notification subscription
     */
    handleNotificationSubscription(socket, data) {
        const connection = this.connections.get(socket.id);
        const { notificationId } = data;

        if (!notificationId) {
            socket.emit(WEBSOCKET_EVENTS.ERROR, {
                message: 'Notification ID is required',
                code: 'INVALID_NOTIFICATION_ID'
            });
            return;
        }

        // Join notification-specific room
        const room = `notification:${notificationId}`;
        socket.join(room);
        this.rooms.add(room);

        this.logger.debug(`🔔 ${connection.userId} subscribed to notification ${notificationId}`);

        socket.emit(WEBSOCKET_EVENTS.SUBSCRIBED, {
            type: 'notification',
            id: notificationId,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle notification unsubscription
     */
    handleNotificationUnsubscription(socket, data) {
        const connection = this.connections.get(socket.id);
        const { notificationId } = data;

        if (notificationId) {
            const room = `notification:${notificationId}`;
            socket.leave(room);
            this.logger.debug(`🔕 ${connection.userId} unsubscribed from notification ${notificationId}`);
        }
    }

    /**
     * Handle get notification status
     */
    async handleGetNotificationStatus(socket, data) {
        try {
            const { notificationId } = data;
            
            if (!notificationId) {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    message: 'Notification ID is required',
                    code: 'INVALID_NOTIFICATION_ID'
                });
                return;
            }

            // Get notification status from database
            const Notification = require('../models/notification');
            const notification = await Notification.findById(notificationId);

            if (!notification) {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    message: 'Notification not found',
                    code: 'NOTIFICATION_NOT_FOUND'
                });
                return;
            }

            socket.emit(WEBSOCKET_EVENTS.NOTIFICATION_STATUS, {
                notification,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('Error getting notification status:', error);
            socket.emit(WEBSOCKET_EVENTS.ERROR, {
                message: 'Failed to get notification status',
                code: 'INTERNAL_ERROR'
            });
        }
    }

    /**
     * Handle disconnection
     */
    handleDisconnection(socket, reason) {
        const connection = this.connections.get(socket.id);
        
        if (connection) {
            this.logger.info(`🔗 WebSocket disconnected: ${connection.userId} (${socket.id}) - ${reason}`);
            
            // Update stats
            this.stats.activeConnections--;
            
            // Remove from connections
            this.connections.delete(socket.id);

            // Broadcast disconnection to admins
            this.broadcastToRole(USER_ROLES.ADMIN, WEBSOCKET_EVENTS.USER_DISCONNECTED, {
                userId: connection.userId,
                socketId: socket.id,
                reason,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Broadcast notification update
     */
    broadcastNotificationUpdate(notificationId, update) {
        try {
            const room = `notification:${notificationId}`;
            
            this.io.to(room).emit(WEBSOCKET_EVENTS.NOTIFICATION_UPDATE, {
                notificationId,
                update,
                timestamp: new Date().toISOString()
            });

            this.logger.debug(`📡 Broadcasted notification update for ${notificationId}`);
            
        } catch (error) {
            this.logger.error('Error broadcasting notification update:', error);
        }
    }

    /**
     * Broadcast notification progress
     */
    broadcastNotificationProgress(notificationId, progress) {
        try {
            const room = `notification:${notificationId}`;
            
            this.io.to(room).emit(WEBSOCKET_EVENTS.NOTIFICATION_PROGRESS, {
                notificationId,
                progress,
                timestamp: new Date().toISOString()
            });

            // Also broadcast to stats room for dashboard
            this.io.to('stats').emit(WEBSOCKET_EVENTS.STATS_UPDATE, {
                type: 'notification_progress',
                data: { notificationId, progress }
            });

            this.logger.debug(`📊 Broadcasted progress for notification ${notificationId}`);
            
        } catch (error) {
            this.logger.error('Error broadcasting notification progress:', error);
        }
    }

    /**
     * Broadcast stats update
     */
    broadcastStatsUpdate(stats) {
        try {
            this.io.to('stats').emit(WEBSOCKET_EVENTS.STATS_UPDATE, {
                type: 'general',
                stats,
                timestamp: new Date().toISOString()
            });

            this.logger.debug('📊 Broadcasted stats update');
            
        } catch (error) {
            this.logger.error('Error broadcasting stats update:', error);
        }
    }

    /**
     * Broadcast system alert
     */
    broadcastSystemAlert(alert) {
        try {
            // Send to all admin users
            this.io.to('admin').emit(WEBSOCKET_EVENTS.SYSTEM_ALERT, {
                ...alert,
                timestamp: new Date().toISOString()
            });

            this.logger.info(`🚨 Broadcasted system alert: ${alert.type}`);
            
        } catch (error) {
            this.logger.error('Error broadcasting system alert:', error);
        }
    }

    /**
     * Broadcast to specific user
     */
    broadcastToUser(userId, event, data) {
        try {
            this.io.to(`user:${userId}`).emit(event, {
                ...data,
                timestamp: new Date().toISOString()
            });

            this.logger.debug(`📤 Sent ${event} to user ${userId}`);
            
        } catch (error) {
            this.logger.error(`Error broadcasting to user ${userId}:`, error);
        }
    }

    /**
     * Broadcast to specific role
     */
    broadcastToRole(role, event, data) {
        try {
            this.io.to(`role:${role}`).emit(event, {
                ...data,
                timestamp: new Date().toISOString()
            });

            this.logger.debug(`📤 Sent ${event} to role ${role}`);
            
        } catch (error) {
            this.logger.error(`Error broadcasting to role ${role}:`, error);
        }
    }

    /**
     * Broadcast log message (admin only)
     */
    broadcastLogMessage(logLevel, message, meta = {}) {
        try {
            this.io.to('logs').emit(WEBSOCKET_EVENTS.LOG_MESSAGE, {
                level: logLevel,
                message,
                meta,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.logger.error('Error broadcasting log message:', error);
        }
    }

    /**
     * Get connection statistics
     */
    getConnectionStats() {
        const connections = Array.from(this.connections.values());
        
        return {
            ...this.stats,
            connectionsByRole: this.groupBy(connections, 'userRole'),
            roomCounts: Object.fromEntries(
                Array.from(this.rooms).map(room => [
                    room,
                    this.io.sockets.adapter.rooms.get(room)?.size || 0
                ])
            ),
            averageSessionDuration: this.calculateAverageSessionDuration(connections)
        };
    }

    /**
     * Get public stats (safe to expose)
     */
    getPublicStats() {
        return {
            activeConnections: this.stats.activeConnections,
            totalConnections: this.stats.totalConnections,
            messagesPerSecond: this.stats.messagesPerSecond,
            uptime: process.uptime()
        };
    }

    /**
     * Setup periodic tasks
     */
    setupPeriodicTasks() {
        // Update messages per second every second
        setInterval(() => {
            const now = Date.now();
            const timeDiff = (now - this.lastMessageTime) / 1000;
            
            this.stats.messagesPerSecond = timeDiff > 0 ? this.messageCounter / timeDiff : 0;
            this.messageCounter = 0;
            this.lastMessageTime = now;
        }, 1000);

        // Cleanup inactive connections every 30 seconds
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 30000);

        // Broadcast stats every 5 seconds
        setInterval(() => {
            if (this.io.sockets.adapter.rooms.get('stats')?.size > 0) {
                this.broadcastStatsUpdate(this.getPublicStats());
            }
        }, 5000);
    }

    /**
     * Cleanup inactive connections
     */
    cleanupInactiveConnections() {
        const now = new Date();
        const timeout = 5 * 60 * 1000; // 5 minutes

        for (const [socketId, connection] of this.connections.entries()) {
            if (now - connection.lastActivity > timeout) {
                this.logger.warn(`🧹 Cleaning up inactive connection: ${connection.userId} (${socketId})`);
                
                connection.socket.disconnect(true);
                this.connections.delete(socketId);
                this.stats.activeConnections--;
            }
        }
    }

    /**
     * Helper method to group array by property
     */
    groupBy(array, property) {
        return array.reduce((groups, item) => {
            const key = item[property];
            groups[key] = (groups[key] || 0) + 1;
            return groups;
        }, {});
    }

    /**
     * Calculate average session duration
     */
    calculateAverageSessionDuration(connections) {
        if (connections.length === 0) return 0;
        
        const now = new Date();
        const totalDuration = connections.reduce((sum, conn) => {
            return sum + (now - conn.connectedAt);
        }, 0);
        
        return totalDuration / connections.length;
    }

    /**
     * Get service health status
     */
    async getHealthStatus() {
        try {
            return {
                service: 'WebSocketService',
                status: 'healthy',
                initialized: this.initialized,
                stats: this.getConnectionStats(),
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                service: 'WebSocketService',
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.logger.info('🧹 Cleaning up WebSocket service...');
        
        // Disconnect all clients
        this.io.disconnectSockets(true);
        
        // Clear data structures
        this.connections.clear();
        this.rooms.clear();
        
        this.initialized = false;
        this.logger.info('✅ WebSocket service cleaned up');
    }
}

module.exports = WebSocketService;