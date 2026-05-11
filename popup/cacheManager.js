import { API_CONFIG } from './config.js';

export class CacheManager {
    constructor(maxSize = API_CONFIG.CACHE_MAX_SIZE, ttl = API_CONFIG.CACHE_EXPIRY_MS) {
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.prefix = 'cache_';
        this.debug = true; // Toggle for development
    }

    log(message, type = 'info') {
        if (this.debug) {
            console.log(`[CacheManager] ${message}`);
        }
    }

    async get(key) {
        const fullKey = this.prefix + key;
        const result = await chrome.storage.local.get(fullKey);
        const entry = result[fullKey];

        if (!entry) {
            this.log(`MISS: ${key}`);
            return null;
        }

        const now = Date.now();
        // TTL Check
        if (now - entry.timestamp > this.ttl) {
            this.log(`EXPIRED: ${key} (Age: ${Math.round((now - entry.timestamp) / 1000 / 60)} mins)`);
            await this.remove(key);
            return { expired: true };
        }

        // Update lastAccessed for LRU
        entry.lastAccessed = now;
        entry.accessCount = (entry.accessCount || 0) + 1;
        await chrome.storage.local.set({ [fullKey]: entry });

        this.log(`HIT: ${key} (Accesses: ${entry.accessCount})`);
        return entry.data;
    }

    async set(key, data) {
        const fullKey = this.prefix + key;
        const now = Date.now();

        // Standardized metadata structure
        const entry = {
            data: data,
            timestamp: now,
            lastAccessed: now,
            accessCount: 1
        };

        // LRU Eviction check
        const allData = await chrome.storage.local.get(null);
        const cacheKeys = Object.keys(allData).filter(k => k.startsWith(this.prefix));

        if (cacheKeys.length >= this.maxSize) {
            this.log(`LIMIT REACHED (${this.maxSize}), evicting oldest accessed...`);
            // Sort by lastAccessed to find the least recently used
            const entriesToEvict = cacheKeys
                .map(k => ({ key: k, lastAccessed: allData[k].lastAccessed || 0 }))
                .sort((a, b) => a.lastAccessed - b.lastAccessed);

            const oldest = entriesToEvict[0].key;
            await chrome.storage.local.remove(oldest);
            this.log(`EVICTED: ${oldest}`);
        }

        await chrome.storage.local.set({ [fullKey]: entry });
        this.log(`SAVED: ${key}`);
    }

    async remove(key) {
        await chrome.storage.local.remove(this.prefix + key);
    }

    async clearExpiredAndExcess() {
        const allData = await chrome.storage.local.get(null);
        const now = Date.now();
        const toRemove = [];
        
        const cacheEntries = Object.entries(allData)
            .filter(([key]) => key.startsWith(this.prefix))
            .map(([key, value]) => ({ key, ...value }));

        // 1. Identify expired
        for (const entry of cacheEntries) {
            if (now - entry.timestamp > this.ttl) {
                toRemove.push(entry.key);
                this.log(`CLEANUP EXPIRED: ${entry.key}`);
            }
        }

        // 2. Identify excess (LRU based)
        const remainingEntries = cacheEntries
            .filter(e => !toRemove.includes(e.key))
            .sort((a, b) => b.lastAccessed - a.lastAccessed); // newest first

        if (remainingEntries.length > this.maxSize) {
            const excess = remainingEntries.slice(this.maxSize);
            excess.forEach(e => {
                toRemove.push(e.key);
                this.log(`CLEANUP EXCESS: ${e.key}`);
            });
        }

        if (toRemove.length > 0) {
            await chrome.storage.local.remove(toRemove);
            this.log(`CLEANED: ${toRemove.length} entries`);
        }
    }

    async getAllCachedPapers() {
        const allData = await chrome.storage.local.get(null);
        const papers = new Map();
        const now = Date.now();
        
        Object.keys(allData).forEach(key => {
            if (key.startsWith(this.prefix)) {
                const entry = allData[key];
                // Only use non-expired papers for export
                if (now - entry.timestamp <= this.ttl && entry.data && entry.data.items) {
                    entry.data.items.forEach(p => papers.set(p.id, p));
                }
            }
        });
        
        return papers;
    }
}
