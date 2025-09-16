// ==========================================
// FIREBASE MICROSERVICE - OPTIMIZED ENTRY POINT
// Clean architecture with dependency injection
// ==========================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Import core modules
const DatabaseCore = require('./src/core/database');
const ServiceManager = require('./src/core/serviceManager');

// Import middleware  
const errorHandler = require('./src/middleware/errorHandler');
const logger = require('./src/middleware/logger');

// Import utils
const AppLogger = require('./src/utils/logger');

// Import services
const QueueService = require('./src/services/queueService');
const NotificationService = require('./src/services/notificationService');
const WebSocketService = require('./src/services/websocketService');
const StatsService = require('./src/services/statsService');

// Import controllers
const { NotificationController } = require('./src/controllers/notificationController');
class FirebaseMicroservice {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.port = process.env.PORT || 3000;
        this.env = process.env.NODE_ENV || 'development';
        
        // Core components
        this.database = DatabaseCore;
        this.serviceManager = new ServiceManager();
        
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
            
            // 6. Register and initialize services
            await this.initializeServices();
            
            // 7. Setup routes LAST
            this.setupRoutes();
            
            this.initialized = true;
            this.logger.info('✅ Firebase Microservice initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize Firebase Microservice:', error);
            this.initialized = false;
            throw error;
        }
    }

    async initializeDatabase() {
        try {
            this.logger.info('📊 Initializing database...');
            await this.database.initialize();
            this.logger.info('✅ Database initialized successfully');
        } catch (error) {
            this.logger.error('❌ Database initialization failed:', error.message);
            throw error;
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
        this.logger.info('⚙️ Registering and initializing services...');
        
        try {
            // Add database as a pseudo-service for dependency injection FIRST
            this.serviceManager.services.set('database', {
                name: 'database',
                instance: this.database,
                status: 'running',
                dependencies: []
            });

            // Register services with dependencies
            this.serviceManager.register('websocket', WebSocketService, [], { io: this.io });
            this.serviceManager.register('queue', QueueService, ['database'], { database: this.database });
            this.serviceManager.register('notification', NotificationService, ['database', 'websocket', 'queue']);
            this.serviceManager.register('stats', StatsService, ['database', 'websocket']);
            
            // Initialize all services
            await this.serviceManager.initializeAll();
            
            // Create notification controller
            this.notificationController = new NotificationController(
                this.database.getModels(),
                this.serviceManager.get('queue'),
                this.serviceManager.get('websocket')
            );
            
            this.logger.info('✅ All services initialized successfully');
            
        } catch (error) {
            this.logger.error('❌ Services initialization failed:', error);
            throw error;
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
                database: this.database.initialized,
                services: {
                    websocket: this.serviceManager.isRunning('websocket'),
                    queue: this.serviceManager.isRunning('queue'),
                    notification: this.serviceManager.isRunning('notification'),
                    stats: this.serviceManager.isRunning('stats'),
                    notificationController: !!this.notificationController
                }
            });
        });

        // Load API routes
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


        // Default route
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Firebase Microservice',
                status: 'running',
                timestamp: new Date().toISOString(),
                endpoints: {
                    health: '/health',
                    api: '/api'
                },
                services: this.serviceManager.getAllStatus()
            });
        });
        
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.originalUrl,
                method: req.method,
                availableEndpoints: ['/health', '/api']
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
            
            // Stop all services
            await this.serviceManager.stopAll();
            
            // Close database connections
            if (this.database) {
                await this.database.close();
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
                
                const serviceStatus = this.serviceManager.getAllStatus();
                this.logger.info('📋 Service Status:', serviceStatus);
                
                resolve();
            });
        });
    }

    // Getter methods for backward compatibility
    getApp() { return this.app; }
    getServer() { return this.server; }
    getIO() { return this.io; }
    getDatabase() { return this.database; }
    getServiceManager() { return this.serviceManager; }
    getWebSocketService() { return this.serviceManager.get('websocket'); }
    getQueueService() { return this.serviceManager.get('queue'); }
    getNotificationService() { return this.serviceManager.get('notification'); }
    getStatsService() { return this.serviceManager.get('stats'); }
    getNotificationController() { return this.notificationController; }
}

// Start the microservice
if (require.main === module) {
    const microservice = new FirebaseMicroservice();
    microservice.start().catch((error) => {
        console.error('❌ Failed to start microservice:', error);
        process.exit(1);
    });
}

module.exports = FirebaseMicroservice;