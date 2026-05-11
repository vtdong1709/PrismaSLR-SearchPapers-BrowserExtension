import { API_CONFIG } from '../config.js';
import { ApiService } from '../apiService.js';

export class ImportWorkflowService {
    /**
     * Starts a new import workflow session
     * @param {string} projectId - The ID of the project to import into
     * @returns {Promise<{isSuccess: boolean, sessionId: string, message: string}>}
     */
    static async startWorkflow(projectId) {
        try {
            const data = await ApiService.fetchWithRetry(`${API_CONFIG.BASE_URL}${API_CONFIG.IMPORT_START_ENDPOINT}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: projectId
                })
            });

            return {
                isSuccess: true,
                sessionId: data.data.sessionId,
                message: 'Workflow started successfully'
            };
        } catch (error) {
            console.error('Start Workflow Error:', error);
            return { isSuccess: false, message: error.message };
        }
    }

    /**
     * Uploads the RIS file to the session
     * @param {string} sessionId - The active session ID
     * @param {File|Blob} risFile - The RIS file object
     * @returns {Promise<{isSuccess: boolean, validPaperIds: string[], duplicatePaperIds: string[], message: string}>}
     */
    static async uploadRis(sessionId, risFile) {
        try {
            const formData = new FormData();
            formData.append('file', risFile, 'papers.ris');
            formData.append('sessionId', sessionId);

            const data = await ApiService.fetchWithRetry(`${API_CONFIG.BASE_URL}${API_CONFIG.IMPORT_RIS_ENDPOINT}`, {
                method: 'POST',
                body: formData
            });

            return {
                isSuccess: true,
                validPaperIds: data.data.validPaperIds || [],
                duplicatePaperIds: data.data.duplicatePaperIds || [],
                paperMappings: data.data.paperMappings || [],
                message: 'RIS uploaded successfully'
            };
        } catch (error) {
            console.error('Upload RIS Error:', error);
            return { isSuccess: false, message: error.message };
        }
    }

    /**
     * Gets the current status of the workflow session
     * @param {string} sessionId - The session ID to poll
     * @returns {Promise<{isSuccess: boolean, status: string, validPaperIds: string[], duplicatePaperIds: string[], message: string}>}
     */
    static async getWorkflowStatus(sessionId) {
        try {
            const data = await ApiService.fetchWithRetry(`${API_CONFIG.BASE_URL}${API_CONFIG.IMPORT_STATUS_ENDPOINT}/${sessionId}`, {
                method: 'GET'
            });

            return {
                isSuccess: true,
                data: data.data, // Contains state, validPaperIds, etc.
                message: 'Status fetched successfully'
            };
        } catch (error) {
            console.error('Get Status Error:', error);
            return { isSuccess: false, message: error.message };
        }
    }
}

