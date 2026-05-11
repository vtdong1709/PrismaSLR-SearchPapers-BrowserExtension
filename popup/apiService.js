import { API_CONFIG } from './config.js';

export class ApiService {
    static inFlightRequests = new Map();

    static normalize(text) {
        if (!text) return '';
        return text.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    static generateCacheKey(params) {
        const keyword = this.normalize(params.keyword);
        const yearFrom = params.yearFrom || '';
        const yearTo = params.yearTo || '';
        const page = params.page || 1;
        const pageSize = params.pageSize || API_CONFIG.DEFAULT_PAGE_SIZE;
        
        return `search|${keyword}|${yearFrom}|${yearTo}|${page}|${pageSize}`;
    }

    static async fetchWithRetry(url, options = {}, onStateChange = null) {
        let retries = 0;
        let delay = API_CONFIG.INITIAL_RETRY_DELAY_MS;

        // Automatically add Authorization header if token exists
        const { token } = await chrome.storage.local.get('token');
        if (token) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            };
        }

        while (retries <= API_CONFIG.MAX_RETRIES) {
            try {
                const response = await fetch(url, options);

                if (response.ok) {
                    return await response.json();
                }

                if (response.status === 429) {
                    if (onStateChange) onStateChange('queued', 'Server busy, queued for processing...');
                } else if (response.status >= 500) {
                    if (onStateChange) onStateChange('retrying', `Server error, retrying (${retries + 1}/${API_CONFIG.MAX_RETRIES})...`);
                } else {
                    const errorBody = await response.json().catch(() => ({}));
                    throw new Error(errorBody.message || `Request failed (${response.status})`);
                }

            } catch (error) {
                if (retries === API_CONFIG.MAX_RETRIES) throw error;
                if (onStateChange) onStateChange('retrying', `Connection error, retrying...`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
            retries++;
            delay = Math.min(delay * 2, API_CONFIG.MAX_RETRY_DELAY_MS);
        }
    }

    static async searchPapers(params, onStateChange = null) {
        const cacheKey = this.generateCacheKey(params);

        // Request Deduplication: if same request is in flight, return the same promise
        if (this.inFlightRequests.has(cacheKey)) {
            return this.inFlightRequests.get(cacheKey);
        }

        const url = new URL(`${API_CONFIG.BASE_URL}${API_CONFIG.SEARCH_ENDPOINT}`);
        url.searchParams.append('keyword', this.normalize(params.keyword));
        if (params.yearFrom) url.searchParams.append('yearFrom', params.yearFrom);
        if (params.yearTo) url.searchParams.append('yearTo', params.yearTo);
        url.searchParams.append('page', params.page || 1);
        url.searchParams.append('pageSize', params.pageSize || API_CONFIG.DEFAULT_PAGE_SIZE);

        const requestPromise = this.fetchWithRetry(url.toString(), {}, onStateChange);
        this.inFlightRequests.set(cacheKey, requestPromise);

        try {
            return await requestPromise;
        } finally {
            this.inFlightRequests.delete(cacheKey);
        }
    }
    static async fetchMyProjects() {
        const url = new URL(`${API_CONFIG.BASE_URL}${API_CONFIG.PROJECTS_ENDPOINT}`);
        url.searchParams.append('status', '1'); // status must be 1 to get active project
        url.searchParams.append('pageNumber', '1');
        url.searchParams.append('pageSize', '100'); // Get enough projects

        return await this.fetchWithRetry(url.toString(), {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json'
            }
        });
    }

}

