/* TradingMarket Web - Main App Controller */

const App = {
    loaded: { dashboard: false, industries: false, stocks: false, screener: false },
    currentTab: 'dashboard',

    async init() {
        tooltip.init();
        this.setupTabs();
        await this.loadMetadata();
        // Load first tab
        Dashboard.init();
        this.loaded.dashboard = true;
    },

    setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
    },

    switchTab(tabId) {
        if (this.currentTab === tabId) return;
        this.currentTab = tabId;

        // Update buttons
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');

        // Update panels
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('tab-' + tabId).classList.add('active');

        // Lazy load
        if (!this.loaded[tabId]) {
            this.loaded[tabId] = true;
            switch (tabId) {
                case 'dashboard': Dashboard.init(); break;
                case 'industries': Industries.init(); break;
                case 'stocks': Stocks.init(); break;
                case 'screener': Screener.init(); break;
            }
        }
    },

    async loadMetadata() {
        try {
            const meta = await fetchJSON('data/metadata.json');
            document.getElementById('total-stocks').textContent = `Stocks: ${meta.total_stocks || '--'}`;
            document.getElementById('last-refresh').textContent = `Last Refresh: ${meta.last_refresh || '--'}`;
            document.getElementById('data-as-of').textContent = `Data as of: ${meta.data_as_of || '--'}`;
        } catch (e) {
            console.error('Failed to load metadata:', e);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
