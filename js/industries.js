/* TradingMarket Web - Industries Tab (Card Grid + Tooltips) */

const Industries = {
    data: null,
    currentView: 'leading',
    selectedIndustries: new Set(),

    async init() {
        this.data = await fetchJSON('data/industries.json');
        if (!this.data) return;

        this.selectedIndustries = new Set(
            this.data.industries
                .filter(ind => ind.name !== 'Other Industries')
                .sort((a, b) => a.rank - b.rank)
                .slice(0, 25)
                .map(ind => ind.name)
        );

        this.renderSummary();
        this.renderGrid();
        this.bindViewToggle();
        this.bindSearch();
    },

    renderSummary() {
        const el = document.getElementById('industries-summary');
        if (!el || !this.data.summary) return;
        const s = this.data.summary;
        el.innerHTML =
            `Industries by Rank | Total: ${s.total} | Gaining: ${s.gainers} | Stable: ${s.stable} | Losing: ${s.losers}`;
    },

    getSortedIndustries() {
        const industries = [...this.data.industries];
        const others = [];
        const regular = [];

        for (const ind of industries) {
            if (ind.name === 'Other Industries') {
                others.push(ind);
            } else {
                regular.push(ind);
            }
        }

        if (this.currentView === 'leading') {
            regular.sort((a, b) => a.rank - b.rank);
        } else {
            regular.sort((a, b) => {
                const aVal = a.momentum_change;
                const bVal = b.momentum_change;
                if (aVal == null && bVal == null) return 0;
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                return bVal - aVal;
            });
        }

        return [...regular, ...others];
    },

    renderGrid() {
        const grid = document.getElementById('industries-grid');
        if (!grid) return;

        const sorted = this.getSortedIndustries();
        const rows = Math.ceil(sorted.length / 4);
        grid.style.gridTemplateRows = `repeat(${rows}, auto)`;
        grid.style.gridAutoFlow = 'column';

        grid.innerHTML = sorted.map(ind => {
            const momentum = getMomentumIndicator(ind.momentum_change);
            const selected = this.selectedIndustries.has(ind.name) ? ' selected' : '';
            const escapedName = escapeHtml(ind.name);
            const scoreDisplay = ind.score != null ? ind.score.toFixed(2) : '-';

            return `<div class="card industry-card${selected}" data-industry="${escapedName}">` +
                `<div class="card-top">` +
                    `<span class="card-rank">${ind.rank}</span>` +
                    `<span class="card-name">${escapedName}</span>` +
                `</div>` +
                `<div class="card-bottom">` +
                    `<span class="card-stock-count">${ind.stock_count} stocks</span>` +
                    `<span class="card-score">Score: ${scoreDisplay}</span>` +
                    `<span class="card-momentum ${momentum.color}">${momentum.symbol} (${ind.momentum_change != null ? ind.momentum_change : '-'})</span>` +
                `</div>` +
                `</div>`;
        }).join('');

        this.bindCardEvents(grid);
    },

    bindCardEvents(grid) {
        grid.addEventListener('click', (e) => {
            const card = e.target.closest('.card');
            if (!card) return;
            const name = card.dataset.industry;
            if (this.selectedIndustries.has(name)) {
                this.selectedIndustries.delete(name);
                card.classList.remove('selected');
            } else {
                this.selectedIndustries.add(name);
                card.classList.add('selected');
            }
        });

        grid.addEventListener('mouseenter', (e) => {
            if (e.target.classList.contains('card-name')) {
                this.showStocksTooltip(e);
            } else if (e.target.classList.contains('card-rank')) {
                this.showRankChartTooltip(e);
            }
        }, true);

        grid.addEventListener('mouseleave', (e) => {
            if (e.target.classList.contains('card-name') || e.target.classList.contains('card-rank')) {
                tooltip.hide();
            }
        }, true);
    },

    showStocksTooltip(e) {
        const card = e.target.closest('.card');
        if (!card) return;
        const name = card.dataset.industry;
        const ind = this.data.industries.find(i => i.name === name);
        if (!ind || !ind.top_stocks || ind.top_stocks.length === 0) return;

        const rows = ind.top_stocks.map(s =>
            `<div class="tooltip-row"><span class="tooltip-ticker">${escapeHtml(s.ticker)}</span><span class="tooltip-rs">RS: ${s.rs}</span></div>`
        ).join('');

        const html = `<div class="tooltip-title">Top Stocks in ${escapeHtml(ind.name)}</div>${rows}`;

        const rect = e.target.getBoundingClientRect();
        tooltip.show(rect.left + rect.width / 2, rect.top, html);
    },

    showRankChartTooltip(e) {
        const card = e.target.closest('.card');
        if (!card) return;
        const name = card.dataset.industry;
        const ind = this.data.industries.find(i => i.name === name);
        if (!ind || !ind.rank_history) return;

        const html = '<canvas id="tooltip-rank-chart" width="320" height="160"></canvas>';
        const rect = e.target.getBoundingClientRect();
        tooltip.show(rect.left + rect.width / 2, rect.top, html);

        const canvas = document.getElementById('tooltip-rank-chart');
        if (!canvas) return;

        if (tooltip.chartInstance) {
            tooltip.chartInstance.destroy();
            tooltip.chartInstance = null;
        }

        tooltip.chartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: ind.rank_history.dates,
                datasets: [{
                    data: ind.rank_history.ranks,
                    borderColor: '#4a90d9',
                    backgroundColor: 'rgba(74, 144, 217, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    y: {
                        reverse: true,
                        title: {
                            display: true,
                            text: 'Rank',
                            font: { size: 10 }
                        },
                        ticks: { font: { size: 9 } },
                        grid: { color: 'rgba(200,200,200,0.3)' }
                    },
                    x: {
                        ticks: {
                            maxTicksLimit: 5,
                            font: { size: 9 },
                            maxRotation: 0
                        },
                        grid: { display: false }
                    }
                }
            }
        });
    },

    bindViewToggle() {
        const tab = document.getElementById('tab-industries');
        if (!tab) return;

        const buttons = tab.querySelectorAll('.view-btn[data-view]');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = btn.dataset.view;
                this.renderGrid();
            });
        });
    },

    bindSearch() {
        const input = document.getElementById('industry-search');
        const result = document.getElementById('industry-search-result');
        if (!input) return;

        const handler = debounce(() => {
            const query = input.value.trim().toLowerCase();
            if (!query) {
                if (result) result.textContent = '';
                return;
            }

            const ind = this.data.industries.find(i =>
                i.name.toLowerCase().includes(query)
            );

            if (ind) {
                if (result) result.textContent = `Found: ${ind.name} (Rank ${ind.rank})`;

                const grid = document.getElementById('industries-grid');
                if (grid) {
                    const card = grid.querySelector(`.card[data-industry="${CSS.escape(ind.name)}"]`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('flash');
                        setTimeout(() => card.classList.remove('flash'), 1500);
                    }
                }
            } else {
                if (result) result.textContent = 'No match';
            }
        }, 300);

        input.addEventListener('input', handler);
    }
};
