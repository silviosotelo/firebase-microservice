@@ .. @@
     * Get database path with fallback
     */
     getDatabasePath() {
        // Load environment variables
        require('dotenv').config();
        
        const envPath = process.env.DATABASE_PATH;
        
        if (envPath) {
            return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
        }

        // Default to ./data/firebase_logs.db as specified in documentation
        const defaultPath = path.resolve(process.cwd(), 'data', 'firebase_logs.db');
        
        // Ensure data directory exists and is writable
        try {
            const dataDir = path.dirname(defaultPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
            }
            
            // Test write access to data directory
            const testFile = path.join(dataDir, 'test_write_' + Date.now());
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            
            return defaultPath;
        } catch (error) {
            this.logger?.warn('⚠️ Data directory not writable, trying /tmp');
            
            // Fallback to /tmp for WebContainer compatibility
            const tmpPath = path.join('/tmp', 'firebase_logs.db');
            try {
                const testFile = path.join('/tmp', 'test_write_' + Date.now());
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                return tmpPath;
            } catch (tmpError) {
                this.logger?.warn('⚠️ /tmp not writable either, falling back to memory database');
                return ':memory:';
            }
        }
    }

    /**
     * Ensure database directory exists
     */
    ensureDatabaseDirectory() {
        if (this.dbPath === ':memory:') {
            return ':memory:';
        }

        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
                this.logger.info(`📁 Created database directory: ${dir}`);
            }
        } catch (error) {
            this.logger.warn('⚠️ Could not create database directory:', error.message);
        }
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Ensure database directory exists
                this.ensureDatabaseDirectory();
                
                // Handle special case for memory database
                const dbPath = this.dbPath === ':memory:' ? ':memory:' : this.dbPath;
                
                this.db = new sqlite3.Database(this.dbPath, (err) => {
                    if (err) {
                        this.logger.error('❌ SQLite connection failed:', err.message);
                        reject(err);
                        return;
                    }
                    
                    const dbType = this.dbPath === ':memory:' ? 'in-memory' : 'file';
                    this.logger.info(`✅ SQLite ${dbType} database connected`);
                    
                    this.configureDatabaseSettings(resolve, reject);

                    resolve();
                });
            } catch (error) {
                this.logger.error('❌ Database connection error:', error.message);
                reject(error);
            }
        });
    }

    /**
     * Configure database settings
     */
    configureDatabaseSettings(resolve, reject) {
        this.db.serialize(() => {
            // Only use WAL mode for file databases
            if (this.dbPath !== ':memory:') {
                this.db.run('PRAGMA journal_mode = WAL', (err) => {
                    if (err) {
                        this.logger.warn('⚠️ Could not set WAL mode:', err.message);
                    }
                });
                this.db.run('PRAGMA synchronous = NORMAL');
                this.db.run('PRAGMA cache_size = 10000');
                this.db.run('PRAGMA busy_timeout = 30000');
            } else {
                this.db.run('PRAGMA synchronous = OFF');
                this.db.run('PRAGMA cache_size = 10000');
            }
            this.db.run('PRAGMA foreign_keys = ON');
            this.db.run('PRAGMA temp_store = memory');
        });
    }