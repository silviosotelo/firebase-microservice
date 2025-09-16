// ==========================================
// SERVICE MANAGER - Centralized Service Management
// Manages service lifecycle and dependencies
// ==========================================

const AppLogger = require('../utils/logger');
const EventEmitter = require('events');

class ServiceManager extends EventEmitter {
    constructor() {
        super();
        this.logger = new AppLogger('ServiceManager');
        this.services = new Map();
        this.dependencies = new Map();
        this.startOrder = [];
        this.initialized = false;
    }

    /**
     * Register a service with its dependencies
     */
    register(name, serviceClass, dependencies = [], options = {}) {
        try {
            this.logger.info(`📦 Registering service: ${name}`);
            
            this.services.set(name, {
                name,
                serviceClass,
                dependencies,
                options,
                instance: null,
                status: 'registered',
                startedAt: null,
                error: null
            });

            this.dependencies.set(name, dependencies);
            this.calculateStartOrder();
            
            this.logger.info(`✅ Service registered: ${name} (deps: ${dependencies.join(', ') || 'none'})`);
            
        } catch (error) {
            this.logger.error(`❌ Failed to register service ${name}:`, error);
            throw error;
        }
    }

    /**
     * Calculate service start order based on dependencies
     */
    calculateStartOrder() {
        const visited = new Set();
        const visiting = new Set();
        const order = [];

        const visit = (serviceName) => {
            if (visiting.has(serviceName)) {
                throw new Error(`Circular dependency detected: ${serviceName}`);
            }
            
            if (visited.has(serviceName)) {
                return;
            }

            visiting.add(serviceName);
            
            const dependencies = this.dependencies.get(serviceName) || [];
            for (const dep of dependencies) {
                if (!this.services.has(dep)) {
                    throw new Error(`Dependency not found: ${dep} for service ${serviceName}`);
                }
                visit(dep);
            }

            visiting.delete(serviceName);
            visited.add(serviceName);
            order.push(serviceName);
        };

        for (const serviceName of this.services.keys()) {
            visit(serviceName);
        }

        this.startOrder = order;
        this.logger.debug(`📋 Service start order: ${order.join(' → ')}`);
    }

    /**
     * Initialize all services in dependency order
     */
    async initializeAll() {
        try {
            this.logger.info('🚀 Initializing all services...');
            
            for (const serviceName of this.startOrder) {
                await this.initializeService(serviceName);
            }

            this.initialized = true;
            this.logger.info('✅ All services initialized successfully');
            
            this.emit('all_services_initialized');
            
        } catch (error) {
            this.logger.error('❌ Service initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize individual service
     */
    async initializeService(serviceName) {
        const serviceInfo = this.services.get(serviceName);
        
        if (!serviceInfo) {
            throw new Error(`Service not found: ${serviceName}`);
        }

        if (serviceInfo.instance) {
            this.logger.warn(`⚠️ Service ${serviceName} already initialized`);
            return serviceInfo.instance;
        }

        try {
            this.logger.info(`🔧 Initializing service: ${serviceName}`);
            serviceInfo.status = 'initializing';

            // Get dependency instances
            const dependencyInstances = {};
            for (const depName of serviceInfo.dependencies) {
                const depService = this.services.get(depName);
                if (!depService || !depService.instance) {
                    throw new Error(`Dependency ${depName} not available for ${serviceName}`);
                }
                dependencyInstances[depName] = depService.instance;
            }

            // Create service instance
            const ServiceClass = serviceInfo.serviceClass;
            const instance = new ServiceClass(dependencyInstances, serviceInfo.options);

            // Initialize if method exists
            if (typeof instance.initialize === 'function') {
                await instance.initialize();
            }

            serviceInfo.instance = instance;
            serviceInfo.status = 'running';
            serviceInfo.startedAt = new Date().toISOString();
            serviceInfo.error = null;

            this.logger.info(`✅ Service initialized: ${serviceName}`);
            this.emit('service_initialized', serviceName, instance);

            return instance;

        } catch (error) {
            serviceInfo.status = 'failed';
            serviceInfo.error = error.message;
            
            this.logger.error(`❌ Failed to initialize service ${serviceName}:`, error);
            this.emit('service_failed', serviceName, error);
            
            throw error;
        }
    }

    /**
     * Get service instance
     */
    get(serviceName) {
        const serviceInfo = this.services.get(serviceName);
        return serviceInfo ? serviceInfo.instance : null;
    }

    /**
     * Check if service is running
     */
    isRunning(serviceName) {
        const serviceInfo = this.services.get(serviceName);
        return serviceInfo && serviceInfo.status === 'running';
    }

    /**
     * Get service status
     */
    getStatus(serviceName) {
        const serviceInfo = this.services.get(serviceName);
        if (!serviceInfo) {
            return null;
        }

        return {
            name: serviceInfo.name,
            status: serviceInfo.status,
            startedAt: serviceInfo.startedAt,
            error: serviceInfo.error,
            hasInstance: !!serviceInfo.instance,
            dependencies: serviceInfo.dependencies
        };
    }

    /**
     * Get all services status
     */
    getAllStatus() {
        const status = {};
        
        for (const [name, serviceInfo] of this.services) {
            status[name] = {
                status: serviceInfo.status,
                startedAt: serviceInfo.startedAt,
                error: serviceInfo.error,
                hasInstance: !!serviceInfo.instance,
                dependencies: serviceInfo.dependencies
            };
        }

        return {
            services: status,
            initialized: this.initialized,
            startOrder: this.startOrder,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Stop all services in reverse order
     */
    async stopAll() {
        try {
            this.logger.info('🛑 Stopping all services...');
            
            const stopOrder = [...this.startOrder].reverse();
            
            for (const serviceName of stopOrder) {
                await this.stopService(serviceName);
            }

            this.initialized = false;
            this.logger.info('✅ All services stopped');
            
            this.emit('all_services_stopped');
            
        } catch (error) {
            this.logger.error('❌ Error stopping services:', error);
            throw error;
        }
    }

    /**
     * Stop individual service
     */
    async stopService(serviceName) {
        const serviceInfo = this.services.get(serviceName);
        
        if (!serviceInfo || !serviceInfo.instance) {
            return;
        }

        try {
            this.logger.info(`🛑 Stopping service: ${serviceName}`);
            
            // Call cleanup method if exists
            if (typeof serviceInfo.instance.cleanup === 'function') {
                await serviceInfo.instance.cleanup();
            }

            serviceInfo.instance = null;
            serviceInfo.status = 'stopped';
            
            this.logger.info(`✅ Service stopped: ${serviceName}`);
            this.emit('service_stopped', serviceName);

        } catch (error) {
            this.logger.error(`❌ Error stopping service ${serviceName}:`, error);
            serviceInfo.status = 'error';
            serviceInfo.error = error.message;
        }
    }

    /**
     * Restart service
     */
    async restartService(serviceName) {
        try {
            await this.stopService(serviceName);
            return await this.initializeService(serviceName);
        } catch (error) {
            this.logger.error(`❌ Failed to restart service ${serviceName}:`, error);
            throw error;
        }
    }

    /**
     * Health check for all services
     */
    async healthCheck() {
        const health = {
            healthy: true,
            services: {},
            summary: {
                total: this.services.size,
                running: 0,
                failed: 0,
                stopped: 0
            }
        };

        for (const [name, serviceInfo] of this.services) {
            let serviceHealth = {
                status: serviceInfo.status,
                healthy: serviceInfo.status === 'running'
            };

            // Call service health check if available
            if (serviceInfo.instance && typeof serviceInfo.instance.healthCheck === 'function') {
                try {
                    const instanceHealth = await serviceInfo.instance.healthCheck();
                    serviceHealth = { ...serviceHealth, ...instanceHealth };
                } catch (error) {
                    serviceHealth.healthy = false;
                    serviceHealth.error = error.message;
                }
            }

            health.services[name] = serviceHealth;

            // Update summary
            if (serviceHealth.healthy) {
                health.summary.running++;
            } else if (serviceInfo.status === 'failed') {
                health.summary.failed++;
                health.healthy = false;
            } else {
                health.summary.stopped++;
            }
        }

        return health;
    }
}

module.exports = ServiceManager;