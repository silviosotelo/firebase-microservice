// ==========================================
// FIREBASE MICROSERVICE - ENTRY POINT CORREGIDO
// Arquitectura simplificada y robusta
// ==========================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Import configurations
const database = require('./src/config/database');

// Import middleware  
const errorHandler = require('./src/middleware/errorHandler');
const logger = require('./src/middleware/logger');

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
        
        this.logger = new AppLogger('FirebaseMicroservice');
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            this.logger.info('🚀 Firebase Microservice already initialized');
            return;
        }

        try {
            this.logger.info('🚀 Initializing Firebase Microservice...');
            
            // 1. Setup error handling FIRST
            this.setupGlobalErrorHandling();
            
            // 2. Setup middleware
            this.setupMiddleware();
            
            // 3. Initialize database 
            await this.initializeDatabase();
            
            // 4. Initialize HTTP server
            this.initializeServer();
            
            // 5. Initialize WebSockets
            this.initializeWebSockets();
            
            // 6. Initialize services
            await this.initializeServices();
            
            // 7. Setup routes LAST
            this.setupRoutes();
            
            this.initialized = true;
            this.logger.info('✅ Firebase Microservice initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize Firebase Microservice:', error);
            // Don't exit process, just log and continue with limited functionality
            this.initialized = false;
        }
    }

    async initializeDatabase() {
        try {
            this.logger.info('📊 Initializing database...');
            this.models = await database.initialize();
            this.logger.info('✅ Database initialized successfully');
        } catch (error) {
            this.logger.error('❌ Database initialization failed:', error.message);
            // Create minimal fallback
            this.models = null;
        }
    }

    setupMiddleware() {
        this.logger.info('🔧 Setting up middleware...');
        
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: false, // Simplify for development
            crossOriginEmbedderPolicy: false
        }));
        
        // CORS configuration - More permissive
        this.app.use(cors({
            origin: true, // Allow all origins for development
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Accept']
        }));
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Compression
        this.app.use(compression());
        
        // Request logging
        this.app.use(logger.requestLogger);
        
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
                origin: true, // Allow all origins
                methods: ['GET', 'POST'],
                credentials: true
            },
            transports: ['websocket', 'polling']
        });
        
        // Simple WebSocket handling without authentication for now
        this.io.on('connection', (socket) => {
            this.logger.info(`🔗 WebSocket connected: ${socket.id}`);
            
            socket.on('disconnect', () => {
                this.logger.info(`🔗 WebSocket disconnected: ${socket.id}`);
            });
        });
        
        this.logger.info('✅ WebSockets initialized');
    }

    async initializeServices() {
        this.logger.info('⚙️ Initializing services...');
        
        try {
            // Initialize WebSocket service
            try {
                const WebSocketService = require('./src/services/websocketService');
                this.websocketService = new WebSocketService(this.io);
                await this.websocketService.initialize();
                this.logger.info('✅ WebSocket service initialized');
            } catch (error) {
                this.logger.warn('⚠️ WebSocket service failed:', error.message);
                this.websocketService = null;
            }
            
            // Initialize Queue service (SQLite-based)
            try {
                const SQLiteQueueService = require('./src/services/sqliteQueueService');
                this.queueService = new SQLiteQueueService(this.websocketService, this.models);
                await this.queueService.initialize();
                this.queueService.startWorkers();
                this.logger.info('✅ SQLite Queue service initialized');
            } catch (error) {
                this.logger.warn('⚠️ Queue service failed:', error.message);
                this.queueService = null;
            }
            
            // Initialize Stats service
            try {
                const StatsService = require('./src/services/statsService');
                this.statsService = new StatsService(this.websocketService);
                await this.statsService.initialize();
                this.statsService.startPeriodicUpdates();
                this.logger.info('✅ Stats service initialized');
            } catch (error) {
                this.logger.warn('⚠️ Stats service failed:', error.message);
                this.statsService = null;
            }
            
            // Initialize Notification Controller
            try {
                const { NotificationController } = require('./src/controllers/notificationController');
                this.notificationController = new NotificationController(
                    this.models,
                    this.queueService,
                    this.websocketService
                );
                this.logger.info('✅ Notification controller initialized');
            } catch (error) {
                this.logger.error('❌ Notification controller failed:', error.message);
                this.notificationController = null;
            }
            
            this.logger.info('✅ Services initialization completed');
            
        } catch (error) {
            this.logger.error('❌ Services initialization failed:', error);
            // Continue with limited functionality
        }
    }

    setupRoutes() {
        this.logger.info('🛣️ Setting up routes...');
        
        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: process.env.npm_package_version || '1.0.0',
                environment: this.env,
                uptime: process.uptime(),
                database: !!this.models,
                services: {
                    websocket: !!this.websocketService,
                    queue: !!this.queueService,
                    stats: !!this.statsService,
                    notificationController: !!this.notificationController
                }
            });
        });

        // Load API routes with simplified auth
        try {
            const apiRoutes = require('./src/routes/api-simple');
            
            // Inject controller if available
            if (this.notificationController) {
                apiRoutes.setController(this.notificationController);
            }
            
            this.app.use('/api', apiRoutes);
            this.logger.info('✅ API routes mounted');
        } catch (error) {
            this.logger.error('❌ Failed to mount API routes:', error.message);
        }

        // Load other routes with error handling
        try {
            const webhookRoutes = require('./src/routes/webhooks');
            this.app.use('/webhooks', webhookRoutes);
            this.logger.info('✅ Webhook routes mounted');
        } catch (error) {
            this.logger.warn('⚠️ Webhook routes not available:', error.message);
        }

        // Default route
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Firebase Microservice',
                status: 'running',
                timestamp: new Date().toISOString(),
                endpoints: {
                    health: '/health',
                    api: '/api',
                    webhooks: '/webhooks'
                },
                services: {
                    websocket: !!this.websocketService,
                    queue: !!this.queueService,
                    stats: !!this.statsService,
                    notificationController: !!this.notificationController
                }
            });
        });
        
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.originalUrl,
                method: req.method,
                availableEndpoints: ['/health', '/api', '/webhooks']
            });
        });
        
        // Global error handler (MUST be last)
        this.app.use(errorHandler.globalErrorHandler);
        
        this.logger.info('✅ Routes configured');
    }

    setupGlobalErrorHandling() {
        this.logger.info('🛡️ Setting up global error handling...');
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.logger.error('💥 Uncaught Exception:', error);
            // Don't exit, just log
        });

        // Handle unhandled rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't exit, just log
        });

        // Handle SIGTERM
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        
        // Handle SIGINT (Ctrl+C)
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
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
            
            // Stop services
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
            this.server.listen(this.port, '0.0.0.0', () => {
                this.logger.info(`🚀 Firebase Microservice running on port ${this.port}`);
                this.logger.info(`📊 Dashboard: http://localhost:${this.port}`);
                this.logger.info(`🔗 API: http://localhost:${this.port}/api`);
                this.logger.info(`🔧 Environment: ${this.env}`);
                
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

    // Getter methods
    getApp() { return this.app; }
    getServer() { return this.server; }
    getIO() { return this.io; }
    getWebSocketService() { return this.websocketService; }
    getQueueService() { return this.queueService; }
    getStatsService() { return this.statsService; }
    getModels() { return this.models; }
    getNotificationController() { return this.notificationController; }
}

// Start the microservice
if (require.main === module) {
    const microservice = new FirebaseMicroservice();
    microservice.start().catch((error) => {
        console.error('❌ Failed to start microservice:', error);
        // Don't exit, keep trying
    });
}

module.exports = FirebaseMicroservice;