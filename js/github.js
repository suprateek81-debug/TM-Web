/* TradingMarket Web - GitHub API Module for Editable Notes */

const GitHubAPI = {
    OWNER: 'suprateek81-debug',
    REPO: 'TM-Web',
    BRANCH: 'main',
    NOTES_PATH: 'data/stock_notes.json',
    TOKEN_KEY: 'github_pat',

    // Cached SHA from last successful save — avoids stale GET responses
    _lastKnownSha: null,
    _lastKnownData: null,

    // ── Token Management ──

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY) || '';
    },

    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token.trim());
    },

    clearToken() {
        localStorage.removeItem(this.TOKEN_KEY);
    },

    hasToken() {
        return !!this.getToken();
    },

    // Prompt user for token if not set. Returns true if token is available.
    ensureToken() {
        if (this.hasToken()) return true;
        const token = prompt('Enter your GitHub Personal Access Token to enable note editing:');
        if (token && token.trim()) {
            this.setToken(token.trim());
            return true;
        }
        return false;
    },

    // ── UTF-8 Safe Base64 ──

    utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    },

    base64ToUtf8(b64) {
        // GitHub returns base64 with newlines — strip them first
        return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
    },

    // ── Timestamp (matches desktop format: "YYYY-MM-DD HH:MM:SS") ──

    formatTimestamp() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
               `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    },

    // ── Core API Methods ──

    async _apiRequest(method, path, body) {
        const token = this.getToken();
        const url = `https://api.github.com/repos/${this.OWNER}/${this.REPO}/contents/${path}`;

        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        if (token) {
            headers['Authorization'] = 'token ' + token;
        }

        const opts = { method, headers };
        if (body) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }

        return fetch(url, opts);
    },

    async fetchLatestNotes(useCache) {
        // If we have a cached SHA from a recent save, use it to avoid stale GitHub API responses
        if (useCache && this._lastKnownSha && this._lastKnownData) {
            console.log('Using cached SHA:', this._lastKnownSha.substring(0, 8));
            return { data: JSON.parse(JSON.stringify(this._lastKnownData)), sha: this._lastKnownSha };
        }

        try {
            // Add cache-busting timestamp to prevent GitHub API from returning stale data
            const cacheBust = '_t=' + Date.now();
            const sep = '&';
            const resp = await this._apiRequest('GET', this.NOTES_PATH + '?ref=' + this.BRANCH + sep + cacheBust);

            if (resp.status === 404) {
                this._lastKnownSha = null;
                this._lastKnownData = {};
                return { data: {}, sha: null };
            }

            if (!resp.ok) {
                const errText = await resp.text();
                console.error('GitHub GET failed:', resp.status, errText);
                return { data: null, sha: null, error: resp.status === 401 || resp.status === 403 ? 'auth' : 'unknown' };
            }

            const json = await resp.json();
            const decoded = this.base64ToUtf8(json.content);
            const data = JSON.parse(decoded);

            // Cache for subsequent saves
            this._lastKnownSha = json.sha;
            this._lastKnownData = JSON.parse(JSON.stringify(data));

            return { data, sha: json.sha };
        } catch (e) {
            console.error('fetchLatestNotes error:', e);
            return { data: null, sha: null, error: 'network' };
        }
    },

    async saveNote(ticker, noteText, _retryCount) {
        _retryCount = _retryCount || 0;

        // 1. Fetch latest for fresh SHA + merge
        //    On first attempt, use cached SHA/data if available (faster & avoids stale API responses).
        //    On retry, force a fresh fetch from API (cache-busted).
        const useCache = (_retryCount === 0);
        const latest = await this.fetchLatestNotes(useCache);
        if (latest.error) {
            // If auth error, clear bad token so user can re-enter
            if (latest.error === 'auth') {
                this.clearToken();
            }
            return { success: false, error: latest.error };
        }

        const allNotes = latest.data || {};

        // 2. Update or remove the ticker
        const trimmed = (noteText || '').trim();
        if (trimmed) {
            allNotes[ticker] = {
                notes: trimmed,
                last_updated: this.formatTimestamp()
            };
        } else {
            delete allNotes[ticker];
        }

        // 3. Serialize (minified to match export_data.py)
        const serialized = JSON.stringify(allNotes);
        const encoded = this.utf8ToBase64(serialized);

        // 4. PUT to GitHub
        const body = {
            message: 'Update notes: ' + ticker + ' (via web)',
            content: encoded,
            branch: this.BRANCH
        };
        if (latest.sha) {
            body.sha = latest.sha;
        }

        try {
            const resp = await this._apiRequest('PUT', this.NOTES_PATH, body);

            if (resp.ok) {
                // Capture the new SHA from the response for subsequent saves
                try {
                    const result = await resp.json();
                    if (result.content && result.content.sha) {
                        this._lastKnownSha = result.content.sha;
                        this._lastKnownData = JSON.parse(JSON.stringify(allNotes));
                        console.log('Saved. New SHA:', this._lastKnownSha.substring(0, 8));
                    }
                } catch (_) {
                    // If we can't parse the response, invalidate cache so next save does a fresh fetch
                    this._lastKnownSha = null;
                    this._lastKnownData = null;
                }
                return { success: true };
            }

            if (resp.status === 409 && _retryCount < 2) {
                // SHA conflict — retry with fresh fetch (bypasses cache)
                console.warn('SHA conflict on save, retrying (' + (_retryCount + 1) + ')...');
                // Small delay to let GitHub propagate the previous commit
                await new Promise(r => setTimeout(r, 500));
                return this.saveNote(ticker, noteText, _retryCount + 1);
            }

            if (resp.status === 401 || resp.status === 403) {
                this.clearToken();
                return { success: false, error: 'auth' };
            }

            if (resp.status === 409) {
                return { success: false, error: 'conflict' };
            }

            const errText = await resp.text();
            console.error('GitHub PUT failed:', resp.status, errText);
            return { success: false, error: 'unknown' };
        } catch (e) {
            console.error('saveNote network error:', e);
            return { success: false, error: 'network' };
        }
    }
};
