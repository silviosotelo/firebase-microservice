// ==========================================
// RESPONSE MODEL
// Firebase response tracking and analytics
// ==========================================

const AppLogger = require('../utils/logger');

class ResponseModel {
    constructor(db) {
        this.db = db;
        this.logger = new AppLogger('ResponseModel');
        
        // Prepared statements for optimal performance
        this.insertStmt = this.db.prepare(`
            INSERT INTO firebase_responses (
                notification_id, token, success, error_code,
                error_message, firebase_message_id, attempt_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        this.findByNotificationStmt = this.db.prepare(`
            SELECT * FROM firebase_responses 
            WHERE notification_id = ? 
            ORDER BY created_at ASC
        `);

        this.findByTokenStmt = this.db.prepare(`
            SELECT * FROM firebase_responses 
            WHERE token = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `);

        this.findFailedByTokenStmt = this.db.prepare(`
            SELECT * FROM firebase_responses 
            WHERE token = ? AND success = 0
            ORDER BY created_at DESC 
            LIMIT ?
        `);

        this.updateStmt = this.db.prepare(`
            UPDATE firebase_responses 
            SET success = ?, error_code = ?, error_message = ?, firebase_message_id = ?
            WHERE id = ?
        `);

        this.deleteByNotificationStmt = this.db.prepare(`
            DELETE FROM firebase_responses WHERE notification_id = ?
        `);
    }

    /**
     * Create new response record
     */
    create(data) {
        try {
            const {
                notification_id,
                token,
                success = false,
                error_code = null,
                error_message = null,
                firebase_message_id = null,
                attempt_number = 1
            } = data;

            const result = this.insertStmt.run(
                notification_id,
                token,
                success ? 1 : 0,
                error_code,
                error_message,
                firebase_message_id,
                attempt_number
            );

            this.logger.debug(`📝 Response recorded: ${result.lastInsertRowid} (${success ? 'success' : 'failed'})`);
            
            return result.lastInsertRowid;

        } catch (error) {
            this.logger.error('❌ Failed to create response:', error);
            throw new Error(`Failed to create response: ${error.message}`);
        }
    }

    /**
     * Bulk create response records
     */
    createBulk(responses) {
        try {
            const transaction = this.db.transaction((responses) => {
                const results = [];
                
                for (const response of responses) {
                    const id = this.create(response);
                    results.push(id);
                }
                
                return results;
            });

            const results = transaction(responses);
            
            this.logger.debug(`📝 Bulk responses recorded: ${results.length}`);
            
            return results;

        } catch (error) {
            this.logger.error('❌ Failed to create bulk responses:', error);
            throw new Error(`Failed to create bulk responses: ${error.message}`);
        }
    }

    /**
     * Get responses by notification ID
     */
    getByNotificationId(notificationId) {
        try {
            const responses = this.findByNotificationStmt.all(notificationId);
            
            return responses.map(response => ({
                ...response,
                success: Boolean(response.success)
            }));

        } catch (error) {
            this.logger.error(`❌ Failed to get responses for notification ${notificationId}:`, error);
            throw new Error(`Failed to get responses: ${error.message}`);
        }
    }

    /**
     * Get responses by token
     */
    getByToken(token, limit = 50, offset = 0) {
        try {
            const responses = this.findByTokenStmt.all(token, limit, offset);
            
            return responses.map(response => ({
                ...response,
                success: Boolean(response.success)
            }));

        } catch (error) {
            this.logger.error(`❌ Failed to get responses for token:`, error);
            throw new Error(`Failed to get token responses: ${error.message}`);
        }
    }

    /**
     * Get failed responses for a token
     */
    getFailedByToken(token, limit = 10) {
        try {
            const responses = this.findFailedByTokenStmt.all(token, limit);
            
            return responses.map(response => ({
                ...response,
                success: Boolean(response.success)
            }));

        } catch (error) {
            this.logger.error(`❌ Failed to get failed responses for token:`, error);
            throw new Error(`Failed to get failed responses: ${error.message}`);
        }
    }

    /**
     * Update response record
     */
    update(id, data) {
        try {
            const {
                success,
                error_code = null,
                error_message = null,
                firebase_message_id = null
            } = data;

            this.updateStmt.run(
                success ? 1 : 0,
                error_code,
                error_message,
                firebase_message_id,
                id
            );

            this.logger.debug(`🔄 Response updated: ${id}`);
            
            return true;

        } catch (error) {
            this.logger.error(`❌ Failed to update response ${id}:`, error);
            throw new Error(`Failed to update response: ${error.message}`);
        }
    }

    /**
     * Delete responses by notification ID
     */
    deleteByNotificationId(notificationId) {
        try {
            const result = this.deleteByNotificationStmt.run(notificationId);
            
            this.logger.debug(`🗑️ Deleted ${result.changes} responses for notification ${notificationId}`);
            
            return result.changes;

        } catch (error) {
            this.logger.error(`❌ Failed to delete responses for notification ${notificationId}:`, error);
            throw new Error(`Failed to delete responses: ${error.message}`);
        }
    }

    /**
     * Get response statistics for a notification
     */
    getNotificationStats(notificationId) {
        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
                    GROUP_CONCAT(DISTINCT error_code) as error_codes,
                    AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100 as success_rate
                FROM firebase_responses 
                WHERE notification_id = ?
            `;

            const statsStmt = this.db.prepare(statsQuery);
            const stats = statsStmt.get(notificationId);

            // Get error breakdown
            const errorQuery = `
                SELECT 
                    error_code,
                    error_message,
                    COUNT(*) as count
                FROM firebase_responses 
                WHERE notification_id = ? AND success = 0
                GROUP BY error_code, error_message
                ORDER BY count DESC
            `;

            const errorStmt = this.db.prepare(errorQuery);
            const errorBreakdown = errorStmt.all(notificationId);

            return {
                total: stats.total || 0,
                successful: stats.successful || 0,
                failed: stats.failed || 0,
                successRate: stats.success_rate || 0,
                errorCodes: stats.error_codes ? stats.error_codes.split(',') : [],
                errorBreakdown
            };

        } catch (error) {
            this.logger.error(`❌ Failed to get response stats for notification ${notificationId}:`, error);
            throw new Error(`Failed to get response statistics: ${error.message}`);
        }
    }

    /**
     * Get token health status
     */
    getTokenHealth(token, days = 30) {
        try {
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            
            const healthQuery = `
                SELECT 
                    COUNT(*) as total_attempts,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_attempts,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_attempts,
                    AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
                    MAX(created_at) as last_attempt,
                    GROUP_CONCAT(DISTINCT error_code) as error_codes
                FROM firebase_responses 
                WHERE token = ? AND created_at >= ?
            `;

            const healthStmt = this.db.prepare(healthQuery);
            const health = healthStmt.get(token, since);

            // Determine token status
            let status = 'healthy';
            if (health.total_attempts === 0) {
                status = 'inactive';
            } else if (health.success_rate < 50) {
                status = 'unhealthy';
            } else if (health.success_rate < 80) {
                status = 'degraded';
            }

            return {
                token: this.maskToken(token),
                status,
                totalAttempts: health.total_attempts || 0,
                successfulAttempts: health.successful_attempts || 0,
                failedAttempts: health.failed_attempts || 0,
                successRate: health.success_rate || 0,
                lastAttempt: health.last_attempt,
                errorCodes: health.error_codes ? health.error_codes.split(',') : [],
                periodDays: days
            };

        } catch (error) {
            this.logger.error(`❌ Failed to get token health:`, error);
            throw new Error(`Failed to get token health: ${error.message}`);
        }
    }

    /**
     * Get error analysis
     */
    getErrorAnalysis(options = {}) {
        try {
            const {
                days = 7,
                limit = 20,
                notificationId = null,
                errorCode = null
            } = options;

            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const params = [since];
            let whereConditions = ['created_at >= ?', 'success = 0'];

            if (notificationId) {
                whereConditions.push('notification_id = ?');
                params.push(notificationId);
            }

            if (errorCode) {
                whereConditions.push('error_code = ?');
                params.push(errorCode);
            }

            const query = `
                SELECT 
                    error_code,
                    error_message,
                    COUNT(*) as occurrence_count,
                    COUNT(DISTINCT notification_id) as affected_notifications,
                    COUNT(DISTINCT token) as affected_tokens,
                    MAX(created_at) as last_occurrence,
                    MIN(created_at) as first_occurrence
                FROM firebase_responses 
                WHERE ${whereConditions.join(' AND ')}
                GROUP BY error_code, error_message
                ORDER BY occurrence_count DESC
                LIMIT ?
            `;

            const stmt = this.db.prepare(query);
            const errors = stmt.all(...params, limit);

            return errors;

        } catch (error) {
            this.logger.error('❌ Failed to get error analysis:', error);
            throw new Error(`Failed to get error analysis: ${error.message}`);
        }
    }

    /**
     * Get delivery timeline for a notification
     */
    getDeliveryTimeline(notificationId) {
        try {
            const query = `
                SELECT 
                    token,
                    success,
                    error_code,
                    error_message,
                    firebase_message_id,
                    attempt_number,
                    created_at
                FROM firebase_responses 
                WHERE notification_id = ?
                ORDER BY created_at ASC
            `;

            const stmt = this.db.prepare(query);
            const timeline = stmt.all(notificationId);

            return timeline.map(entry => ({
                ...entry,
                token: this.maskToken(entry.token),
                success: Boolean(entry.success),
                timestamp: entry.created_at
            }));

        } catch (error) {
            this.logger.error(`❌ Failed to get delivery timeline for notification ${notificationId}:`, error);
            throw new Error(`Failed to get delivery timeline: ${error.message}`);
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
                    COUNT(*) as total_responses,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_responses,
                    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_responses,
                    AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100 as overall_success_rate,
                    COUNT(DISTINCT notification_id) as notifications_processed,
                    COUNT(DISTINCT token) as unique_tokens,
                    COUNT(DISTINCT error_code) as unique_error_codes
                FROM firebase_responses 
                WHERE created_at >= ?
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
     * Get top error codes
     */
    getTopErrorCodes(days = 7, limit = 10) {
        try {
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            
            const query = `
                SELECT 
                    error_code,
                    COUNT(*) as occurrence_count,
                    COUNT(DISTINCT notification_id) as affected_notifications,
                    COUNT(DISTINCT token) as affected_tokens,
                    MAX(created_at) as last_occurrence,
                    GROUP_CONCAT(DISTINCT error_message) as sample_messages
                FROM firebase_responses 
                WHERE created_at >= ? AND success = 0 AND error_code IS NOT NULL
                GROUP BY error_code
                ORDER BY occurrence_count DESC
                LIMIT ?
            `;

            const stmt = this.db.prepare(query);
            const topErrors = stmt.all(since, limit);

            return topErrors;

        } catch (error) {
            this.logger.error('❌ Failed to get top error codes:', error);
            throw new Error(`Failed to get top error codes: ${error.message}`);
        }
    }

    /**
     * Clean up old responses
     */
    cleanup(retentionDays = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            const deleteStmt = this.db.prepare(`
                DELETE FROM firebase_responses 
                WHERE created_at < ?
            `);
            
            const result = deleteStmt.run(cutoffDate.toISOString());
            
            this.logger.info(`🧹 Cleaned up ${result.changes} old responses`);
            
            return {
                deleted: result.changes,
                cutoffDate: cutoffDate.toISOString(),
                retentionDays
            };

        } catch (error) {
            this.logger.error('❌ Failed to cleanup responses:', error);
            throw new Error(`Failed to cleanup responses: ${error.message}`);
        }
    }

    /**
     * Export delivery report as CSV
     */
    exportDeliveryReport(notificationId) {
        try {
            const responses = this.getByNotificationId(notificationId);
            
            if (responses.length === 0) {
                return 'No responses found for this notification\n';
            }

            // CSV headers
            const headers = [
                'Token (Masked)',
                'Success',
                'Error Code',
                'Error Message',
                'Firebase Message ID',
                'Attempt Number',
                'Timestamp'
            ];

            // CSV rows
            const rows = responses.map(response => [
                this.maskToken(response.token),
                response.success ? 'Yes' : 'No',
                response.error_code || '',
                response.error_message || '',
                response.firebase_message_id || '',
                response.attempt_number || 1,
                response.created_at
            ]);

            // Build CSV
            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(field => 
                    typeof field === 'string' && field.includes(',') 
                        ? `"${field.replace(/"/g, '""')}"` 
                        : field
                ).join(','))
            ].join('\n');

            return csvContent;

        } catch (error) {
            this.logger.error(`❌ Failed to export delivery report for notification ${notificationId}:`, error);
            throw new Error(`Failed to export delivery report: ${error.message}`);
        }
    }

    /**
     * Mask token for privacy
     */
    maskToken(token) {
        if (!token || token.length < 20) {
            return '***';
        }
        
        return token.substring(0, 10) + '...' + token.substring(token.length - 10);
    }

    /**
     * Get response summary for notification
     */
    getResponseSummary(notificationId) {
        try {
            const stats = this.getNotificationStats(notificationId);
            const timeline = this.getDeliveryTimeline(notificationId);
            
            return {
                statistics: stats,
                timeline: timeline,
                summary: {
                    totalDeliveryAttempts: stats.total,
                    successfulDeliveries: stats.successful,
                    failedDeliveries: stats.failed,
                    deliverySuccessRate: stats.successRate,
                    hasErrors: stats.failed > 0,
                    mostCommonError: stats.errorBreakdown.length > 0 
                        ? stats.errorBreakdown[0].error_code 
                        : null
                }
            };

        } catch (error) {
            this.logger.error(`❌ Failed to get response summary for notification ${notificationId}:`, error);
            throw new Error(`Failed to get response summary: ${error.message}`);
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Test basic operations
            const recentCount = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM firebase_responses 
                WHERE created_at >= datetime('now', '-1 hour')
            `).get();

            const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM firebase_responses').get();

            const successRate = this.db.prepare(`
                SELECT AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100 as rate
                FROM firebase_responses 
                WHERE created_at >= datetime('now', '-24 hours')
            `).get();

            return {
                healthy: true,
                totalResponses: totalCount.count,
                recentResponses: recentCount.count,
                recent24hSuccessRate: successRate.rate || 0,
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

module.exports = ResponseModel;