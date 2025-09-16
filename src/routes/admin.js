// ==========================================
// ADMIN ROUTES
// Administrative endpoints for system management
// ==========================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const database = require('../config/database');
const { requireRole } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');
const AppLogger = require('../utils/logger');

const router = express.Router();
const logger = new AppLogger();

// Admin rate limiting
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: {
        success: false,
        error: 'Too many admin requests',
        retryAfter: 900
    }
});

router.use(adminLimiter);

// ==========================================
// DASHBOARD ROUTES
// ==========================================

/**
 * Get admin dashboard data
 * GET /admin/dashboard
 */
router.get('/dashboard', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const db = database.getDatabase();
        
        // Get overall statistics
        const overallStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                AVG(success_rate) as avg_success_rate,
                SUM(total_sent) as total_sent,
                SUM(successful) as total_successful,
                SUM(failed) as total_failed
            FROM notifications
        `).get();

        // Get today's statistics
        const todayStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(total_sent) as sent,
                SUM(successful) as successful,
                SUM(failed) as failed,
                AVG(success_rate) as avg_success_rate
            FROM notifications 
            WHERE date(created_at) = date('now')
        `).get();

        // Get recent activity
        const recentActivity = db.prepare(`
            SELECT 
                id, request_id, title, type, status, 
                total_sent, successful, failed, success_rate,
                created_at, updated_at
            FROM notifications 
            ORDER BY created_at DESC 
            LIMIT 10
        `).all();

        // Get system health
        const systemHealth = await database.healthCheck();

        res.json({
            success: true,
            data: {
                statistics: {
                    overall: overallStats,
                    today: todayStats
                },
                recentActivity,
                systemHealth,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('❌ Admin dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load dashboard data'
        });
    }
});

// ==========================================
// NOTIFICATION MANAGEMENT
// ==========================================

/**
 * Get all notifications with advanced filtering
 * GET /admin/notifications
 */
router.get('/notifications', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            status,
            type,
            priority,
            date_from,
            date_to,
            search
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const maxLimit = Math.min(parseInt(limit), 1000);

        // Build WHERE clause
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }

        if (type) {
            conditions.push('type = ?');
            params.push(type);
        }

        if (priority) {
            conditions.push('priority = ?');
            params.push(priority);
        }

        if (date_from) {
            conditions.push('created_at >= ?');
            params.push(date_from);
        }

        if (date_to) {
            conditions.push('created_at <= ?');
            params.push(date_to);
        }

        if (search) {
            conditions.push('(title LIKE ? OR message LIKE ? OR request_id LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const db = database.getDatabase();

        // Get total count
        const { total } = db.prepare(`SELECT COUNT(*) as total FROM notifications ${whereClause}`).get(...params);

        // Get notifications
        const notifications = db.prepare(`
            SELECT * FROM notifications 
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, maxLimit, offset);

        res.json({
            success: true,
            data: {
                notifications,
                pagination: {
                    page: parseInt(page),
                    limit: maxLimit,
                    total,
                    totalPages: Math.ceil(total / maxLimit)
                }
            }
        });

    } catch (error) {
        logger.error('❌ Admin notifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load notifications'
        });
    }
});

/**
 * Delete notification
 * DELETE /admin/notifications/:id
 */
router.delete('/notifications/:id', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const notificationId = req.params.id;
        const db = database.getDatabase();

        // Check if notification exists
        const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId);
        
        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Notification not found'
            });
        }

        // Delete notification and responses (CASCADE should handle responses)
        const result = db.prepare('DELETE FROM notifications WHERE id = ?').run(notificationId);

        logger.info(`🗑️ Admin deleted notification: ${notificationId}`);

        res.json({
            success: true,
            message: 'Notification deleted successfully',
            data: {
                deletedId: notificationId,
                changes: result.changes
            }
        });

    } catch (error) {
        logger.error('❌ Admin delete notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete notification'
        });
    }
});

// ==========================================
// SYSTEM MANAGEMENT
// ==========================================

/**
 * Get system configuration
 * GET /admin/config
 */
router.get('/config', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const db = database.getDatabase();
        
        const configs = db.prepare('SELECT * FROM system_config ORDER BY key').all();
        
        const configData = {};
        configs.forEach(config => {
            configData[config.key] = {
                value: config.value,
                description: config.description,
                updatedAt: config.updated_at
            };
        });

        res.json({
            success: true,
            data: configData
        });

    } catch (error) {
        logger.error('❌ Admin get config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load configuration'
        });
    }
});

/**
 * Update system configuration
 * PUT /admin/config
 */
router.put('/config', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const updates = req.body;
        const db = database.getDatabase();

        const transaction = db.transaction(() => {
            for (const [key, data] of Object.entries(updates)) {
                db.prepare(`
                    INSERT OR REPLACE INTO system_config (key, value, description)
                    VALUES (?, ?, ?)
                `).run(key, data.value, data.description || null);
            }
        });

        transaction();

        logger.info(`⚙️ Admin updated system configuration: ${Object.keys(updates).join(', ')}`);

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            data: {
                updatedKeys: Object.keys(updates)
            }
        });

    } catch (error) {
        logger.error('❌ Admin update config error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update configuration'
        });
    }
});

/**
 * System maintenance operations
 * POST /admin/maintenance/:operation
 */
router.post('/maintenance/:operation', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const operation = req.params.operation;
        const db = database.getDatabase();

        let result = {};

        switch (operation) {
            case 'cleanup':
                // Clean up old notifications
                const retentionDays = parseInt(req.body.retentionDays || 30);
                const cleanupResult = db.prepare(`
                    DELETE FROM notifications 
                    WHERE created_at < datetime('now', '-${retentionDays} days')
                    AND status IN ('completed', 'failed', 'cancelled')
                `).run();

                result = {
                    operation: 'cleanup',
                    deletedNotifications: cleanupResult.changes,
                    retentionDays
                };
                break;

            case 'vacuum':
                // Vacuum database
                database.vacuum();
                result = {
                    operation: 'vacuum',
                    message: 'Database vacuum completed'
                };
                break;

            case 'backup':
                // Create database backup
                const backupPath = req.body.backupPath || `./backups/backup-${Date.now()}.db`;
                database.backup(backupPath);
                result = {
                    operation: 'backup',
                    backupPath,
                    message: 'Database backup created'
                };
                break;

            case 'clear-cache':
                // Clear stats cache
                db.prepare('DELETE FROM stats_cache WHERE expires_at < datetime("now")').run();
                result = {
                    operation: 'clear-cache',
                    message: 'Cache cleared successfully'
                };
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid maintenance operation'
                });
        }

        logger.info(`🔧 Admin maintenance operation: ${operation}`);

        res.json({
            success: true,
            message: 'Maintenance operation completed',
            data: result
        });

    } catch (error) {
        logger.error('❌ Admin maintenance error:', error);
        res.status(500).json({
            success: false,
            error: 'Maintenance operation failed'
        });
    }
});

// ==========================================
// LOGS & MONITORING
// ==========================================

/**
 * Get system logs
 * GET /admin/logs
 */
router.get('/logs', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const { level = 'info', limit = 100, date } = req.query;
        
        // This is a placeholder - in a real implementation, you'd read from log files
        // For now, return some mock log data
        const logs = [
            {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'System running normally',
                module: 'system'
            }
        ];

        res.json({
            success: true,
            data: {
                logs,
                filters: { level, limit, date }
            }
        });

    } catch (error) {
        logger.error('❌ Admin logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load logs'
        });
    }
});

/**
 * Export data
 * GET /admin/export/:type
 */
router.get('/export/:type', requireRole(USER_ROLES.ADMIN), async (req, res) => {
    try {
        const exportType = req.params.type;
        const { format = 'json', date_from, date_to } = req.query;
        
        const db = database.getDatabase();
        
        let data = [];
        let filename = '';

        switch (exportType) {
            case 'notifications':
                let query = 'SELECT * FROM notifications';
                const params = [];

                if (date_from || date_to) {
                    const conditions = [];
                    if (date_from) {
                        conditions.push('created_at >= ?');
                        params.push(date_from);
                    }
                    if (date_to) {
                        conditions.push('created_at <= ?');
                        params.push(date_to);
                    }
                    query += ` WHERE ${conditions.join(' AND ')}`;
                }

                query += ' ORDER BY created_at DESC';
                data = db.prepare(query).all(...params);
                filename = `notifications-export-${Date.now()}`;
                break;

            case 'responses':
                data = db.prepare(`
                    SELECT nr.*, n.title, n.type 
                    FROM notification_responses nr
                    JOIN notifications n ON nr.notification_id = n.id
                    ORDER BY nr.created_at DESC
                    LIMIT 10000
                `).all();
                filename = `responses-export-${Date.now()}`;
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid export type'
                });
        }

        if (format === 'csv') {
            // Convert to CSV
            if (data.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No data to export'
                });
            }

            const headers = Object.keys(data[0]);
            const csvRows = [headers.join(',')];
            
            data.forEach(row => {
                const values = headers.map(header => {
                    const value = row[header];
                    return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
                });
                csvRows.push(values.join(','));
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            res.send(csvRows.join('\n'));

        } else {
            // Return JSON
            res.json({
                success: true,
                data: {
                    exportType,
                    count: data.length,
                    data
                }
            });
        }

    } catch (error) {
        logger.error('❌ Admin export error:', error);
        res.status(500).json({
            success: false,
            error: 'Export failed'
        });
    }
});

// ==========================================
// USER MANAGEMENT (Super Admin only)
// ==========================================

/**
 * Manage API keys
 * GET /admin/api-keys
 */
router.get('/api-keys', requireRole(USER_ROLES.SUPER_ADMIN), async (req, res) => {
    try {
        // This would typically come from a more secure storage
        // For now, return masked information
        const apiKeys = {
            user: process.env.API_KEY_USER ? ['***masked***'] : [],
            admin: process.env.API_KEY_ADMIN ? ['***masked***'] : [],
            superAdmin: process.env.API_KEY_SUPER_ADMIN ? ['***masked***'] : []
        };

        res.json({
            success: true,
            data: {
                apiKeys,
                message: 'API keys are masked for security'
            }
        });

    } catch (error) {
        logger.error('❌ Admin API keys error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load API keys'
        });
    }
});

module.exports = router;