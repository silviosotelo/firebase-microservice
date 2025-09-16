// ==========================================
// UTILITY HELPERS
// Common utility functions and helpers
// ==========================================

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

/**
 * Async delay function
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 */
const retryWithBackoff = async (fn, options = {}) => {
    const {
        retries = 3,
        delay: baseDelay = 1000,
        factor = 2,
        maxDelay = 30000,
        onRetry = null
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt === retries) {
                throw error;
            }

            const delayTime = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);
            
            if (onRetry) {
                onRetry(error, attempt + 1, delayTime);
            }

            await delay(delayTime);
        }
    }
    
    throw lastError;
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj);
    }
    
    if (obj instanceof Array) {
        return obj.map(item => deepClone(item));
    }
    
    if (typeof obj === 'object') {
        const cloned = {};
        Object.keys(obj).forEach(key => {
            cloned[key] = deepClone(obj[key]);
        });
        return cloned;
    }
    
    return obj;
};

/**
 * Deep merge objects
 */
const deepMerge = (target, ...sources) => {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                deepMerge(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }

    return deepMerge(target, ...sources);
};

/**
 * Check if value is an object
 */
const isObject = (item) => {
    return item && typeof item === 'object' && !Array.isArray(item) && item !== null;
};

/**
 * Flatten nested object
 */
const flatten = (obj, prefix = '', result = {}) => {
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newKey = prefix ? `${prefix}.${key}` : key;
            
            if (isObject(obj[key]) && !Array.isArray(obj[key])) {
                flatten(obj[key], newKey, result);
            } else {
                result[newKey] = obj[key];
            }
        }
    }
    
    return result;
};

/**
 * Unflatten object
 */
const unflatten = (obj) => {
    const result = {};
    
    for (const key in obj) {
        const keys = key.split('.');
        let current = result;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = obj[key];
    }
    
    return result;
};

/**
 * Generate unique ID
 */
const generateId = (length = 8) => {
    return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate UUID v4
 */
const generateUUID = () => {
    return crypto.randomUUID();
};

/**
 * Generate random string
 */
const generateRandomString = (length = 32, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
};

/**
 * Hash string using crypto
 */
const hashString = (str, algorithm = 'sha256') => {
    return crypto.createHash(algorithm).update(str).digest('hex');
};

/**
 * Generate secure random token
 */
const generateSecureToken = (length = 32) => {
    return crypto.randomBytes(length).toString('base64url');
};

/**
 * Format file size in human readable format
 */
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format duration in human readable format
 */
const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
    return `${(ms / 86400000).toFixed(1)}d`;
};

/**
 * Format relative time
 */
const formatRelativeTime = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
};

/**
 * Parse boolean value
 */
const parseBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(value.toLowerCase());
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return Boolean(value);
};

/**
 * Parse JSON safely
 */
const parseJSON = (str, defaultValue = null) => {
    try {
        return JSON.parse(str);
    } catch (error) {
        return defaultValue;
    }
};

/**
 * Stringify JSON safely
 */
const stringifyJSON = (obj, space = 0) => {
    try {
        return JSON.stringify(obj, null, space);
    } catch (error) {
        return null;
    }
};

/**
 * Escape HTML characters
 */
const escapeHtml = (str) => {
    if (typeof str !== 'string') return str;
    
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    
    return str.replace(/[&<>"'/]/g, (match) => htmlEscapes[match]);
};

/**
 * Unescape HTML characters
 */
const unescapeHtml = (str) => {
    if (typeof str !== 'string') return str;
    
    const htmlUnescapes = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#x27;': "'",
        '&#x2F;': '/'
    };
    
    return str.replace(/&(?:amp|lt|gt|quot|#x27|#x2F);/g, (match) => htmlUnescapes[match]);
};

/**
 * Truncate string
 */
const truncate = (str, length = 100, suffix = '...') => {
    if (typeof str !== 'string') return str;
    if (str.length <= length) return str;
    
    return str.substring(0, length - suffix.length) + suffix;
};

/**
 * Capitalize first letter
 */
const capitalize = (str) => {
    if (typeof str !== 'string') return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Convert to camelCase
 */
const toCamelCase = (str) => {
    return str.replace(/[-_\s]+(.)?/g, (_, chr) => chr ? chr.toUpperCase() : '');
};

/**
 * Convert to snake_case
 */
const toSnakeCase = (str) => {
    return str.replace(/\W+/g, ' ')
        .split(/ |\B(?=[A-Z])/)
        .map(word => word.toLowerCase())
        .join('_');
};

/**
 * Convert to kebab-case
 */
const toKebabCase = (str) => {
    return str.replace(/\W+/g, ' ')
        .split(/ |\B(?=[A-Z])/)
        .map(word => word.toLowerCase())
        .join('-');
};

/**
 * Slugify string
 */
const slugify = (str) => {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

/**
 * Remove empty values from object
 */
const removeEmpty = (obj) => {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, value]) => {
            if (value === null || value === undefined || value === '') return false;
            if (Array.isArray(value) && value.length === 0) return false;
            if (isObject(value) && Object.keys(value).length === 0) return false;
            return true;
        })
    );
};

/**
 * Pick specific properties from object
 */
const pick = (obj, keys) => {
    return keys.reduce((result, key) => {
        if (key in obj) {
            result[key] = obj[key];
        }
        return result;
    }, {});
};

/**
 * Omit specific properties from object
 */
const omit = (obj, keys) => {
    const result = { ...obj };
    keys.forEach(key => delete result[key]);
    return result;
};

/**
 * Group array by property
 */
const groupBy = (array, key) => {
    return array.reduce((groups, item) => {
        const group = typeof key === 'function' ? key(item) : item[key];
        groups[group] = groups[group] || [];
        groups[group].push(item);
        return groups;
    }, {});
};

/**
 * Sort array by property
 */
const sortBy = (array, key, direction = 'asc') => {
    return array.sort((a, b) => {
        const valueA = typeof key === 'function' ? key(a) : a[key];
        const valueB = typeof key === 'function' ? key(b) : b[key];
        
        if (valueA < valueB) return direction === 'asc' ? -1 : 1;
        if (valueA > valueB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
};

/**
 * Get unique values from array
 */
const unique = (array) => {
    return [...new Set(array)];
};

/**
 * Chunk array into smaller arrays
 */
const chunk = (array, size) => {
    return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
        array.slice(index * size, index * size + size)
    );
};

/**
 * Check if file exists
 */
const fileExists = async (filePath) => {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
};

/**
 * Ensure directory exists
 */
const ensureDir = async (dirPath) => {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        return true;
    } catch (error) {
        return false;
    }
};

/**
 * Read file safely
 */
const readFile = async (filePath, encoding = 'utf8') => {
    try {
        return await fs.promises.readFile(filePath, encoding);
    } catch (error) {
        return null;
    }
};

/**
 * Write file safely
 */
const writeFile = async (filePath, data, encoding = 'utf8') => {
    try {
        await ensureDir(path.dirname(filePath));
        await fs.promises.writeFile(filePath, data, encoding);
        return true;
    } catch (error) {
        return false;
    }
};

/**
 * Get file stats
 */
const getFileStats = async (filePath) => {
    try {
        return await fs.promises.stat(filePath);
    } catch (error) {
        return null;
    }
};

/**
 * Validate email address
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Validate URL
 */
const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

/**
 * Validate IP address
 */
const isValidIP = (ip) => {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

/**
 * Get client IP from request
 */
const getClientIP = (req) => {
    return req.ip ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           'unknown';
};

/**
 * Create debounced function
 */
const debounce = (func, wait, immediate = false) => {
    let timeout;
    
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func(...args);
        };
        
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        
        if (callNow) func(...args);
    };
};

/**
 * Create throttled function
 */
const throttle = (func, limit) => {
    let inThrottle;
    
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

/**
 * Measure execution time
 */
const measureTime = async (fn, name = 'Operation') => {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    return {
        result,
        duration,
        durationFormatted: formatDuration(duration),
        name
    };
};

/**
 * Create rate limiter
 */
const createRateLimiter = (maxRequests, windowMs) => {
    const requests = new Map();
    
    return (identifier) => {
        const now = Date.now();
        const windowStart = now - windowMs;
        
        if (!requests.has(identifier)) {
            requests.set(identifier, []);
        }
        
        const userRequests = requests.get(identifier);
        
        // Remove old requests
        const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
        requests.set(identifier, validRequests);
        
        if (validRequests.length >= maxRequests) {
            return false;
        }
        
        validRequests.push(now);
        return true;
    };
};

/**
 * Convert object to query string
 */
const toQueryString = (obj) => {
    return Object.entries(obj)
        .filter(([_, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
};

/**
 * Parse query string to object
 */
const parseQueryString = (queryString) => {
    const params = new URLSearchParams(queryString);
    const result = {};
    
    for (const [key, value] of params) {
        result[key] = value;
    }
    
    return result;
};

/**
 * Create simple cache
 */
const createCache = (maxSize = 100) => {
    const cache = new Map();
    
    return {
        get: (key) => cache.get(key),
        set: (key, value) => {
            if (cache.size >= maxSize) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }
            cache.set(key, value);
        },
        has: (key) => cache.has(key),
        delete: (key) => cache.delete(key),
        clear: () => cache.clear(),
        size: () => cache.size
    };
};

/**
 * Calculate date range
 */
const getDateRange = (period) => {
    const now = new Date();
    const ranges = {
        '1h': { hours: 1 },
        '24h': { hours: 24 },
        '7d': { days: 7 },
        '30d': { days: 30 },
        '90d': { days: 90 }
    };

    const range = ranges[period] || ranges['24h'];
    const from = new Date(now);
    
    if (range.hours) from.setHours(from.getHours() - range.hours);
    if (range.days) from.setDate(from.getDate() - range.days);

    return {
        from: from.toISOString(),
        to: now.toISOString()
    };
};

/**
 * Create event emitter
 */
const createEventEmitter = () => {
    const events = new Map();
    
    return {
        on: (event, callback) => {
            if (!events.has(event)) {
                events.set(event, []);
            }
            events.get(event).push(callback);
        },
        
        off: (event, callback) => {
            if (events.has(event)) {
                const callbacks = events.get(event);
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        },
        
        emit: (event, ...args) => {
            if (events.has(event)) {
                events.get(event).forEach(callback => {
                    try {
                        callback(...args);
                    } catch (error) {
                        console.error('Event callback error:', error);
                    }
                });
            }
        },
        
        once: (event, callback) => {
            const onceCallback = (...args) => {
                callback(...args);
                this.off(event, onceCallback);
            };
            this.on(event, onceCallback);
        }
    };
};

module.exports = {
    // Async utilities
    delay,
    retryWithBackoff,
    measureTime,
    
    // Object utilities
    deepClone,
    deepMerge,
    isObject,
    flatten,
    unflatten,
    removeEmpty,
    pick,
    omit,
    
    // String utilities
    generateId,
    generateUUID,
    generateRandomString,
    generateSecureToken,
    hashString,
    escapeHtml,
    unescapeHtml,
    truncate,
    capitalize,
    toCamelCase,
    toSnakeCase,
    toKebabCase,
    slugify,
    
    // Formatting utilities
    formatBytes,
    formatDuration,
    formatRelativeTime,
    
    // Parsing utilities
    parseBoolean,
    parseJSON,
    stringifyJSON,
    toQueryString,
    parseQueryString,
    
    // Array utilities
    groupBy,
    sortBy,
    unique,
    chunk,
    
    // File utilities
    fileExists,
    ensureDir,
    readFile,
    writeFile,
    getFileStats,
    
    // Validation utilities
    isValidEmail,
    isValidUrl,
    isValidIP,
    getClientIP,
    
    // Function utilities
    debounce,
    throttle,
    createRateLimiter,
    createCache,
    createEventEmitter,
    
    // Date utilities
    getDateRange
};