#!/usr/bin/env node

// ==========================================
// ENDPOINT TESTING SCRIPT
// Prueba todos los endpoints del microservicio
// ==========================================

const axios = require('axios').default;

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.TEST_API_KEY || 'test-key-123';

console.log('🧪 Firebase Microservice Endpoint Testing');
console.log('==========================================\n');

async function testEndpoint(method, endpoint, data = null, headers = {}) {
    try {
        console.log(`${method.toUpperCase()} ${endpoint}`);
        
        const config = {
            method: method.toLowerCase(),
            url: `${BASE_URL}${endpoint}`,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                ...headers
            },
            timeout: 5000
        };

        if (data && (method.toLowerCase() === 'post' || method.toLowerCase() === 'put')) {
            config.data = data;
        }

        const response = await axios(config);
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📄 Response: ${JSON.stringify(response.data, null, 2).substring(0, 200)}...`);
        console.log('');
        
        return { success: true, status: response.status, data: response.data };
        
    } catch (error) {
        const status = error.response?.status || 'NO_RESPONSE';
        const message = error.response?.data?.error || error.message;
        
        console.log(`   ❌ Status: ${status}`);
        console.log(`   💬 Error: ${message}`);
        console.log('');
        
        return { success: false, status, error: message };
    }
}

async function runTests() {
    const results = [];
    
    console.log('🏥 Basic Health Checks');
    console.log('======================\n');
    
    // Test 1: Basic health check
    let result = await testEndpoint('GET', '/health');
    results.push({ name: 'Basic Health Check', ...result });
    
    // Test 2: API health check
    result = await testEndpoint('GET', '/api/health');
    results.push({ name: 'API Health Check', ...result });
    
    // Test 3: API docs
    result = await testEndpoint('GET', '/api/docs');
    results.push({ name: 'API Documentation', ...result });
    
    console.log('🧪 Basic API Tests');
    console.log('==================\n');
    
    // Test 4: Test endpoint
    result = await testEndpoint('POST', '/api/test', { 
        test: 'data',
        timestamp: new Date().toISOString()
    });
    results.push({ name: 'Test Endpoint', ...result });
    
    // Test 5: API root
    result = await testEndpoint('GET', '/api');
    results.push({ name: 'API Root', ...result });
    
    console.log('📊 Stats and Status');
    console.log('===================\n');
    
    // Test 6: Stats endpoint
    result = await testEndpoint('GET', '/api/stats');
    results.push({ name: 'Statistics', ...result });
    
    // Test 7: Queue status
    result = await testEndpoint('GET', '/api/queue/status');
    results.push({ name: 'Queue Status', ...result });
    
    console.log('📱 Notification Tests');
    console.log('=====================\n');
    
    // Test 8: List notifications
    result = await testEndpoint('GET', '/api/notifications?limit=5');
    results.push({ name: 'List Notifications', ...result });
    
    // Test 9: Send notification (should work even without Firebase)
    result = await testEndpoint('POST', '/api/notifications/send', {
        title: 'Test Notification',
        message: 'This is a test from the testing script',
        tokens: ['test-token-123'],
        type: 'general',
        priority: 'normal'
    });
    results.push({ name: 'Send Notification', ...result });
    
    // Test 10: Bulk notifications
    result = await testEndpoint('POST', '/api/notifications/bulk', {
        notifications: [
            {
                title: 'Bulk Test 1',
                message: 'First bulk notification',
                tokens: ['token-1']
            },
            {
                title: 'Bulk Test 2', 
                message: 'Second bulk notification',
                tokens: ['token-2']
            }
        ]
    });
    results.push({ name: 'Bulk Notifications', ...result });
    
    // Test 11: Test notification
    result = await testEndpoint('POST', '/api/notifications/test', {
        token: 'test-fcm-token',
        title: 'Test FCM',
        message: 'Testing FCM functionality'
    });
    results.push({ name: 'Test FCM Notification', ...result });
    
    // Test 12: Token validation
    result = await testEndpoint('POST', '/api/tokens/validate', {
        tokens: ['valid-token-1', 'invalid-token', 'valid-token-2']
    });
    results.push({ name: 'Token Validation', ...result });
    
    console.log('🚫 Error Handling Tests');
    console.log('=======================\n');
    
    // Test 13: 404 endpoint
    result = await testEndpoint('GET', '/api/nonexistent');
    results.push({ name: '404 Handling', ...result });
    
    // Test 14: Invalid JSON
    try {
        await axios.post(`${BASE_URL}/api/test`, 'invalid-json', {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
    } catch (error) {
        console.log('POST /api/test (invalid JSON)');
        console.log(`   ✅ Status: ${error.response?.status || 'ERROR'}`);
        console.log(`   💬 Handled invalid JSON correctly`);
        console.log('');
        results.push({ name: 'Invalid JSON Handling', success: true, status: error.response?.status });
    }
    
    // Test 15: Missing required fields
    result = await testEndpoint('POST', '/api/notifications/send', {
        // Missing title and message
        tokens: ['test-token']
    });
    results.push({ name: 'Validation Error Handling', ...result });
    
    console.log('📊 Test Results Summary');
    console.log('=======================\n');
    
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    const successRate = ((successful / total) * 100).toFixed(1);
    
    console.log(`Total Tests: ${total}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${total - successful}`);
    console.log(`Success Rate: ${successRate}%\n`);
    
    console.log('Detailed Results:');
    console.log('================');
    results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const httpStatus = result.status || 'N/A';
        console.log(`${index + 1:2}. ${status} ${result.name} (${httpStatus})`);
    });
    
    console.log('\n');
    
    if (successful === total) {
        console.log('🎉 All tests passed! The microservice is working correctly.');
    } else if (successful >= total * 0.8) {
        console.log('✅ Most tests passed. The microservice is mostly functional.');
    } else if (successful >= total * 0.5) {
        console.log('⚠️ Some tests failed. Check the service configuration.');
    } else {
        console.log('❌ Many tests failed. The service may not be running correctly.');
    }
    
    console.log('\n🔧 Troubleshooting:');
    console.log('===================');
    console.log('1. Ensure the service is running: npm run dev');
    console.log('2. Check the service is accessible at:', BASE_URL);
    console.log('3. Verify the API key if authentication is enabled');
    console.log('4. Check logs for any errors');
    console.log('5. Ensure all dependencies are installed: npm install');
    
    return { successful, total, successRate, results };
}

// Función para verificar que el servicio esté corriendo
async function checkServiceRunning() {
    try {
        console.log(`🔍 Checking if service is running at ${BASE_URL}...`);
        const response = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
        console.log('✅ Service is running and responding\n');
        return true;
    } catch (error) {
        console.log('❌ Service is not responding');
        console.log('💡 Make sure to start the service first: npm run dev');
        console.log('');
        return false;
    }
}

// Función principal
async function main() {
    const isRunning = await checkServiceRunning();
    
    if (!isRunning) {
        console.log('⚠️ Cannot run tests - service is not running');
        console.log('\nStart the service first:');
        console.log('  npm run dev');
        console.log('\nThen run tests:');
        console.log('  npm run test');
        process.exit(1);
    }
    
    const results = await runTests();
    
    // Exit with appropriate code
    process.exit(results.successful === results.total ? 0 : 1);
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Test script failed:', error.message);
        process.exit(1);
    });
}

module.exports = { runTests, testEndpoint, checkServiceRunning };