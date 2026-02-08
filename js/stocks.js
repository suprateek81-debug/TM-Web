/* TradingMarket Web - Stocks Tab (Top 100 & Momentum Views) */

const Stocks = {
    currentView: 'top100',
    top100Data: null,
    momentumData: null,

    async init() {
        const [top100, momentum] = await Promise.all([
            fetchJSON('data/stocks_top100.json'),
            fetchJSON('data/stocks_momentum.json')
        ]);
        this.top100Data = top100;
        this.momentumData = momentum;

        this.bindViewToggle();
        this.render();
    },

    bindViewToggle() {
        const tab = document.getElementById('tab-stocks');
        if (!tab) return;
        tab.querySelectorAll('.view-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                if (view === this.currentView) return;
                this.currentView = view;
                tab.querySelectorAll('.view-btn[data-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.render();
            });
        });
    },

    render() {
        this.renderSummary();
        this.renderGrid();
    },

    renderSummary() {
        const el = document.getElementById('stocks-summary');
        if (!el) return;
        if (this.currentView === 'top100') {
            el.textContent = 'Top 100 Stocks by ATR-Adjusted Return | Filters: Vol > 10 Cr, ATR > 2.5%';
        } else {
            el.textContent = 'Top 50 Stocks Gaining RS Momentum | Filters: Vol > 10 Cr, ATR > 2.5%';
        }
    },

    renderGrid() {
        const grid = document.getElementById('stocks-grid');
        if (!grid) return;

        const data = this.currentView === 'top100' ? this.top100Data : this.momentumData;
        if (!data || !data.stocks) {
            grid.innerHTML = '';
            return;
        }

        const stocks = data.stocks;
        const cols = 5;
        const rows = Math.ceil(stocks.length / cols);

        grid.className = 'card-grid cols-5';
        grid.style.gridTemplateRows = `repeat(${rows}, auto)`;

        grid.innerHTML = stocks.map(stock => this.renderCard(stock)).join('');
    },

    renderCard(stock) {
        const industry = escapeHtml(truncate(stock.industry, 18));
        const ticker = escapeHtml(stock.ticker);
        const industryRank = stock.industry_rank;
        const rsRating = stock.rs_rating;

        let metricValue;
        let metricColor;

        if (this.currentView === 'top100') {
            const atr = stock.atr_adj_return;
            metricValue = atr != null ? atr.toFixed(1) : '-';
            metricColor = colorClass(atr);
        } else {
            const change = stock.rs_change;
            if (change != null) {
                metricValue = (change > 0 ? '+' : '') + change;
            } else {
                metricValue = '-';
            }
            metricColor = colorClass(change);
        }

        return `<div class="card stock-card">
    <div class="card-top">
        <span class="card-rank">${stock.rank}</span>
        <span class="card-name">${ticker}</span>
    </div>
    <div class="card-bottom">
        <span class="card-detail">${industry} (${industryRank})</span>
        <span class="card-rs">RS: ${rsRating}</span>
        <span class="card-momentum ${metricColor}">${metricValue}</span>
    </div>
</div>`;
    }
};
