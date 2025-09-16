// ==========================================
// SIMPLE AUTH MIDDLEWARE - Para desarrollo/testing
// Autenticación simplificada que no bloquea el funcionamiento
// ==========================================

const AppLogger = require('../utils/logger');

const logger = new AppLogger('SimpleAuth');

/**
 * Middleware de autenticación simplificado para desarrollo
 */
const simpleAuth = (req, res, next) => {
    try {
        // En modo desarrollo, permitir todas las requests
        if (process.env.NODE_ENV === 'development') {
            req.user = {
                id: 'dev-user',
                role: 'admin',
                authenticated: true
            };
            return next();
        }

        // Verificar API key si está presente
        const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
        
        if (apiKey) {
            // Validación básica de API key
            if (apiKey === process.env.API_KEY || apiKey === 'test-key-123') {
                req.user = {
                    id: 'api-user',
                    role: 'user',
                    authenticated: true,
                    apiKey: true
                };
                return next();
            }
        }

        // Si no hay API key, permitir acceso limitado
        req.user = {
            id: 'anonymous',
            role: 'viewer',
            authenticated: false
        };
        
        next();
        
    } catch (error) {
        logger.error('❌ Simple auth error:', error);
        // En caso de error, permitir acceso limitado
        req.user = {
            id: 'anonymous',
            role: 'viewer',
            authenticated: false
        };
        next();
    }
};

/**
 * Middleware para verificar roles (opcional)
 */
const requireRole = (requiredRole) => {
    return (req, res, next) => {
        // En modo desarrollo, siempre permitir
        if (process.env.NODE_ENV === 'development') {
            return next();
        }

        const userRole = req.user?.role || 'viewer';
        
        // Jerarquía de roles simple
        const roleHierarchy = {
            'viewer': 0,
            'user': 1,
            'admin': 2,
            'super_admin': 3
        };

        const userLevel = roleHierarchy[userRole] || 0;
        const requiredLevel = roleHierarchy[requiredRole] || 0;

        if (userLevel >= requiredLevel) {
            return next();
        }

        // Si no tiene permisos, devolver 403 pero no bloquear completamente
        logger.warn(`⚠️ Insufficient permissions: ${userRole} < ${requiredRole}`);
        
        res.status(403).json({
            success: false,
            error: 'Insufficient permissions',
            required: requiredRole,
            current: userRole,
            message: 'This endpoint requires higher privileges'
        });
    };
};

/**
 * Middleware para WebSocket authentication (simplificado)
 */
const socketAuth = (socket, next) => {
    try {
        // En desarrollo, permitir todas las conexiones
        if (process.env.NODE_ENV === 'development') {
            socket.user = {
                id: 'ws-dev-user',
                role: 'admin',
                authenticated: true
            };
            return next();
        }

        // Verificar token de WebSocket si está presente
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        
        if (token && token === 'ws-test-token') {
            socket.user = {
                id: 'ws-user',
                role: 'user',
                authenticated: true
            };
            return next();
        }

        // Permitir conexiones anónimas con permisos limitados
        socket.user = {
            id: `anonymous-${socket.id}`,
            role: 'viewer',
            authenticated: false
        };
        
        next();
        
    } catch (error) {
        logger.error('❌ Socket auth error:', error);
        // En caso de error, permitir conexión limitada
        socket.user = {
            id: `anonymous-${socket.id}`,
            role: 'viewer',
            authenticated: false
        };
        next();
    }
};

/**
 * Middleware de API key (muy permisivo)
 */
const apiKeyAuth = (req, res, next) => {
    try {
        // Siempre permitir en desarrollo
        if (process.env.NODE_ENV === 'development') {
            return next();
        }

        const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
        
        // Lista de API keys válidas (en producción esto vendría de la base de datos)
        const validKeys = [
            process.env.API_KEY,
            process.env.API_KEY_USER,
            process.env.API_KEY_ADMIN,
            'test-key-123',
            'dev-key-456'
        ].filter(Boolean);

        if (apiKey && validKeys.includes(apiKey)) {
            req.apiKeyValid = true;
            return next();
        }

        // Permitir acceso sin API key con limitaciones
        req.apiKeyValid = false;
        next();
        
    } catch (error) {
        logger.error('❌ API key auth error:', error);
        req.apiKeyValid = false;
        next();
    }
};

/**
 * Middleware para endpoints de admin (permisivo en desarrollo)
 */
const adminAuth = (req, res, next) => {
    // En desarrollo, permitir todo
    if (process.env.NODE_ENV === 'development') {
        return next();
    }

    // Verificar autenticación
    if (!req.user?.authenticated) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'This endpoint requires authentication'
        });
    }

    // Verificar rol de admin
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            error: 'Admin access required',
            message: 'This endpoint requires admin privileges'
        });
    }

    next();
};

/**
 * Middleware para webhooks (sin autenticación estricta)
 */
const webhookAuth = (req, res, next) => {
    try {
        // Verificar signature si está configurada
        const signature = req.headers['x-webhook-signature'];
        const secret = process.env.WEBHOOK_SECRET;

        if (secret && signature) {
            // Validación básica de signature
            const crypto = require('crypto');
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(JSON.stringify(req.body))
                .digest('hex');

            if (signature !== `sha256=${expectedSignature}`) {
                logger.warn('⚠️ Invalid webhook signature');
                return res.status(401).json({
                    success: false,
                    error: 'Invalid signature'
                });
            }
        }

        // Marcar como webhook request
        req.isWebhook = true;
        next();
        
    } catch (error) {
        logger.error('❌ Webhook auth error:', error);
        // En caso de error, permitir la request
        req.isWebhook = true;
        next();
    }
};

/**
 * Middleware para generar API key de desarrollo
 */
const generateDevApiKey = (req, res, next) => {
    if (process.env.NODE_ENV === 'development' && req.query.generateApiKey === 'true') {
        const crypto = require('crypto');
        const apiKey = `dev-${crypto.randomBytes(16).toString('hex')}`;
        
        res.json({
            success: true,
            message: 'Development API key generated',
            apiKey: apiKey,
            usage: {
                header: 'X-API-Key',
                example: `curl -H "X-API-Key: ${apiKey}" http://localhost:3000/api/health`
            },
            note: 'This key is for development only'
        });
        return;
    }
    next();
};

/**
 * Middleware para logging de autenticación
 */
const logAuth = (req, res, next) => {
    const user = req.user || { id: 'unknown', role: 'unknown' };
    const apiKey = req.headers['x-api-key'] ? 'present' : 'absent';
    
    logger.debug(`🔐 Auth: ${user.id} (${user.role}) | API Key: ${apiKey} | ${req.method} ${req.path}`);
    next();
};

// Exportar todas las funciones de autenticación
module.exports = {
    // Middleware principal
    authMiddleware: simpleAuth,
    
    // Middleware específicos
    requireRole,
    apiKeyAuth,
    adminAuth,
    webhookAuth,
    socketAuth,
    
    // Utilities
    generateDevApiKey,
    logAuth,
    
    // Para compatibilidad con el código existente
    auth: simpleAuth
};