@@ .. @@
     * Get database path with fallback
     */
     getDatabasePath() {
-        const envPath = process.env.DATABASE_PATH;
+        // Load environment variables
+        require('dotenv').config();
+        
+        const envPath = process.env.DATABASE_PATH;
         
         if (envPath) {
             return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
         }

-        // Use /tmp directory for WebContainer compatibility
-        const defaultPath = path.join('/tmp', 'firebase_logs.db');
+        // Default to ./data/firebase_logs.db as specified in documentation
+        const defaultPath = path.resolve(process.cwd(), 'data', 'firebase_logs.db');
         
-        // Ensure /tmp directory is writable (it should be by default)
+        // Ensure data directory exists and is writable
         try {
-            // Test write access to /tmp
-            const testFile = path.join('/tmp', 'test_write_' + Date.now());
+            const dataDir = path.dirname(defaultPath);
+            if (!fs.existsSync(dataDir)) {
+                fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
+            }
+            
+            // Test write access to data directory
+            const testFile = path.join(dataDir, 'test_write_' + Date.now());
             fs.writeFileSync(testFile, 'test');
             fs.unlinkSync(testFile);
+            
+            return defaultPath;
         } catch (error) {
-            this.logger?.warn('⚠️ /tmp not writable, falling back to memory database');
+            this.logger?.warn('⚠️ Data directory not writable, trying /tmp');
+            
+            // Fallback to /tmp for WebContainer compatibility
+            const tmpPath = path.join('/tmp', 'firebase_logs.db');
+            try {
+                const testFile = path.join('/tmp', 'test_write_' + Date.now());
+                fs.writeFileSync(testFile, 'test');
+                fs.unlinkSync(testFile);
+                return tmpPath;
+            } catch (tmpError) {
+                this.logger?.warn('⚠️ /tmp not writable either, falling back to memory database');
+                return ':memory:';
+            }
+        }
+    }
+
+    /**
+     * Ensure database directory exists
+     */
+    ensureDatabaseDirectory() {
+        if (this.dbPath === ':memory:') {
             return ':memory:';
         }

-        return defaultPath;
+        try {
+            const dir = path.dirname(this.dbPath);
+            if (!fs.existsSync(dir)) {
+                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
+                this.logger.info(`📁 Created database directory: ${dir}`);
+            }
+        } catch (error) {
+            this.logger.warn('⚠️ Could not create database directory:', error.message);
+        }
     }