// ==========================================
// FIREBASE MICROSERVICE - ENTRY POINT
// Modular, Scalable & Robust Architecture
// ==========================================

require('dotenv').config();

// Set max listeners FIRST before any other imports
process.setMaxListeners(30);

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Import configurations
const config = require('./src/config');
const database = require('./src/config/database');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');
const logger = require('./src/middleware/logger');
const rateLimit = require('./src/middleware/rateLimit');

// Try advanced auth first, fallback to basic auth
let auth;
try {
    auth = require('./src/middleware/auth');
    console.log('✅ Using advanced auth with database');
} catch (authError) {
    console.log('⚠️ Advanced auth not available, using basic auth');
    auth = require('./src/middleware/auth-basic');
}

// Import services
const WebSocketService = require('./src/services/websocketService');
const SQLiteQueueService = require('./src/services/sqliteQueueService');
const StatsService = require('./src/services/statsService');

// Import utils
const AppLogger = require('./src/utils/logger');

class FirebaseMicroservice {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.port = process.env.PORT || 3000;
        this.env = process.env.NODE_ENV || 'development';
        
        // Services
        this.websocketService = null;
        this.queueService = null;
        this.statsService = null;
        this.notificationController = null;
        this.models = null;
        
        this.logger = new AppLogger();
        
        // Flags to prevent multiple initializations
        this.initialized = false;
        this.errorHandlersRegistered = false;
    }

    async initialize() {
        if (this.initialized) {
            this.logger.info('🚀 Firebase Microservice already initialized');
            return;
        }

        try {
            this.logger.info('🚀 Initializing Firebase Microservice...');
            
            // Setup error handling FIRST to catch any initialization errors
            this.setupErrorHandling();
            
            // Initialize database
            await this.initializeDatabase();
            
            // Initialize authentication AFTER database is ready
            await this.initializeAuthentication();
            
            // Setup middleware
            this.setupMiddleware();
            
            // Initialize HTTP server
            this.initializeServer();
            
            // Initialize WebSockets
            this.initializeWebSockets();
            
            // Initialize services (including controllers)
            await this.initializeServices();
            
            // Setup routes AFTER services are initialized
            this.setupRoutes();
            
            this.initialized = true;
            this.logger.info('✅ Firebase Microservice initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize Firebase Microservice:', error);
            process.exit(1);
        }
    }

    async initializeDatabase() {
        try {
            this.logger.info('📊 Initializing database...');
            this.models = await database.initialize();
            this.logger.info('✅ Database initialized');
        } catch (error) {
            this.logger.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    async initializeAuthentication() {
        try {
            this.logger.info('🔐 Initializing authentication...');
            
            // Basic auth doesn't need models - just initialize
            if (auth && auth.authMiddleware) {
                // Set models if needed, but don't require it
                if (this.models) {
                    auth.authMiddleware.models = this.models;
                }
                
                // Only call initializeDefaults if it exists
                if (typeof auth.authMiddleware.initializeDefaults === 'function') {
                    await auth.authMiddleware.initializeDefaults();
                }
                
                this.logger.info('✅ Authentication initialized');
            } else {
                this.logger.warn('⚠️ No auth middleware available');
            }
        } catch (error) {
            this.logger.error('❌ Authentication initialization failed:', error.message);
            this.logger.info('⚠️ Continuing without authentication features');
        }
    }

    setupMiddleware() {
        this.logger.info('🔧 Setting up middleware...');
        
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
                    styleSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
                    imgSrc: ["'self'", 'data:', 'https:'],
                },
            },
        }));
        
        // CORS configuration
        this.app.use(cors({
            origin: this.getAllowedOrigins(),
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
        }));
        
        // Compression
        this.app.use(compression());
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Request logging
        this.app.use(logger.requestLogger);
        
        // Rate limiting
        this.app.use('/api/', rateLimit.apiLimiter);
        this.app.use('/admin/', rateLimit.adminLimiter);
        
        // Static files
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        this.logger.info('✅ Middleware configured');
    }

    initializeServer() {
        this.server = http.createServer(this.app);
        this.logger.info('🌐 HTTP server created');
    }

    initializeWebSockets() {
        this.logger.info('🔌 Initializing WebSockets...');
        
        this.io = socketIo(this.server, {
            cors: {
                origin: this.getAllowedOrigins(),
                methods: ['GET', 'POST'],
                credentials: true
            },
            transports: ['websocket', 'polling']
        });
        
        // WebSocket authentication
        this.io.use(auth.socketAuth);
        
        this.logger.info('✅ WebSockets initialized');
    }

    async initializeServices() {
        this.logger.info('⚙️ Initializing services...');
        
        try {
            // WebSocket service (essential)
            this.websocketService = new WebSocketService(this.io);
            await this.websocketService.initialize();
            this.logger.info('✅ WebSocket service initialized');
            
            // Queue service (SQLite-based - no external dependencies)
            try {
                this.logger.info('🔧 Initializing SQLite Queue service with models...');
                this.queueService = new SQLiteQueueService(this.websocketService, this.models);
                await this.queueService.initialize();
                this.queueService.startWorkers();
                this.logger.info('✅ SQLite Queue service initialized');
            } catch (queueError) {
                this.logger.warn('⚠️ SQLite Queue service failed to initialize:', queueError.message);
                this.queueService = null;
            }
            
            // Stats service (optional - depends on websocket)
            try {
                this.statsService = new StatsService(this.websocketService);
                await this.statsService.initialize();
                this.statsService.startPeriodicUpdates();
                this.logger.info('✅ Stats service initialized');
            } catch (statsError) {
                this.logger.warn('⚠️ Stats service failed to initialize:', statsError.message);
                this.statsService = null;
            }
            
            // ==========================================
            // INITIALIZE NOTIFICATION CONTROLLER WITH DEPENDENCIES
            // ==========================================
            
            try {
                this.logger.info('🎮 Initializing notification controller with dependencies...');
                
                const { reinitializeNotificationController } = require('./src/controllers/notificationController');
                
                // Pass all dependencies to the controller
                this.notificationController = reinitializeNotificationController(
                    this.models,           // Database models
                    this.queueService,     // Queue service (can be null)
                    this.websocketService  // WebSocket service
                );
                
                this.logger.info('✅ Notification controller initialized successfully');
                
            } catch (controllerError) {
                this.logger.error('❌ Failed to initialize notification controller:', controllerError);
                this.notificationController = null;
            }
            
            this.logger.info('✅ Core services initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Critical service initialization failed:', error);
            throw error;
        }
    }

    setupRoutes() {
        this.logger.info('🛣️ Setting up routes...');
        
        // Health check (no auth required)
        this.app.get('/health', async (req, res) => {
            try {
                const dbHealth = await database.healthCheck();
                res.json({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    version: process.env.npm_package_version || '1.0.0',
                    environment: this.env,
                    uptime: process.uptime(),
                    database: dbHealth,
                    services: {
                        websocket: !!this.websocketService,
                        queue: !!this.queueService,
                        stats: !!this.statsService,
                        notificationController: !!this.notificationController
                    }
                });
            } catch (error) {
                res.status(503).json({
                    status: 'unhealthy',
                    timestamp: new Date().toISOString(),
                    error: error.message
                });
            }
        });
        
        // ==========================================
        // DYNAMIC ROUTE LOADING WITH DEPENDENCY INJECTION
        // ==========================================
        
        // Create a factory function to inject dependencies into API routes
        const createApiRoutes = () => {
            try {
                // Clear require cache to ensure fresh import
                delete require.cache[require.resolve('./src/routes/api')];
                
                // Import API routes module
                const apiRoutesModule = require('./src/routes/api');
                
                // If the module exports a setController function, use it
                if (typeof apiRoutesModule.setController === 'function' && this.notificationController) {
                    apiRoutesModule.setController(this.notificationController);
                    this.logger.info('✅ Notification controller injected into API routes');
                }
                
                // Return the router (which could be the module itself or a router property)
                return apiRoutesModule.default || apiRoutesModule;
                
            } catch (routeError) {
                this.logger.error('❌ Failed to create API routes with dependencies:', routeError);
                
                // Return a fallback router
                const express = require('express');
                const fallbackRouter = express.Router();
                
                fallbackRouter.use('*', (req, res) => {
                    res.status(503).json({
                        success: false,
                        error: 'API temporarily unavailable',
                        code: 'SERVICE_UNAVAILABLE',
                        timestamp: new Date().toISOString()
                    });
                });
                
                return fallbackRouter;
            }
        };
        
        // Load and mount API routes
        const apiRoutes = createApiRoutes();
        this.app.use('/api', auth.apiKeyAuth, apiRoutes);
        this.logger.info('✅ API routes mounted with authentication');
        
        // Load other routes with error handling
        try {
            const adminRoutes = require('./src/routes/admin');
            this.app.use('/admin', auth.adminAuth, adminRoutes);
            this.logger.info('✅ Admin routes mounted');
        } catch (adminError) {
            this.logger.warn('⚠️ Admin routes not available:', adminError.message);
        }
        
        try {
            const webhookRoutes = require('./src/routes/webhooks');
            this.app.use('/webhooks', auth.webhookAuth, webhookRoutes);
            this.logger.info('✅ Webhook routes mounted');
        } catch (webhookError) {
            this.logger.warn('⚠️ Webhook routes not available:', webhookError.message);
        }
        
        // Documentation routes
        this.app.get('/docs', (req, res) => {
            const docsPath = path.join(__dirname, 'public', 'docs', 'api-docs.html');
            if (require('fs').existsSync(docsPath)) {
                res.sendFile(docsPath);
            } else {
                res.status(404).json({ error: 'Documentation not found' });
            }
        });
        
        this.app.get('/integration', (req, res) => {
            const integrationPath = path.join(__dirname, 'public', 'docs', 'integration.html');
            if (require('fs').existsSync(integrationPath)) {
                res.sendFile(integrationPath);
            } else {
                res.status(404).json({ error: 'Integration guide not found' });
            }
        });
        
        // Default route - Dashboard
        this.app.get('/', (req, res) => {
            const indexPath = path.join(__dirname, 'public', 'index.html');
            if (require('fs').existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                res.json({
                    service: 'Firebase Microservice',
                    status: 'running',
                    timestamp: new Date().toISOString(),
                    endpoints: {
                        health: '/health',
                        api: '/api',
                        admin: '/admin',
                        docs: '/docs'
                    },
                    services: {
                        websocket: !!this.websocketService,
                        queue: !!this.queueService,
                        stats: !!this.statsService,
                        notificationController: !!this.notificationController
                    }
                });
            }
        });
        
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.originalUrl,
                method: req.method
            });
        });
        
        this.logger.info('✅ Routes configured');
    }

    setupErrorHandling() {
        // Prevent multiple registrations
        if (this.errorHandlersRegistered) {
            this.logger.debug('🛡️ Error handlers already registered, skipping...');
            return;
        }

        this.logger.info('🛡️ Setting up error handling...');
        
        // Global error handler for Express
        this.app.use(errorHandler.globalErrorHandler);
        
        // Named handlers to avoid duplicates
        const unhandledRejectionHandler = (reason, promise) => {
            this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            if (this.env === 'production') {
                this.logger.error('Unhandled rejection detected, but continuing...');
            } else {
                this.gracefulShutdown('UNHANDLED_REJECTION');
            }
        };
        unhandledRejectionHandler.handlerName = 'microserviceUnhandledRejection';

        const uncaughtExceptionHandler = (error) => {
            this.logger.error('Uncaught Exception:', error);
            this.gracefulShutdown('UNCAUGHT_EXCEPTION');
        };
        uncaughtExceptionHandler.handlerName = 'microserviceUncaughtException';

        const sigtermHandler = () => this.gracefulShutdown('SIGTERM');
        sigtermHandler.handlerName = 'microserviceSigterm';

        const sigintHandler = () => this.gracefulShutdown('SIGINT');
        sigintHandler.handlerName = 'microserviceSigint';

        // Remove existing listeners to prevent duplicates
        process.removeAllListeners('unhandledRejection');
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');

        // Add new listeners
        process.on('unhandledRejection', unhandledRejectionHandler);
        process.on('uncaughtException', uncaughtExceptionHandler);
        process.on('SIGTERM', sigtermHandler);
        process.on('SIGINT', sigintHandler);

        this.errorHandlersRegistered = true;
        this.logger.info('✅ Error handling configured');
    }

    getAllowedOrigins() {
        const origins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080';
        return origins.split(',').map(origin => origin.trim());
    }

    async gracefulShutdown(signal) {
        this.logger.info(`🛑 Graceful shutdown initiated by ${signal}`);
        
        try {
            // Stop accepting new connections
            if (this.server) {
                this.server.close(() => {
                    this.logger.info('📡 HTTP server closed');
                });
            }
            
            // Close WebSocket connections
            if (this.io) {
                this.io.close();
                this.logger.info('🔌 WebSocket server closed');
            }
            
            // Stop services (only if they exist)
            if (this.queueService) {
                await this.queueService.stop();
                this.logger.info('⏹️ Queue service stopped');
            }
            
            if (this.statsService) {
                await this.statsService.stop();
                this.logger.info('📊 Stats service stopped');
            }
            
            // Close database connections
            if (database) {
                await database.close();
                this.logger.info('🗄️ Database connections closed');
            }
            
            this.logger.info('✅ Graceful shutdown completed');
            process.exit(0);
            
        } catch (error) {
            this.logger.error('❌ Error during graceful shutdown:', error);
            process.exit(1);
        }
    }

    async start() {
        await this.initialize();
        
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                this.logger.info(`🚀 Firebase Microservice running on port ${this.port}`);
                this.logger.info(`📊 Dashboard: http://localhost:${this.port}`);
                this.logger.info(`🔗 API: http://localhost:${this.port}/api`);
                this.logger.info(`👨‍💼 Admin: http://localhost:${this.port}/admin`);
                this.logger.info(`📚 Docs: http://localhost:${this.port}/docs`);
                this.logger.info(`🔧 Environment: ${this.env}`);
                
                // Log service status
                this.logger.info('📋 Service Status:');
                this.logger.info(`   🗄️ Database: ${this.models ? 'Available' : 'Unavailable'}`);
                this.logger.info(`   🔌 WebSocket: ${this.websocketService ? 'Running' : 'Unavailable'}`);
                this.logger.info(`   📦 Queue: ${this.queueService ? 'Running' : 'Unavailable'}`);
                this.logger.info(`   📊 Stats: ${this.statsService ? 'Running' : 'Unavailable'}`);
                this.logger.info(`   🎮 Controller: ${this.notificationController ? 'Available' : 'Unavailable'}`);
                
                resolve();
            });
        });
    }

    // ==========================================
    // GETTER METHODS FOR SERVICES
    // ==========================================
    
    getApp() { return this.app; }
    getServer() { return this.server; }
    getIO() { return this.io; }
    getWebSocketService() { return this.websocketService; }
    getQueueService() { return this.queueService; }
    getStatsService() { return this.statsService; }
    getModels() { return this.models; }
    getNotificationController() { return this.notificationController; }
}

// Start the microservice if this file is run directly
if (require.main === module) {
    const microservice = new FirebaseMicroservice();
    microservice.start().catch((error) => {
        console.error('Failed to start microservice:', error);
        process.exit(1);
    });
}

module.exports = FirebaseMicroservice;