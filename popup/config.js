export const API_CONFIG = {
    BASE_URL: 'http://localhost:5777',
    SEARCH_ENDPOINT: '/api/semantic-scholar/search',
    IMPORT_START_ENDPOINT: '/api/semantic-scholar/import-workflow/start',
    IMPORT_RIS_ENDPOINT: '/api/semantic-scholar/import-workflow/ris',
    IMPORT_STATUS_ENDPOINT: '/api/semantic-scholar/import-workflow',
    PROJECTS_ENDPOINT: '/api/projects/my',
    DEFAULT_PAGE_SIZE: 10,

    MAX_RETRIES: 3,
    INITIAL_RETRY_DELAY_MS: 1000,
    MAX_RETRY_DELAY_MS: 5000,
    CACHE_EXPIRY_MS: 15 * 60 * 1000, // 15 minutes
    CACHE_MAX_SIZE: 100,
    DEBOUNCE_MS: 500,
    COOLDOWN_MS: 1000
};

export const APP_CONFIG = {
  WEB_APP_ORIGINS: [
    "http://localhost:5173"
  ]
};
