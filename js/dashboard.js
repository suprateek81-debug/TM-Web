/* TradingMarket Web - Dashboard (4 Chart.js charts) */

const Dashboard = {
    data: null,
    charts: [],
    selectedDays: 250,

    async init() {
        try {
            this.data = await fetchJSON('data/market_data.json');
            this.setupDaysSelector();
            this.render();
        } catch (err) {
            console.error('Dashboard init failed:', err);
        }
    },

    setupDaysSelector() {
        document.querySelectorAll('.days-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.days-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Dashboard.selectedDays = parseInt(btn.dataset.days) || 0;
                Dashboard.render();
            });
        });
    },

    getSlicedData() {
        const d = this.data;
        const total = d.dates.length;
        const n = this.selectedDays > 0 ? Math.min(this.selectedDays, total) : total;
        const startIdx = total - n;

        const sliceDates = d.dates.slice(startIdx);
        const sliceTB = d.trend_breath.slice(startIdx);
        const sliceRSI = d.rsi.slice(startIdx);
        const sliceMS = d.market_strength.slice(startIdx);
        const sliceSMA5 = d.ms_sma5.slice(startIdx);
        const sliceSMA20 = d.ms_sma20.slice(startIdx);
        const sliceNNHL = d.nnhl.slice(startIdx);
        const sliceBullish = d.is_bullish.slice(startIdx);

        // Remap flip indices to the sliced range
        const bullFlips = (d.bull_flips || [])
            .map(i => i - startIdx)
            .filter(i => i >= 0 && i < n);
        const bearFlips = (d.bear_flips || [])
            .map(i => i - startIdx)
            .filter(i => i >= 0 && i < n);

        return {
            dates: sliceDates,
            trend_breath: sliceTB,
            rsi: sliceRSI,
            market_strength: sliceMS,
            ms_sma5: sliceSMA5,
            ms_sma20: sliceSMA20,
            nnhl: sliceNNHL,
            is_bullish: sliceBullish,
            bull_flips: bullFlips,
            bear_flips: bearFlips,
            startIdx: startIdx
        };
    },

    formatDate(dateStr) {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const yy = String(d.getFullYear()).slice(2);
        return months[d.getMonth()] + ' ' + yy;
    },

    formatFullDate(dateStr) {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dd = String(d.getDate()).padStart(2, '0');
        return dd + '-' + months[d.getMonth()] + '-' + d.getFullYear();
    },

    commonScales(labels) {
        return {
            x: {
                ticks: {
                    maxTicksLimit: 8,
                    autoSkip: true,
                    maxRotation: 0,
                    font: { size: 11 }
                },
                grid: {
                    display: false
                }
            },
            y: {
                ticks: {
                    font: { size: 11 }
                },
                grid: {
                    color: 'rgba(200, 200, 200, 0.3)'
                }
            }
        };
    },

    commonPlugins() {
        const self = this;
        return {
            legend: {
                display: false
            },
            tooltip: {
                enabled: true,
                mode: 'index',
                intersect: false,
                filter(tooltipItem) {
                    // Hide tooltip entries for marker-only datasets (triangles)
                    return !tooltipItem.dataset._hideFromTooltip;
                },
                callbacks: {
                    title(tooltipItems) {
                        if (tooltipItems.length > 0 && self._rawDates) {
                            const idx = tooltipItems[0].dataIndex;
                            return self.formatFullDate(self._rawDates[idx]);
                        }
                        return '';
                    }
                }
            }
        };
    },

    destroyCharts() {
        this.charts.forEach(c => {
            if (c && typeof c.destroy === 'function') {
                c.destroy();
            }
        });
        this.charts = [];
    },

    render() {
        if (!this.data) return;

        this.destroyCharts();

        const sd = this.getSlicedData();
        const labels = sd.dates.map(d => this.formatDate(d));
        // Store raw dates for full-date tooltips
        this._rawDates = sd.dates;

        this.updateTitle(sd);
        this.charts.push(this.renderTrendBreath(labels, sd));
        this.charts.push(this.renderMSSma5(labels, sd));
        this.charts.push(this.renderNNHL(labels, sd));
        this.charts.push(this.renderMSSma20(labels, sd));
    },

    updateTitle(sd) {
        const cv = this.data.current_values;

        // Trend Breath title
        const titleTB = document.getElementById('chart-title-tb');
        if (titleTB) {
            const tb = cv.trend_breath;
            let subtitle = '';
            if (cv.is_bullish) {
                subtitle = '(RSI: ' + cv.rsi + ')';
            } else {
                subtitle = '(Bull Flip > ' + cv.bull_flip_value + ')';
            }
            titleTB.textContent = 'Trend Breath: ' + tb + ' ' + subtitle;
        }

        // Market Strength (5 SMA) title
        const titleMS5 = document.getElementById('chart-title-ms5');
        if (titleMS5) {
            titleMS5.textContent = 'Market Strength (5 SMA): ' + cv.ms_sma5;
        }

        // NNHL title
        const titleNNHL = document.getElementById('chart-title-nnhl');
        if (titleNNHL) {
            titleNNHL.textContent = 'NNHL: ' + cv.nnhl;
        }

        // Market Strength (20 SMA) title
        const titleMS20 = document.getElementById('chart-title-ms20');
        if (titleMS20) {
            titleMS20.textContent = 'Market Strength (20 SMA): ' + cv.ms_sma20;
        }
    },

    buildBullishAnnotations(sd) {
        // Build box annotations for contiguous bullish regions
        const annotations = {};
        let inBullish = false;
        let startI = 0;

        for (let i = 0; i <= sd.is_bullish.length; i++) {
            const bull = i < sd.is_bullish.length ? sd.is_bullish[i] : false;
            if (bull && !inBullish) {
                inBullish = true;
                startI = i;
            } else if (!bull && inBullish) {
                inBullish = false;
                annotations['bullRegion' + startI] = {
                    type: 'box',
                    xMin: startI,
                    xMax: i - 1,
                    backgroundColor: 'rgba(30, 142, 62, 0.1)',
                    borderWidth: 0,
                    drawTime: 'beforeDatasetsDraw'
                };
            }
        }
        return annotations;
    },

    renderTrendBreath(labels, sd) {
        const ctx = document.getElementById('chart-trend-breath');
        if (!ctx) return null;

        // Build null-padded arrays for bull/bear flip markers
        // Offset triangles so they don't overlap the line:
        //   green (bull) triangles appear BELOW the line
        //   red (bear) triangles appear ABOVE the line
        const n = labels.length;
        const yValues = sd.trend_breath;
        const yMin = Math.min(...yValues.filter(v => v != null));
        const yMax = Math.max(...yValues.filter(v => v != null));
        const offset = (yMax - yMin) * 0.06; // 6% of range

        const bullData = new Array(n).fill(null);
        const bearData = new Array(n).fill(null);
        sd.bull_flips.forEach(i => { if (i >= 0 && i < n) bullData[i] = sd.trend_breath[i] - offset; });
        sd.bear_flips.forEach(i => { if (i >= 0 && i < n) bearData[i] = sd.trend_breath[i] + offset; });

        const bullishAnnotations = this.buildBullishAnnotations(sd);

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Trend Breath',
                        data: sd.trend_breath,
                        borderColor: '#1a73e8',
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0,
                        order: 2
                    },
                    {
                        label: 'RSI (7)',
                        data: sd.rsi,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        showLine: false,
                        order: 3
                    },
                    {
                        data: bullData,
                        borderColor: 'transparent',
                        backgroundColor: '#1e8e3e',
                        pointStyle: 'triangle',
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        showLine: false,
                        spanGaps: false,
                        order: 1,
                        _hideFromTooltip: true
                    },
                    {
                        data: bearData,
                        borderColor: 'transparent',
                        backgroundColor: '#d93025',
                        pointStyle: 'triangle',
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        pointRotation: 180,
                        showLine: false,
                        spanGaps: false,
                        order: 1,
                        _hideFromTooltip: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: this.commonScales(labels),
                plugins: {
                    ...this.commonPlugins(),
                    annotation: {
                        annotations: bullishAnnotations
                    }
                }
            }
        });
    },

    greenRedBars(values) {
        return values.map(v => v >= 0 ? 'rgba(30, 142, 62, 0.8)' : 'rgba(217, 48, 37, 0.8)');
    },

    renderMSSma5(labels, sd) {
        const ctx = document.getElementById('chart-ms-sma5');
        if (!ctx) return null;

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: sd.ms_sma5,
                    backgroundColor: this.greenRedBars(sd.ms_sma5),
                    borderWidth: 0,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: this.commonScales(labels),
                plugins: {
                    ...this.commonPlugins(),
                    annotation: {
                        annotations: {
                            line25: {
                                type: 'line',
                                yMin: -25,
                                yMax: -25,
                                borderColor: '#f4b400',
                                borderWidth: 1.5,
                                borderDash: [6, 4],
                                drawTime: 'afterDatasetsDraw'
                            }
                        }
                    }
                }
            }
        });
    },

    renderNNHL(labels, sd) {
        const ctx = document.getElementById('chart-nnhl');
        if (!ctx) return null;

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: sd.nnhl,
                    backgroundColor: this.greenRedBars(sd.nnhl),
                    borderWidth: 0,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: this.commonScales(labels),
                plugins: {
                    ...this.commonPlugins(),
                    annotation: {
                        annotations: {
                            line20: {
                                type: 'line',
                                yMin: -20,
                                yMax: -20,
                                borderColor: '#f4b400',
                                borderWidth: 1.5,
                                borderDash: [6, 4],
                                drawTime: 'afterDatasetsDraw'
                            },
                            line25: {
                                type: 'line',
                                yMin: -25,
                                yMax: -25,
                                borderColor: '#f4b400',
                                borderWidth: 1.5,
                                borderDash: [6, 4],
                                drawTime: 'afterDatasetsDraw'
                            }
                        }
                    }
                }
            }
        });
    },

    renderMSSma20(labels, sd) {
        const ctx = document.getElementById('chart-ms-sma20');
        if (!ctx) return null;

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: sd.ms_sma20,
                    backgroundColor: this.greenRedBars(sd.ms_sma20),
                    borderWidth: 0,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: this.commonScales(labels),
                plugins: {
                    ...this.commonPlugins(),
                    annotation: {
                        annotations: {
                            line18: {
                                type: 'line',
                                yMin: -18,
                                yMax: -18,
                                borderColor: '#f4b400',
                                borderWidth: 1.5,
                                borderDash: [6, 4],
                                drawTime: 'afterDatasetsDraw'
                            }
                        }
                    }
                }
            }
        });
    }
};
