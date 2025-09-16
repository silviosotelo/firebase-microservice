#!/usr/bin/env node

// ==========================================
// SETUP SCRIPT - Inicialización del Microservicio
// Prepara el entorno para ejecutar el microservicio
// ==========================================

const fs = require('fs');
const path = require('path');

console.log('🚀 Firebase Microservice Setup');
console.log('=====================================\n');

async function setup() {
    try {
        // 1. Crear directorios necesarios
        console.log('📁 Creating directories...');
        const directories = ['data', 'logs', 'backup', 'public', 'temp'];
        
        directories.forEach(dir => {
            const dirPath = path.join(process.cwd(), dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`   ✅ Created: ${dir}/`);
            } else {
                console.log(`   ✓ Exists: ${dir}/`);
            }
        });

        // 2. Crear archivo .env si no existe
        console.log('\n⚙️ Setting up environment...');
        const envPath = path.join(process.cwd(), '.env');
        const envExamplePath = path.join(process.cwd(), '.env.example');
        
        if (!fs.existsSync(envPath)) {
            if (fs.existsSync(envExamplePath)) {
                fs.copyFileSync(envExamplePath, envPath);
                console.log('   ✅ Created .env from .env.example');
            } else {
                // Crear .env básico
                const basicEnv = `# Firebase Microservice Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_PATH=./data/firebase_logs.db
DB_RETENTION_DAYS=90

# Rate Limiting (Development - Permissive)
ENABLE_RATE_LIMITING=false
API_RATE_MAX=10000
API_RATE_WINDOW=900000

# CORS (Development - Allow All)
ALLOWED_ORIGINS=*

# Features
ENABLE_ADMIN_PANEL=true
ENABLE_WEBSOCKETS=true
ENABLE_MONITORING=false

# API Keys for Testing
API_KEY=test-key-123
API_KEY_USER=user-key-456
API_KEY_ADMIN=admin-key-789

# Optional Services
REDIS_ENABLED=false
`;
                fs.writeFileSync(envPath, basicEnv);
                console.log('   ✅ Created basic .env file');
            }
        } else {
            console.log('   ✓ .env file already exists');
        }

        // 3. Verificar dependencias
        console.log('\n📦 Checking dependencies...');
        const packageJsonPath = path.join(process.cwd(), 'package.json');
        const nodeModulesPath = path.join(process.cwd(), 'node_modules');
        
        if (!fs.existsSync(nodeModulesPath)) {
            console.log('   ❌ node_modules not found');
            console.log('   💡 Run: npm install');
        } else {
            console.log('   ✅ Dependencies installed');
        }

        // 4. Verificar archivos principales
        console.log('\n📋 Checking main files...');
        const mainFiles = [
            'app.js',
            'src/config/database.js',
            'src/routes/api-simple.js',
            'src/controllers/notificationController.js',
            'src/middleware/auth-simple.js',
            'src/middleware/errorHandler.js'
        ];

        let allFilesExist = true;
        mainFiles.forEach(file => {
            const filePath = path.join(process.cwd(), file);
            if (fs.existsSync(filePath)) {
                console.log(`   ✅ Found: ${file}`);
            } else {
                console.log(`   ❌ Missing: ${file}`);
                allFilesExist = false;
            }
        });

        // 5. Inicializar base de datos
        console.log('\n🗄️ Initializing database...');
        try {
            // Importar y ejecutar inicialización de BD
            const dbPath = process.env.DATABASE_PATH || './data/firebase_logs.db';
            
            if (fs.existsSync(dbPath)) {
                console.log('   ✓ Database file already exists');
            } else {
                console.log('   📊 Database will be created on first run');
            }
        } catch (error) {
            console.log(`   ⚠️ Database check failed: ${error.message}`);
        }

        // 6. Crear archivos de prueba
        console.log('\n🧪 Creating test files...');
        
        // Test data para notificaciones
        const testDataPath = path.join(process.cwd(), 'data', 'test-data.json');
        if (!fs.existsSync(testDataPath)) {
            const testData = {
                notifications: [
                    {
                        title: "Test Notification 1",
                        message: "This is a test notification",
                        type: "general",
                        tokens: ["test-token-123"]
                    },
                    {
                        title: "Test Notification 2", 
                        message: "Another test notification",
                        type: "general",
                        topic: "test-topic"
                    }
                ],
                users: [
                    {
                        user_id: "test-user-1",
                        name: "Test User",
                        email: "test@example.com"
                    }
                ]
            };
            
            fs.writeFileSync(testDataPath, JSON.stringify(testData, null, 2));
            console.log('   ✅ Created test-data.json');
        } else {
            console.log('   ✓ test-data.json already exists');
        }

        // 7. Crear archivo de configuración básico
        console.log('\n⚙️ Creating basic configuration...');
        const configPath = path.join(process.cwd(), 'config.json');
        if (!fs.existsSync(configPath)) {
            const basicConfig = {
                service: "Firebase Microservice",
                version: "1.0.1",
                environment: "development",
                features: {
                    notifications: true,
                    websockets: true,
                    queue: true,
                    stats: true,
                    admin: true
                },
                limits: {
                    maxNotificationsPerRequest: 1000,
                    maxTokensPerNotification: 1000,
                    rateLimitPerMinute: 1000
                },
                defaults: {
                    notificationType: "general",
                    priority: "normal",
                    retryAttempts: 3
                }
            };
            
            fs.writeFileSync(configPath, JSON.stringify(basicConfig, null, 2));
            console.log('   ✅ Created config.json');
        } else {
            console.log('   ✓ config.json already exists');
        }

        // 8. Resultados finales
        console.log('\n📊 Setup Results:');
        console.log('=====================================');
        
        if (allFilesExist) {
            console.log('✅ All required files present');
        } else {
            console.log('❌ Some files are missing - check above');
        }
        
        console.log('✅ Directories created');
        console.log('✅ Environment configured');
        console.log('✅ Test data prepared');
        
        console.log('\n🚀 Next Steps:');
        console.log('=====================================');
        console.log('1. npm install        # Install dependencies');
        console.log('2. npm run dev        # Start development server');
        console.log('3. npm run test       # Test endpoints');
        console.log('');
        console.log('🔗 Endpoints:');
        console.log('• Health: http://localhost:3000/health');
        console.log('• API:    http://localhost:3000/api');
        console.log('• Docs:   http://localhost:3000/api/docs');
        
        console.log('\n✅ Setup completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('1. Check file permissions');
        console.error('2. Ensure you have write access');
        console.error('3. Run with appropriate privileges');
        process.exit(1);
    }
}

// Ejecutar setup
if (require.main === module) {
    setup();
}

module.exports = { setup };