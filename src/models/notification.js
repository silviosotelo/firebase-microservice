// ==========================================
// NOTIFICATION MODEL
// Extended notification management with analytics
// ==========================================

const AppLogger = require('../utils/logger');
const { NOTIFICATION_STATUS, NOTIFICATION_TYPES } = require('../utils/constants');

class NotificationModel {
    constructor(db) {
        this.db = db;
        this.logger = new AppLogger('NotificationModel');
        
        // Prepared statements for better performance
        this.insertStmt = this.db.prepare(`
            INSERT INTO notifications (
                request_id, user_id, title, message, type, method,
                target_data, extra_data, priority, status, scheduled_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.findByIdStmt = this.db.prepare('SELECT * FROM notifications WHERE id = ?');
        this.findByRequestIdStmt = this.db.prepare('SELECT * FROM notifications WHERE request_id = ?');
        
        this.updateStatusStmt = this.db.prepare(`
            UPDATE notifications 
            SET status = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);

        this.updateResultStmt = this.db.prepare(`
            UPDATE notifications SET
                status = ?,
                total_sent = ?,
                successful = ?,
                failed = ?,
                success_rate = ?,
                processing_time = ?,
                firebase_response = ?,
                error_message = ?,
                started_at = ?,
                completed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        this.findPendingStmt = this.db.prepare(`
            SELECT * FROM notifications 
            WHERE status IN ('queued', 'processing') 
            ORDER BY created_at ASC
        `);

        this.findByUserStmt = this.db.prepare(`
            SELECT * FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `);

        this.countByUserStmt = this.db.prepare(`
            SELECT COUNT(*) as total FROM notifications WHERE user_id = ?
        `);

        this.findScheduledStmt = this.db.prepare(`
            SELECT * FROM notifications 
            WHERE scheduled_at IS NOT NULL 
            AND scheduled_at <= ? 
            AND status = 'queued'
            ORDER BY scheduled_at ASC
        `);
    }

    /**
     * Create new notification
     */
    create(data) {
        try {
            const {
                request_id, user_id, title, message, type = NOTIFICATION_TYPES.GENERAL,
                method, target_data, extra_data, priority = 'normal',
                status = NOTIFICATION_STATUS.QUEUED, scheduled_at = null
            } = data;

            const result = this.insertStmt.run(
                request_id, user_id, title, message, type, method,
                JSON.stringify(target_data), JSON.stringify(extra_data),
                priority, status, scheduled_at
            );

            this.logger.debug(`📋 Notification created: ${result.lastInsertRowid}`);
            
            return this.findById(result.lastInsertRowid);

        } catch (error) {
            this.logger.error('❌ Failed to create notification:', error);
            throw new Error(`Failed to create notification: ${error.message}`);
        }
    }

    /**
     * Find notification by ID
     */
    findById(id) {
        try {
            const notification = this.findByIdStmt.get(id);
            
            if (!notification) {
                return null;
            }

            return this.parseNotification(notification);

        } catch (error) {
            this.logger.error(`❌ Failed to find notification ${id}:`, error);
            throw new Error(`Failed to find notification: ${error.message}`);
        }
    }

    /**
     * Find notification by request ID
     */
    findByRequestId(requestId) {
        try {
            const notification = this.findByRequestIdStmt.get(requestId);
            
            if (!notification) {
                return null;
            }

            return this.parseNotification(notification);

        } catch (error) {
            this.logger.error(`❌ Failed to find notification by request ID ${requestId}:`, error);
            throw new Error(`Failed to find notification: ${error.message}`);
        }
    }

    /**
     * Update notification status
     */
    updateStatus(id, status, additionalData = {}) {
        try {
            // First update the status
            this.updateStatusStmt.run(status, id);

            // Update additional fields if provided
            if (Object.keys(additionalData).length > 0) {
                const fields = Object.keys(additionalData)
                    .map(key => `${key} = ?`)
                    .join(', ');
                const values = Object.values(additionalData);
                values.push(id);

                const updateStmt = this.db.prepare(`
                    UPDATE notifications 
                    SET ${fields}, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `);
                updateStmt.run(...values);
            }

            this.logger.debug(`🔄 Notification ${id} status updated to: ${status}`);
            
            return this.findById(id);

        } catch (error) {
            this.logger.error(`❌ Failed to update notification status ${id}:`, error);
            throw new Error(`Failed to update notification status: ${error.message}`);
        }
    }

    /**
     * Update notification with processing result
     */
    updateWithResult(id, result) {
        try {
            const {
                status = NOTIFICATION_STATUS.COMPLETED,
                total_sent = 0,
                successful = 0,
                failed = 0,
                success_rate = 0,
                processing_time = 0,
                firebase_response = null,
                error_message = null,
                started_at = null,
                completed_at = null
            } = result;

            this.updateResultStmt.run(
                status,
                total_sent,
                successful,
                failed,
                success_rate,
                processing_time,
                firebase_response ? JSON.stringify(firebase_response) : null,
                error_message,
                started_at,
                completed_at || new Date().toISOString(),
                id
            );

            this.logger.debug(`✅ Notification ${id} result updated: ${successful}/${total_sent} successful`);
            
            return this.findById(id);

        } catch (error) {
            this.logger.error(`❌ Failed to update notification result ${id}:`, error);
            throw new Error(`Failed to update notification result: ${error.message}`);
        }
    }

    /**
     * Find multiple notifications with filters and pagination
     */
    findMany(options = {}) {
        try {
            const {
                filters = {},
                limit = 50,
                offset = 0,
                sortBy = 'created_at',
                sortOrder = 'DESC'
            } = options;

            let query = 'SELECT * FROM notifications';
            let countQuery = 'SELECT COUNT(*) as total FROM notifications';
            const params = [];
            const whereConditions = [];

            // Build WHERE conditions
            if (filters.status) {
                if (Array.isArray(filters.status)) {
                    const placeholders = filters.status.map(() => '?').join(',');
                    whereConditions.push(`status IN (${placeholders})`);
                    params.push(...filters.status);
                } else {
                    whereConditions.push('status = ?');
                    params.push(filters.status);
                }
            }

            if (filters.type) {
                whereConditions.push('type = ?');
                params.push(filters.type);
            }

            if (filters.user_id) {
                whereConditions.push('user_id = ?');
                params.push(filters.user_id);
            }

            if (filters.priority) {
                whereConditions.push('priority = ?');
                params.push(filters.priority);
            }

            if (filters.created_at_from) {
                whereConditions.push('created_at >= ?');
                params.push(filters.created_at_from);
            }

            if (filters.created_at_to) {
                whereConditions.push('created_at <= ?');
                params.push(filters.created_at_to);
            }

            if (filters.search) {
                whereConditions.push('(title LIKE ? OR message LIKE ?)');
                const searchTerm = `%${filters.search}%`;
                params.push(searchTerm, searchTerm);
            }

            // Add WHERE clause if conditions exist
            if (whereConditions.length > 0) {
                const whereClause = ` WHERE ${whereConditions.join(' AND ')}`;
                query += whereClause;
                countQuery += whereClause;
            }

            // Get total count
            const countStmt = this.db.prepare(countQuery);
            const totalResult = countStmt.get(...params);
            const total = totalResult.total;

            // Add sorting and pagination
            const validSortFields = ['created_at', 'updated_at', 'priority', 'status', 'success_rate'];
            const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
            const finalSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
            
            query += ` ORDER BY ${finalSortBy} ${finalSortOrder} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const stmt = this.db.prepare(query);
            const notifications = stmt.all(...params);

            // Parse notifications
            const parsedNotifications = notifications.map(n => this.parseNotification(n));

            return {
                data: parsedNotifications,
                total,
                offset,
                limit,
                hasNext: offset + limit < total,
                hasPrev: offset > 0
            };

        } catch (error) {
            this.logger.error('❌ Failed to find notifications:', error);
            throw new Error(`Failed to find notifications: ${error.message}`);
        }
    }

    /**
     * Get pending notifications (queued or processing)
     */
    findPending(limit = 100) {
        try {
            const notifications = this.findPendingStmt.all();
            
            return notifications
                .slice(0, limit)
                .map(n => this.parseNotification(n));

        } catch (error) {
            this.logger.error('❌ Failed to find pending notifications:', error);
            throw new Error(`Failed to find pending notifications: ${error.message}`);
        }
    }

    /**
     * Find notifications by user ID
     */
    findByUser(userId, limit = 50, offset = 0) {
        try {
            const notifications = this.findByUserStmt.all(userId, limit, offset);
            const countResult = this.countByUserStmt.get(userId);
            
            return {
                data: notifications.map(n => this.parseNotification(n)),
                total: countResult.total,
                offset,
                limit
            };

        } catch (error) {
            this.logger.error(`❌ Failed to find notifications for user ${userId}:`, error);
            throw new Error(`Failed to find user notifications: ${error.message}`);
        }
    }

    /**
     * Find scheduled notifications ready for processing
     */
    findScheduledReady(currentTime = new Date().toISOString()) {
        try {
            const notifications = this.findScheduledStmt.all(currentTime);
            
            return notifications.map(n => this.parseNotification(n));

        } catch (error) {
            this.logger.error('❌ Failed to find scheduled notifications:', error);
            throw new Error(`Failed to find scheduled notifications: ${error.message}`);
        }
    }

    /**
     * Get notification statistics
     */
    getStats(options = {}) {
        try {
            const {
                dateFrom,
                dateTo,
                groupBy = 'hour',
                userId,
                type,
                status
            } = options;

            const params = [];
            let whereConditions = [];

            // Build WHERE conditions
            if (dateFrom) {
                whereConditions.push('created_at >= ?');
                params.push(dateFrom);
            }
            if (dateTo) {
                whereConditions.push('created_at <= ?');
                params.push(dateTo);
            }
            if (userId) {
                whereConditions.push('user_id = ?');
                params.push(userId);
            }
            if (type) {
                whereConditions.push('type = ?');
                params.push(type);
            }
            if (status) {
                whereConditions.push('status = ?');
                params.push(status);
            }

            const whereClause = whereConditions.length > 0 
                ? ` WHERE ${whereConditions.join(' AND ')}`
                : '';

            // Overall stats
            const overallQuery = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                    SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                    SUM(total_sent) as total_sent,
                    SUM(successful) as total_successful,
                    SUM(failed) as total_failed,
                    AVG(processing_time) as avg_processing_time,
                    AVG(success_rate) as avg_success_rate,
                    MIN(created_at) as first_notification,
                    MAX(created_at) as last_notification
                FROM notifications
                ${whereClause}
            `;

            const overallStmt = this.db.prepare(overallQuery);
            const overall = overallStmt.get(...params);

            // Time series stats
            const dateFormat = this.getDateFormat(groupBy);
            const timeSeriesQuery = `
                SELECT 
                    strftime('${dateFormat}', created_at) as period,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                    SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                    SUM(total_sent) as total_sent,
                    SUM(successful) as total_successful,
                    SUM(failed) as total_failed,
                    AVG(processing_time) as avg_processing_time,
                    AVG(success_rate) as avg_success_rate
                FROM notifications
                ${whereClause}
                GROUP BY strftime('${dateFormat}', created_at)
                ORDER BY period
            `;

            const timeSeriesStmt = this.db.prepare(timeSeriesQuery);
            const timeSeries = timeSeriesStmt.all(...params);

            // Type distribution
            const typeQuery = `
                SELECT 
                    type,
                    COUNT(*) as count,
                    AVG(success_rate) as avg_success_rate
                FROM notifications
                ${whereClause}
                GROUP BY type
                ORDER BY count DESC
            `;

            const typeStmt = this.db.prepare(typeQuery);
            const typeDistribution = typeStmt.all(...params);

            // Status distribution
            const statusQuery = `
                SELECT 
                    status,
                    COUNT(*) as count,
                    AVG(processing_time) as avg_processing_time
                FROM notifications
                ${whereClause}
                GROUP BY status
                ORDER BY count DESC
            `;

            const statusStmt = this.db.prepare(statusQuery);
            const statusDistribution = statusStmt.all(...params);

            return {
                overall,
                timeSeries,
                typeDistribution,
                statusDistribution,
                groupBy,
                dateRange: { from: dateFrom, to: dateTo }
            };

        } catch (error) {
            this.logger.error('❌ Failed to get notification stats:', error);
            throw new Error(`Failed to get notification statistics: ${error.message}`);
        }
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics(hours = 24) {
        try {
            const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
            
            const query = `
                SELECT 
                    AVG(processing_time) as avg_processing_time,
                    MIN(processing_time) as min_processing_time,
                    MAX(processing_time) as max_processing_time,
                    PERCENTILE_90(processing_time) as p90_processing_time,
                    AVG(success_rate) as avg_success_rate,
                    COUNT(*) as total_processed,
                    SUM(CASE WHEN processing_time > 10 THEN 1 ELSE 0 END) as slow_notifications,
                    SUM(total_sent) as total_messages_sent,
                    SUM(successful) as total_messages_successful,
                    SUM(failed) as total_messages_failed
                FROM notifications 
                WHERE completed_at >= ? 
                AND status = 'completed'
            `;

            const stmt = this.db.prepare(query);
            const metrics = stmt.get(since);

            return {
                ...metrics,
                period_hours: hours,
                calculated_at: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('❌ Failed to get performance metrics:', error);
            throw new Error(`Failed to get performance metrics: ${error.message}`);
        }
    }

    /**
     * Clean up old notifications
     */
    cleanup(retentionDays = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            const deleteStmt = this.db.prepare(`
                DELETE FROM notifications 
                WHERE created_at < ? 
                AND status IN ('completed', 'failed', 'cancelled')
            `);
            
            const result = deleteStmt.run(cutoffDate.toISOString());
            
            this.logger.info(`🧹 Cleaned up ${result.changes} old notifications`);
            
            return {
                deleted: result.changes,
                cutoffDate: cutoffDate.toISOString(),
                retentionDays
            };

        } catch (error) {
            this.logger.error('❌ Failed to cleanup notifications:', error);
            throw new Error(`Failed to cleanup notifications: ${error.message}`);
        }
    }

    /**
     * Get top users by notification count
     */
    getTopUsers(limit = 10, days = 30) {
        try {
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            
            const query = `
                SELECT 
                    user_id,
                    COUNT(*) as notification_count,
                    SUM(total_sent) as total_messages,
                    AVG(success_rate) as avg_success_rate,
                    MAX(created_at) as last_notification
                FROM notifications 
                WHERE created_at >= ? 
                AND user_id IS NOT NULL
                GROUP BY user_id
                ORDER BY notification_count DESC
                LIMIT ?
            `;

            const stmt = this.db.prepare(query);
            const topUsers = stmt.all(since, limit);

            return topUsers;

        } catch (error) {
            this.logger.error('❌ Failed to get top users:', error);
            throw new Error(`Failed to get top users: ${error.message}`);
        }
    }

    /**
     * Get error analysis
     */
    getErrorAnalysis(days = 7) {
        try {
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            
            const query = `
                SELECT 
                    error_message,
                    COUNT(*) as occurrence_count,
                    MAX(created_at) as last_occurrence,
                    type,
                    AVG(processing_time) as avg_processing_time
                FROM notifications 
                WHERE created_at >= ? 
                AND status = 'failed'
                AND error_message IS NOT NULL
                GROUP BY error_message, type
                ORDER BY occurrence_count DESC
                LIMIT 20
            `;

            const stmt = this.db.prepare(query);
            const errors = stmt.all(since);

            return errors;

        } catch (error) {
            this.logger.error('❌ Failed to get error analysis:', error);
            throw new Error(`Failed to get error analysis: ${error.message}`);
        }
    }

    /**
     * Parse notification object
     */
    parseNotification(notification) {
        if (!notification) return null;

        try {
            // Parse JSON fields
            if (notification.target_data) {
                try {
                    notification.target_data = JSON.parse(notification.target_data);
                } catch (e) {
                    notification.target_data = {};
                }
            }

            if (notification.extra_data) {
                try {
                    notification.extra_data = JSON.parse(notification.extra_data);
                } catch (e) {
                    notification.extra_data = {};
                }
            }

            if (notification.firebase_response) {
                try {
                    notification.firebase_response = JSON.parse(notification.firebase_response);
                } catch (e) {
                    notification.firebase_response = null;
                }
            }

            return notification;

        } catch (error) {
            this.logger.error('❌ Failed to parse notification:', error);
            return notification;
        }
    }

    /**
     * Get date format for grouping
     */
    getDateFormat(groupBy) {
        const formats = {
            hour: '%Y-%m-%d %H:00:00',
            day: '%Y-%m-%d',
            week: '%Y-%W',
            month: '%Y-%m',
            year: '%Y'
        };
        
        return formats[groupBy] || formats.hour;
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Test basic operations
            const recentCount = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM notifications 
                WHERE created_at >= datetime('now', '-1 hour')
            `).get();

            const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM notifications').get();

            return {
                healthy: true,
                totalNotifications: totalCount.count,
                recentNotifications: recentCount.count,
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

module.exports = NotificationModel;