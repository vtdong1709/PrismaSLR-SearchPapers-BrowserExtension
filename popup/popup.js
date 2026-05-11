import { API_CONFIG } from './config.js';
import { ApiService } from './apiService.js';
import { CacheManager } from './cacheManager.js';
import { ImportWorkflowService } from './services/importWorkflowService.js';
import { AuthService } from './services/authService.js';

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const searchInput = document.getElementById('searchInput');
    const yearFromInput = document.getElementById('yearFrom');
    const yearToInput = document.getElementById('yearTo');
    const searchBtn = document.getElementById('searchBtn');
    const resultsList = document.getElementById('resultsList');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const toast = document.getElementById('feedbackToast');

    // Auth UI Elements
    const authOverlay = document.getElementById('authOverlay');
    const syncAuthBtn = document.getElementById('syncAuthBtn');
    const authStatusMsg = document.getElementById('authStatusMsg');
    const userProfile = document.getElementById('userProfile');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');

    // Import UI Elements
    const importOverlay = document.getElementById('importProgressOverlay');
    const closeImportBtn = document.getElementById('closeImportBtn');
    
    // Project Selection Elements
    const projectSelectionSection = document.getElementById('projectSelectionSection');
    const projectSelect = document.getElementById('projectSelect');
    const confirmImportBtn = document.getElementById('confirmImportBtn');
    const workflowStepsSection = document.getElementById('workflowStepsSection');
    
    const steps = {
        session: document.getElementById('step-session'),
        ris: document.getElementById('step-ris'),
        polling: document.getElementById('step-polling')
    };

    const stateElements = {
        initial: document.getElementById('initialState'),
        loading: document.getElementById('loadingState'),
        queued: document.getElementById('queuedState'),
        retrying: document.getElementById('retryingState'),
        empty: document.getElementById('emptyState'),
        error: document.getElementById('errorState'),
        results: resultsList
    };

    // State Management
    const state = {
        isLoggedIn: false,
        user: null,
        papers: [],
        selectedIds: new Set(),
        cache: new CacheManager(),
        lastSearchTime: 0,
        isFrontendBusy: false,
        searchTimeout: null,
        currentPage: 1,
        totalPages: 0,
        lastCacheKey: null,
        
        // Import Session State
        importSession: {
            sessionId: null,
            projectId: null,
            paperIds: [],
            paperMappings: [], // Mapping between SourceId and InternalId
            status: "idle"
        },

        importProgress: {
            total: 0,
            uploaded: 0,
            failed: 0
        }
    };

    // --- UI Helpers ---

    function updateAuthUI() {
        if (state.isLoggedIn && state.user) {
            authOverlay.classList.add('hidden');
            userProfile.classList.remove('hidden');
            userName.textContent = state.user.name || state.user.email || 'User';
            userAvatar.textContent = (state.user.name || state.user.email || 'U').charAt(0).toUpperCase();
        } else {
            authOverlay.classList.remove('hidden');
            userProfile.classList.add('hidden');
        }
    }

    async function handleSyncAuth() {
        authStatusMsg.textContent = 'Syncing...';
        authStatusMsg.className = 'auth-status-msg';
        syncAuthBtn.disabled = true;

        try {
            const result = await AuthService.syncAuth();
            if (result.isSuccess) {
                state.isLoggedIn = true;
                state.user = result.user;
                authStatusMsg.textContent = 'Success! Logged in.';
                authStatusMsg.className = 'auth-status-msg success';
                setTimeout(() => {
                    updateAuthUI();
                    loadProjects(); // Refresh projects after login
                }, 1000);
            } else {
                authStatusMsg.textContent = result.message || 'Sync failed.';
                authStatusMsg.className = 'auth-status-msg error';
            }
        } catch (error) {
            authStatusMsg.textContent = 'Sync error occurred.';
            authStatusMsg.className = 'auth-status-msg error';
        } finally {
            syncAuthBtn.disabled = false;
        }
    }

    // --- UI Helpers ---

    function showToast(message, type = 'info') {
        toast.className = `toast ${type}`;
        toast.querySelector('.toast-message').textContent = message;
        toast.classList.remove('hidden');
        
        if (state.toastTimeout) clearTimeout(state.toastTimeout);
        state.toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    function setUIState(newState, message = "") {
        if (stateElements[newState] && !stateElements[newState].classList.contains('hidden') && !message) return;

        Object.values(stateElements).forEach(el => el.classList.add('hidden'));
        
        if (stateElements[newState]) {
            stateElements[newState].classList.remove('hidden');
            if (message && stateElements[newState].querySelector('p')) {
                stateElements[newState].querySelector('p').textContent = message;
            }
        }

        const isBusy = ['loading', 'queued', 'retrying'].includes(newState);
        state.isFrontendBusy = isBusy;
        [searchInput, yearFromInput, yearToInput, searchBtn].forEach(el => el.disabled = isBusy);
        updateActionBar();
    }

    function updateStep(stepKey, status) {
        const el = steps[stepKey];
        if (!el) return;
        
        el.classList.remove('active', 'completed');
        if (status === 'active') el.classList.add('active');
        if (status === 'completed') el.classList.add('completed');
    }

    function resetImportUI() {
        Object.keys(steps).forEach(key => updateStep(key, 'idle'));
        
        // Reset to project selection view
        projectSelectionSection.classList.remove('hidden');
        workflowStepsSection.classList.add('hidden');
        confirmImportBtn.disabled = !projectSelect.value;
        
        importOverlay.classList.add('hidden');
    }

    async function loadProjects() {
        try {
            projectSelect.innerHTML = '<option value="" disabled selected>Loading projects...</option>';
            const result = await ApiService.fetchMyProjects();
            
            if (result && result.isSuccess && result.data && result.data.items) {
                projectSelect.innerHTML = '<option value="" disabled selected>Choose a project...</option>';
                result.data.items.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.title;
                    projectSelect.appendChild(option);
                });
            } else {
                projectSelect.innerHTML = '<option value="" disabled selected>No active projects found</option>';
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            projectSelect.innerHTML = '<option value="" disabled selected>Error loading projects</option>';
        }
    }

    // --- Core Logic ---

    async function hydrate() {
        // 1. Check Authentication State - Always try to sync from web app on startup
        const syncResult = await AuthService.syncAuth();
        if (syncResult.isSuccess) {
            state.isLoggedIn = true;
            state.user = syncResult.user;
        } else {
            // Check if we already have a valid session in storage even if sync failed (e.g. no tab open)
            const auth = await AuthService.getAuthState();
            if (auth.isLoggedIn && auth.token) {
                const validation = await AuthService.validateToken(auth.token);
                if (validation.isSuccess) {
                    state.isLoggedIn = true;
                    state.user = validation.data;
                    await AuthService.setAuthState(true, auth.token, validation.data);
                } else {
                    state.isLoggedIn = false;
                    await AuthService.setAuthState(false);
                }
            } else {
                state.isLoggedIn = false;
                await AuthService.setAuthState(false);
            }
        }
        updateAuthUI();

        // 2. Run automatic cleanup
        await state.cache.clearExpiredAndExcess();

        // 2. Load last state from storage
        const result = await chrome.storage.local.get('last_session');
        const session = result['last_session'];
        
        if (session) {
            searchInput.value = session.query || '';
            yearFromInput.value = session.yearFrom || '';
            yearToInput.value = session.yearTo || '';
            
            if (session.cacheKey) {
                const cached = await state.cache.get(session.cacheKey);
                // If it returns {expired: true}, get() already handled removal
                if (cached && !cached.expired) {
                    loadResults(cached, session.cacheKey);
                } else {
                    setUIState('initial');
                }
            }
        }
    }

    async function saveSession(params, cacheKey) {
        await chrome.storage.local.set({
            'last_session': {
                query: params.keyword,
                yearFrom: params.yearFrom,
                yearTo: params.yearTo,
                cacheKey: cacheKey,
                timestamp: Date.now()
            }
        });
    }

    function handleSearchTrigger(forcePage = 1) {
        const query = ApiService.normalize(searchInput.value);
        if (!query) return;

        if (state.isFrontendBusy && forcePage === 1) return;

        if (state.searchTimeout) clearTimeout(state.searchTimeout);
        
        const now = Date.now();
        const cooldownRemaining = API_CONFIG.COOLDOWN_MS - (now - state.lastSearchTime);
        const delay = cooldownRemaining > 0 ? cooldownRemaining : API_CONFIG.DEBOUNCE_MS;
        
        state.searchTimeout = setTimeout(() => performSearch(forcePage), delay);
    }

    async function performSearch(page = 1) {
        const query = ApiService.normalize(searchInput.value);
        if (!query) return;

        const params = {
            keyword: query,
            yearFrom: yearFromInput.value,
            yearTo: yearToInput.value,
            page: page,
            pageSize: API_CONFIG.DEFAULT_PAGE_SIZE
        };

        const cacheKey = ApiService.generateCacheKey(params);
        
        // 1. Layered Lookup Strategy
        const cached = await state.cache.get(cacheKey);
        
        if (cached) {
            if (cached.expired) {
                showToast('Cache expired, fetching fresh data...', 'info');
                // Continue to fetch
            } else {
                if (state.lastCacheKey === cacheKey) return;
                loadResults(cached, cacheKey);
                saveSession(params, cacheKey);
                showToast('Loaded from cache', 'success');
                return;
            }
        }

        if (state.isFrontendBusy) return;

        state.isFrontendBusy = true;
        state.lastSearchTime = Date.now();
        setUIState('loading', 'Fetching from server...');

        try {
            const result = await ApiService.searchPapers(params, (status, msg) => {
                setUIState(status, msg);
            });

            if (!result.isSuccess) {
                throw new Error(result.message || 'Search failed');
            }

            const searchData = result.data;
            const mappedPapers = mapPapers(searchData.items);
            const resultToCache = {
                items: mappedPapers,
                totalPages: searchData.totalPages,
                pageNumber: searchData.pageNumber
            };

            await state.cache.set(cacheKey, resultToCache);
            loadResults(resultToCache, cacheKey);
            saveSession(params, cacheKey);

        } catch (error) {
            console.error('Search Error:', error);
            setUIState('error', error.message);
            showToast(error.message, 'error');
        } finally {
            state.isFrontendBusy = false;
            updateActionBar();
        }
    }

    function mapPapers(items) {
        return (items || []).map(item => ({
            id: item.paperId,
            title: item.title || 'Untitled',
            authors: Array.isArray(item.authors) ? item.authors.join(', ') : (item.authors || 'Unknown Authors'),
            authorList: Array.isArray(item.authors) ? item.authors : [],
            year: item.year || 'N/A',
            journal: item.journal || 'Unknown Venue',
            doi: item.doi,
            url: item.url,
            abstract: item.abstract ? item.abstract.trim().replace(/\s+/g, ' ') : '',
            pdfUrl: item.openAccessPdfUrl
        }));
    }

    function loadResults(data, cacheKey) {
        state.papers = data.items;
        state.totalPages = data.totalPages;
        state.currentPage = data.pageNumber;
        state.lastCacheKey = cacheKey;

        renderResults();
        
        if (state.papers.length === 0) {
            setUIState('empty');
        } else {
            setUIState('results');
        }
    }

    // --- Rendering Optimization ---

    function renderResults() {
        resultsList.innerHTML = '';
        state.papers.forEach(paper => {
            resultsList.appendChild(createPaperElement(paper));
        });
        updateActionBar();
    }

    function createPaperElement(paper) {
        const li = document.createElement('li');
        const isSelected = state.selectedIds.has(paper.id);
        li.className = `result-item ${isSelected ? 'selected' : ''}`;
        li.dataset.id = paper.id;

        li.innerHTML = `
            <div class="checkbox-container">
                <input type="checkbox" ${isSelected ? 'checked' : ''}>
            </div>
            <div class="paper-info">
                <h3 class="paper-title">${paper.title}</h3>
                <div class="paper-meta">
                    <span class="paper-authors">${paper.authors}</span>
                    <span class="paper-year">${paper.year}</span>
                    ${paper.journal && paper.journal !== 'Unknown Venue' ? `<span class="paper-venue">${paper.journal}</span>` : ''}
                </div>
                ${paper.pdfUrl ? `
                <div class="paper-actions">
                    <a href="${paper.pdfUrl}" target="_blank" class="pdf-btn" title="Open Full-Text in New Tab">
                        <svg class="pdf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        Open Full-Text
                    </a>
                </div>` : ''}
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            toggleSelection(paper.id, li);
        });

        const checkbox = li.querySelector('input');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSelection(paper.id, li);
        });

        return li;
    }

    function toggleSelection(id, element) {
        const isSelected = !state.selectedIds.has(id);
        if (isSelected) {
            state.selectedIds.add(id);
            element.classList.add('selected');
        } else {
            state.selectedIds.delete(id);
            element.classList.remove('selected');
        }
        element.querySelector('input').checked = isSelected;
        updateActionBar();
    }

    function updateActionBar() {
        const hasSelection = state.selectedIds.size > 0;
        const isBusy = state.isFrontendBusy;

        exportBtn.disabled = !hasSelection || isBusy;
        exportBtn.textContent = `Export RIS${hasSelection ? ` (${state.selectedIds.size})` : ''}`;
        
        importBtn.disabled = !hasSelection || isBusy;
        importBtn.textContent = `Import${hasSelection ? ` (${state.selectedIds.size})` : ''}`;

        if (state.papers.length > 0) {
            const allSelected = state.papers.every(p => state.selectedIds.has(p.id));
            selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
        }
    }

    // --- Export Logic ---

    function generateRIS(papers) {
        return papers.map(paper => {
            let ris = "TY  - JOUR\n";
            ris += `TI  - ${paper.title}\n`;
            if (paper.authorList) paper.authorList.forEach(author => ris += `AU  - ${author}\n`);
            if (paper.year && paper.year !== 'N/A') ris += `PY  - ${paper.year}\n`;
            if (paper.journal && paper.journal !== 'Unknown Venue') ris += `JO  - ${paper.journal}\n`;
            if (paper.doi) ris += `DO  - ${paper.doi}\n`;
            if (paper.url) ris += `UR  - ${paper.url}\n`;
            if (paper.abstract) ris += `AB  - ${paper.abstract}\n`;
            ris += "ER  - \n";
            return ris;
        }).join('\n');
    }

    function downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'application/x-research-info-systems' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({ url, filename, saveAs: false }, () => URL.revokeObjectURL(url));
    }



    // --- Event Listeners ---

    searchBtn.addEventListener('click', () => handleSearchTrigger(1));
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchTrigger(1);
    });

    selectAllBtn.addEventListener('click', () => {
        if (state.papers.length === 0) return;
        const allSelected = state.papers.every(p => state.selectedIds.has(p.id));
        state.papers.forEach(p => allSelected ? state.selectedIds.delete(p.id) : state.selectedIds.add(p.id));
        renderResults();
    });

    exportBtn.addEventListener('click', async () => {
        const allSeenPapers = await state.cache.getAllCachedPapers();
        
        const selectedPapers = Array.from(state.selectedIds)
            .map(id => allSeenPapers.get(id))
            .filter(Boolean);

        if (selectedPapers.length === 0) {
            showToast('Please select papers to export', 'warning');
            return;
        }

        const risContent = generateRIS(selectedPapers);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = selectedPapers.length > 1 ? 
            `scholar-batch-${timestamp}.ris` : 
            `${selectedPapers[0].title.slice(0, 50).replace(/[/\\?%*:|"<>]/g, '-')}.ris`;

        downloadFile(risContent, filename);
        
        showToast(`Exported ${selectedPapers.length} papers`, 'success');
    });

    // --- Import Workflow Logic ---

    importBtn.addEventListener('click', async () => {
        if (state.isFrontendBusy) return;
        
        const hasSelection = state.selectedIds.size > 0;
        if (!hasSelection) {
            showToast('Please select papers to import', 'warning');
            return;
        }

        resetImportUI();
        importOverlay.classList.remove('hidden');
        await loadProjects();
    });

    projectSelect.addEventListener('change', () => {
        confirmImportBtn.disabled = !projectSelect.value;
        state.importSession.projectId = projectSelect.value;
    });

    confirmImportBtn.addEventListener('click', async () => {
        if (!state.importSession.projectId) return;
        
        const allSeenPapers = await state.cache.getAllCachedPapers();
        const selectedPapers = Array.from(state.selectedIds)
            .map(id => allSeenPapers.get(id))
            .filter(Boolean);

        if (selectedPapers.length === 0) {
            showToast('No papers selected', 'error');
            return;
        }

        try {
            state.isFrontendBusy = true;
            updateActionBar();
            
            // Switch to workflow view
            projectSelectionSection.classList.add('hidden');
            workflowStepsSection.classList.remove('hidden');

            // 1. Start Workflow
            updateStep('session', 'active');
            const startRes = await ImportWorkflowService.startWorkflow(
                state.importSession.projectId
            );
            if (!startRes.isSuccess) throw new Error(startRes.message);
            
            state.importSession.sessionId = startRes.sessionId;
            updateStep('session', 'completed');

            // 2. RIS Upload
            updateStep('ris', 'active');
            const risContent = generateRIS(selectedPapers);
            const risBlob = new Blob([risContent], { type: 'application/x-research-info-systems' });
            
            const risRes = await ImportWorkflowService.uploadRis(state.importSession.sessionId, risBlob);
            if (!risRes.isSuccess) throw new Error(risRes.message);
            
            state.importSession.paperIds = risRes.validPaperIds;
            state.importSession.paperMappings = risRes.paperMappings || [];
            updateStep('ris', 'completed');
            showToast('RIS uploaded successfully', 'success');

            // 3. Polling Status
            updateStep('polling', 'active');
            let isReady = false;
            while (!isReady) {
                await new Promise(r => setTimeout(r, 3000)); // Poll every 3s
                const statusRes = await ImportWorkflowService.getWorkflowStatus(state.importSession.sessionId);
                
                if (!statusRes.isSuccess) throw new Error(statusRes.message);
                
                const workflow = statusRes.data;
                console.log('Workflow status:', workflow.state); // Debug log

                if (workflow.state === 'ris_completed' || workflow.state === 'completed') {
                    isReady = true;
                    state.importSession.status = workflow.state;
                    state.importSession.paperIds = workflow.validPaperIds || [];
                    state.importSession.paperMappings = workflow.paperMappings || [];
                } else if (workflow.state === 'failed') {
                    throw new Error('Import processing failed on server');
                }
            }
            updateStep('polling', 'completed');

            showToast('Import workflow completed!', 'success');

        } catch (error) {
            console.error('Import Workflow Error:', error);
            showToast(error.message, 'error');
            // Keep overlay open to show where it failed
        } finally {
            state.isFrontendBusy = false;
            updateActionBar();
        }
    });



    closeImportBtn.addEventListener('click', () => {
        resetImportUI();
    });

    // --- Auth Listeners ---


    syncAuthBtn.addEventListener('click', handleSyncAuth);

    // Initialize
    await hydrate();
});
