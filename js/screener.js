/* TradingMarket Web - Screener Tab (Industry Stock Tables) */

const Screener = {
    index: null,
    currentData: null,
    notesData: null,
    sortColumn: 'rs_rating',
    sortDesc: true,

    COLUMNS: [
        { key: 'ticker', label: 'Stock', cls: 'td-ticker' },
        { key: 'rs_rating', label: 'RS', cls: 'td-rs', fmt: v => v != null ? v : '-' },
        { key: 'industry_rank', label: 'Rank', fmt: v => v != null ? v : '-' },
        { key: 'volume', label: 'Vol (Cr)', fmt: v => v != null ? formatNumber(v) : '-' },
        { key: 'atr_pct', label: 'ATR %', fmt: v => v != null ? v.toFixed(1) : '-' },
        'SEP',
        { key: 'market_cap', label: 'Mcap', fmt: v => v != null ? formatNumber(v) : '-' },
        { key: 'pe_ratio', label: 'PE', fmt: v => v != null ? v.toFixed(1) : '-' },
        { key: 'price_to_book', label: 'PB', fmt: v => v != null ? v.toFixed(1) : '-' },
        { key: 'roe_3yr', label: 'ROE', fmt: v => v != null ? v.toFixed(1) : '-' },
        { key: 'latest_quarter', label: 'Qtr' },
        'SEP',
        { key: 'pat_gr_q1', label: 'PAT Q1', pct: true },
        { key: 'pat_gr_q2', label: 'PAT Q2', pct: true },
        { key: 'pat_gr_q3', label: 'PAT Q3', pct: true },
        'SEP',
        { key: 'sales_gr_q1', label: 'Sales Q1', pct: true },
        { key: 'sales_gr_q2', label: 'Sales Q2', pct: true },
        { key: 'sales_gr_q3', label: 'Sales Q3', pct: true },
        'SEP',
        { key: 'ebitda_q1', label: 'EBITDA Q1', pctDec: true },
        { key: 'ebitda_q2', label: 'EBITDA Q2', pctDec: true },
        { key: 'ebitda_q3', label: 'EBITDA Q3', pctDec: true },
    ],

    async init() {
        this.index = await fetchJSON('data/screener_index.json');
        try {
            this.notesData = await fetchJSON('data/stock_notes.json');
        } catch (e) {
            this.notesData = {};
        }
        this.bindSearch();
    },

    bindSearch() {
        const input = document.getElementById('screener-search');
        const btn = document.getElementById('screener-go');
        if (!input) return;

        const doSearch = () => this.search(input.value.trim());

        if (btn) {
            btn.addEventListener('click', doSearch);
        }
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') doSearch();
        });
    },

    async search(ticker) {
        if (!ticker || !this.index) return;

        const upperTicker = ticker.toUpperCase();
        // Case-insensitive lookup
        let industryName = null;
        for (const [t, ind] of Object.entries(this.index.tickers)) {
            if (t.toUpperCase() === upperTicker) {
                industryName = ind;
                break;
            }
        }

        if (!industryName) {
            this.showStatus(`Ticker "${escapeHtml(ticker)}" not found.`, true);
            return;
        }

        const slug = slugifyIndustry(industryName);
        this.showStatus('Loading...', false);

        try {
            this.currentData = await fetchJSON(`data/screener/${slug}.json`);
            this.sortColumn = 'rs_rating';
            this.sortDesc = true;

            const label = document.getElementById('screener-industry-label');
            if (label) {
                label.textContent = `${this.currentData.industry} (Rank: ${this.currentData.rank})`;
            }

            this.renderTable();
            this.showStatus(
                `Showing ${this.currentData.stocks.length} stocks in ${this.currentData.industry}`,
                false
            );
        } catch (e) {
            console.error('Screener load failed:', e);
            this.showStatus(`Failed to load data for "${escapeHtml(industryName)}".`, true);
        }
    },

    showStatus(msg, isError) {
        const el = document.getElementById('screener-status');
        if (!el) return;
        el.innerHTML = escapeHtml(msg);
        el.className = isError ? 'screener-status error' : 'screener-status';
    },

    sortStocks() {
        if (!this.currentData || !this.currentData.stocks) return [];
        const col = this.sortColumn;
        const desc = this.sortDesc;
        return [...this.currentData.stocks].sort((a, b) => {
            let va = a[col];
            let vb = b[col];
            // Nulls go to the end
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            // String comparison for ticker and quarter
            if (typeof va === 'string' && typeof vb === 'string') {
                return desc ? vb.localeCompare(va) : va.localeCompare(vb);
            }
            return desc ? vb - va : va - vb;
        });
    },

    renderTable() {
        const container = document.getElementById('screener-table-container');
        if (!container || !this.currentData) return;

        const stocks = this.sortStocks();
        const columns = this.COLUMNS;

        // Build header
        let thead = '<tr>';
        for (const col of columns) {
            if (col === 'SEP') {
                thead += '<th class="sep-col"></th>';
                continue;
            }
            let arrow = '';
            if (this.sortColumn === col.key) {
                arrow = ' <span class="sort-arrow">' + (this.sortDesc ? '\u25BC' : '\u25B2') + '</span>';
            }
            const cls = col.cls ? ' ' + col.cls : '';
            thead += `<th class="sortable${cls}" data-sort="${col.key}">${escapeHtml(col.label)}${arrow}</th>`;
        }
        thead += '</tr>';

        // Build body
        let tbody = '';
        for (const stock of stocks) {
            const rowClass = stock.is_strong === true ? 'strong-row' : '';
            tbody += `<tr class="${rowClass}">`;
            for (const col of columns) {
                if (col === 'SEP') {
                    tbody += '<td class="sep-col"></td>';
                    continue;
                }

                const val = stock[col.key];
                let display;
                let cellClass = col.cls || '';

                if (col.pct) {
                    // Percentage with 0 decimals, colored
                    if (val != null) {
                        display = Math.round(val) + '%';
                        cellClass += ' ' + colorClass(val);
                    } else {
                        display = '-';
                    }
                } else if (col.pctDec) {
                    // Percentage with 1 decimal, normal color
                    if (val != null) {
                        display = val.toFixed(1) + '%';
                    } else {
                        display = '-';
                    }
                } else if (col.fmt) {
                    display = col.fmt(val);
                } else {
                    display = val != null ? escapeHtml(String(val)) : '-';
                }

                // Make ticker clickable for stock notes
                if (col.key === 'ticker' && val) {
                    tbody += `<td class="${cellClass} ticker-clickable" data-ticker="${escapeHtml(String(val))}">${display}</td>`;
                } else {
                    tbody += `<td class="${cellClass}">${display}</td>`;
                }
            }
            tbody += '</tr>';
        }

        container.innerHTML = `<table class="screener-table">
<thead>${thead}</thead>
<tbody>${tbody}</tbody>
</table>`;

        // Bind sort handlers
        container.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (this.sortColumn === key) {
                    this.sortDesc = !this.sortDesc;
                } else {
                    this.sortColumn = key;
                    this.sortDesc = true;
                }
                this.renderTable();
            });
        });

        // Bind ticker click handlers for notes modal
        container.querySelectorAll('.ticker-clickable').forEach(td => {
            td.addEventListener('click', () => {
                const ticker = td.getAttribute('data-ticker');
                if (ticker) this.showNotesModal(ticker);
            });
        });
    },

    showNotesModal(ticker) {
        // Remove any existing modal
        const existing = document.getElementById('notes-modal-overlay');
        if (existing) existing.remove();

        const noteInfo = this.notesData ? this.notesData[ticker] : null;

        const overlay = document.createElement('div');
        overlay.id = 'notes-modal-overlay';
        overlay.className = 'notes-modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const modal = document.createElement('div');
        modal.className = 'notes-modal';

        const header = document.createElement('div');
        header.className = 'notes-modal-header';
        header.innerHTML = `
            <span class="notes-modal-ticker">${escapeHtml(ticker)}</span>
            <span class="notes-modal-subtitle">Stock Notes</span>
            <button class="notes-modal-close">&times;</button>
        `;
        header.querySelector('.notes-modal-close').addEventListener('click', () => overlay.remove());

        const body = document.createElement('div');
        body.className = 'notes-modal-body';

        if (noteInfo && noteInfo.notes) {
            body.innerHTML = `<div class="notes-content">${escapeHtml(noteInfo.notes).replace(/\n/g, '<br>')}</div>`;
            if (noteInfo.last_updated) {
                body.innerHTML += `<div class="notes-meta">Last updated: ${escapeHtml(noteInfo.last_updated)}</div>`;
            }
        } else {
            body.innerHTML = '<div class="notes-empty">No notes for this stock.</div>';
        }

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
};
