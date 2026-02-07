/* Shared utilities for TradingMarket Web */

async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    return resp.json();
}

function formatNumber(v, decimals = 0) {
    if (v === null || v === undefined) return '-';
    return Number(v).toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatPercent(v, decimals = 0) {
    if (v === null || v === undefined) return '-';
    return Number(v).toFixed(decimals) + '%';
}

function colorClass(v) {
    if (v === null || v === undefined) return 'text-gray';
    return v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-gray';
}

function getMomentumIndicator(change) {
    if (change === null || change === undefined) return { symbol: '', color: '' };
    if (change > 5) return { symbol: '\u25B2', color: 'text-green' };  // ▲
    if (change < -5) return { symbol: '\u25BC', color: 'text-red' };   // ▼
    if (change > 0) return { symbol: '\u2197', color: 'text-green' };  // ↗
    if (change < 0) return { symbol: '\u2198', color: 'text-red' };    // ↘
    return { symbol: '\u2192', color: 'text-gray' };                    // →
}

function slugifyIndustry(name) {
    return name.toLowerCase()
        .replace(/[/&,\-\s]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function isFundamentallyStrong(stock) {
    const { pat_gr_q1, pat_gr_q2, sales_gr_q1, sales_gr_q2 } = stock;
    if (pat_gr_q1 == null || sales_gr_q1 == null) return null;

    if (sales_gr_q1 > 35) return true;
    if (pat_gr_q1 > 70) return true;
    if (sales_gr_q1 > 20 && pat_gr_q1 > 40) return true;

    if (pat_gr_q2 != null && sales_gr_q2 != null) {
        if (sales_gr_q2 > 35) return true;
        if (pat_gr_q2 > 70) return true;
        if (sales_gr_q2 > 20 && pat_gr_q2 > 40) return true;
        if (sales_gr_q1 > 20 && sales_gr_q2 > 20) return true;
        if (pat_gr_q1 > 40 && pat_gr_q2 > 40) return true;
    }
    return false;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

/* Tooltip helper */
const tooltip = {
    el: null,
    chartInstance: null,
    init() { this.el = document.getElementById('tooltip'); },
    show(x, y, html) {
        this.el.innerHTML = html;
        this.el.classList.remove('hidden');
        // Position with boundary check
        const rect = this.el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = x + 12;
        let top = y - 8;
        if (left + rect.width > vw - 10) left = x - rect.width - 12;
        if (top + rect.height > vh - 10) top = vh - rect.height - 10;
        if (top < 10) top = 10;
        this.el.style.left = left + 'px';
        this.el.style.top = top + 'px';
    },
    hide() {
        this.el.classList.add('hidden');
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
    }
};
