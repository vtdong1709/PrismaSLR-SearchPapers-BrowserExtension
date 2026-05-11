import { API_CONFIG, APP_CONFIG } from '../config.js';
import { ApiService } from '../apiService.js';

export class AuthService {
    static async getTokenFromWeb() {
        try {
            // 2.1 Get active tab
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true
            });

            if (!tab || !tab.url) return null;

            // 2.2 Validate tab origin
            const origin = new URL(tab.url).origin;
            const isValidWebApp = APP_CONFIG.WEB_APP_ORIGINS.includes(origin);

            if (!isValidWebApp) {
                return null;
            }

            // 3. Extract Token from Web App
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    try {
                        const raw = localStorage.getItem("persist:root");
                        if (!raw) return null;

                        const root = JSON.parse(raw);
                        if (!root.auth) return null;
                        
                        const auth = JSON.parse(root.auth);
                        return auth?.accessToken || null;
                    } catch (e) {
                        return null;
                    }
                }
            });

            if (results && results[0] && results[0].result) {
                return results[0].result;
            }
            
            return null;
        } catch (error) {
            console.error('Failed to get token from web:', error);
            return null;
        }
    }

    static getWebAppUrl() {
        return APP_CONFIG.WEB_APP_ORIGINS[0] || 'http://localhost:5173';
    }

    static async validateToken(token) {
        if (!token) return { isSuccess: false };

        try {
            // We use ApiService.fetchWithRetry for consistency, 
            // but we MUST pass the Authorization header explicitly here 
            // because the token isn't saved to storage yet during the initial sync validation.
            const result = await ApiService.fetchWithRetry(`${API_CONFIG.BASE_URL}/api/auth/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            return result; // Expected { isSuccess: true, data: { ... } }
        } catch (error) {
            console.error('Token validation failed:', error);
            return { isSuccess: false };
        }
    }

    static async getAuthState() {
        const result = await chrome.storage.local.get(['isLoggedIn', 'token', 'user']);
        return {
            isLoggedIn: result.isLoggedIn || false,
            token: result.token || null,
            user: result.user || null
        };
    }

    static async setAuthState(isLoggedIn, token = null, user = null) {
        await chrome.storage.local.set({ isLoggedIn, token, user });
    }

    static async syncAuth() {
        const token = await this.getTokenFromWeb();
        const webAppUrl = this.getWebAppUrl();
        
        if (!token) {
            // We don't necessarily want to clear state here if we're calling this from hydrate
            // but the user's requirement 3.1 says "If no token -> set logged out state"
            // However, to be "graceful" (Task Goal), we might want to keep current session if valid
            // But let's stick to the specific 3.1 instruction for syncAuth itself.
            await this.setAuthState(false);
            return { isSuccess: false, message: `Could not find token in web app. Please make sure you are logged in at ${webAppUrl}` };
        }

        const validation = await this.validateToken(token);
        if (validation.isSuccess) {
            await this.setAuthState(true, token, validation.data);
            return { isSuccess: true, user: validation.data };
        } else {
            await this.setAuthState(false);
            return { isSuccess: false, message: 'Invalid or expired token. Please login to web app again.' };
        }
    }
}
