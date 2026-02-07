#!/usr/bin/env python3
"""
Export TradingMarket SQLite data to static JSON files for the web app.
Reads from the existing database and CSVs (read-only). Re-runnable.

Usage:
    python3 export_data.py
"""

import sqlite3
import json
import os
import re
from datetime import datetime

import pandas as pd

# Paths - relative to the desktop app
APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Market Analysis')
DB_PATH = os.path.join(APP_DIR, 'trading_market.db')
INDIA_MM_CSV = os.path.join(APP_DIR, 'India_MM.csv')
STOCK_LIST_CSV = os.path.join(APP_DIR, 'Stock_list.csv')

# Output directory
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
SCREENER_DIR = os.path.join(OUTPUT_DIR, 'screener')


def slugify(name):
    """Convert industry name to a filename-safe slug."""
    s = name.lower()
    s = re.sub(r'[/&,\-\s]+', '_', s)
    s = re.sub(r'_+', '_', s).strip('_')
    return s


def write_json(filepath, data):
    """Write data to JSON file with compact formatting."""
    with open(filepath, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    size = os.path.getsize(filepath)
    print(f"  Written: {os.path.basename(filepath)} ({size:,} bytes)")


# ============================================================================
# RSI / Market Dashboard Calculations
# ============================================================================

def calculate_rsi_components(series, period=7):
    """Calculate RSI and its components using EMA (Wilder smoothing)."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi, avg_gain, avg_loss


def calculate_bull_flip_value(series, rsi_period=7):
    """Calculate the Trend_Breath value needed for RSI to cross above 50."""
    if len(series) < rsi_period + 1:
        return None
    _, avg_gain, avg_loss = calculate_rsi_components(series, rsi_period)
    current_value = series.iloc[-1]
    last_ag = avg_gain.iloc[-1]
    last_al = avg_loss.iloc[-1]
    needed_gain = (last_al - last_ag) * (rsi_period - 1)
    target_price = current_value + max(0, needed_gain)
    return round(target_price, 2)


def export_market_data():
    """Export India_MM.csv data with computed RSI/SMA/bull-bear phases."""
    print("Exporting market_data.json...")
    if not os.path.exists(INDIA_MM_CSV):
        print(f"  WARNING: {INDIA_MM_CSV} not found, skipping.")
        return

    df = pd.read_csv(INDIA_MM_CSV)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    df = df.dropna(subset=['Trend_Breath', 'Market_Strength', 'NNHL'])

    # Compute RSI(7) on Trend_Breath
    rsi, _, _ = calculate_rsi_components(df['Trend_Breath'], period=7)
    df['RSI'] = rsi

    # Compute SMA(5) and SMA(20) of Market_Strength
    df['MS_SMA5'] = df['Market_Strength'].rolling(window=5).mean()
    df['MS_SMA20'] = df['Market_Strength'].rolling(window=20).mean()

    # Determine bull/bear phases
    df['is_bullish'] = (df['RSI'] >= 50) | (df['Trend_Breath'] >= 75)

    # Track flip transitions
    bull_flips = []
    bear_flips = []
    for i in range(1, len(df)):
        was_bullish = df['is_bullish'].iloc[i-1] if i > 0 else False
        is_bullish = df['is_bullish'].iloc[i]
        if not was_bullish and is_bullish:
            bull_flips.append(i)
        elif was_bullish and not is_bullish:
            bear_flips.append(i)

    # Bull flip value (only relevant when currently bearish)
    bull_flip_val = None
    if len(df) > 0 and not df['is_bullish'].iloc[-1]:
        bull_flip_val = calculate_bull_flip_value(df['Trend_Breath'])

    # Build output
    dates = df['Date'].dt.strftime('%Y-%m-%d').tolist()

    def safe_list(series):
        return [round(v, 2) if pd.notna(v) else None for v in series]

    result = {
        'dates': dates,
        'trend_breath': safe_list(df['Trend_Breath']),
        'rsi': safe_list(df['RSI']),
        'market_strength': safe_list(df['Market_Strength']),
        'ms_sma5': safe_list(df['MS_SMA5']),
        'ms_sma20': safe_list(df['MS_SMA20']),
        'nnhl': safe_list(df['NNHL']),
        'is_bullish': df['is_bullish'].tolist(),
        'bull_flips': bull_flips,
        'bear_flips': bear_flips,
        'current_values': {
            'trend_breath': round(df['Trend_Breath'].iloc[-1], 2) if len(df) > 0 else None,
            'rsi': round(df['RSI'].iloc[-1], 2) if len(df) > 0 and pd.notna(df['RSI'].iloc[-1]) else None,
            'ms_sma5': round(df['MS_SMA5'].iloc[-1], 2) if len(df) > 0 and pd.notna(df['MS_SMA5'].iloc[-1]) else None,
            'ms_sma20': round(df['MS_SMA20'].iloc[-1], 2) if len(df) > 0 and pd.notna(df['MS_SMA20'].iloc[-1]) else None,
            'nnhl': round(df['NNHL'].iloc[-1], 2) if len(df) > 0 else None,
            'is_bullish': bool(df['is_bullish'].iloc[-1]) if len(df) > 0 else False,
            'bull_flip_value': bull_flip_val,
        }
    }

    write_json(os.path.join(OUTPUT_DIR, 'market_data.json'), result)


# ============================================================================
# Industries Export
# ============================================================================

def export_industries(conn):
    """Export industry rankings with momentum, top stocks, and rank history."""
    print("Exporting industries.json...")
    cursor = conn.cursor()

    # Get latest date
    cursor.execute('SELECT MAX(date) FROM industry_rankings')
    latest_date = cursor.fetchone()[0]
    if not latest_date:
        print("  No industry ranking data found.")
        return

    # Get all dates descending
    cursor.execute('SELECT DISTINCT date FROM industry_rankings ORDER BY date DESC')
    all_dates = [r[0] for r in cursor.fetchall()]

    # 45 trading days ago
    target_date = all_dates[45] if len(all_dates) > 45 else all_dates[-1]

    # Current rankings
    cursor.execute('''
        SELECT industry, rank, score, stock_count
        FROM industry_rankings WHERE date = ?
    ''', (latest_date,))
    current = {r[0]: {'rank': r[1], 'score': round(r[2], 4) if r[2] else 0, 'count': r[3]} for r in cursor.fetchall()}

    # Historical rankings
    cursor.execute('SELECT MAX(date) FROM industry_rankings WHERE date <= ?', (target_date,))
    hist_date = cursor.fetchone()[0]
    historical = {}
    if hist_date:
        cursor.execute('SELECT industry, rank FROM industry_rankings WHERE date = ?', (hist_date,))
        historical = {r[0]: r[1] for r in cursor.fetchall()}

    # Get latest metrics date for top stocks query
    cursor.execute('SELECT MAX(date) FROM stock_metrics')
    metrics_date = cursor.fetchone()[0]

    industries = []
    gainers = losers = stable = 0

    for industry, data in current.items():
        rank = data['rank']
        score = data['score']
        count = data['count']

        # Momentum
        rank_45d = historical.get(industry)
        if industry == "Other Industries":
            momentum = 0
            rank_45d = None
        elif rank_45d is not None and rank_45d != 0:
            momentum = rank_45d - rank
        else:
            momentum = None

        if momentum is not None:
            if momentum > 0:
                gainers += 1
            elif momentum < 0:
                losers += 1
            else:
                stable += 1
        else:
            stable += 1

        # Top 5 stocks by RS
        top_stocks = []
        if metrics_date:
            cursor.execute('''
                SELECT s.ticker, m.rs_rating
                FROM stocks s JOIN stock_metrics m ON s.ticker = m.ticker
                WHERE s.industry = ? AND m.date = ? AND m.rs_rating IS NOT NULL
                ORDER BY m.rs_rating DESC LIMIT 5
            ''', (industry, metrics_date))
            top_stocks = [{'ticker': r[0], 'rs': r[1]} for r in cursor.fetchall()]

        # 90-day rank history
        cursor.execute('''
            SELECT date, rank FROM industry_rankings
            WHERE industry = ? ORDER BY date DESC LIMIT 90
        ''', (industry,))
        hist_rows = cursor.fetchall()
        hist_rows.reverse()
        rank_history = {
            'dates': [r[0] for r in hist_rows],
            'ranks': [r[1] for r in hist_rows]
        }

        industries.append({
            'name': industry,
            'rank': rank,
            'score': score,
            'stock_count': count,
            'rank_45d_ago': rank_45d,
            'momentum_change': momentum,
            'top_stocks': top_stocks,
            'rank_history': rank_history,
        })

    # Sort: by rank, Other Industries at end
    industries.sort(key=lambda x: (x['name'] == 'Other Industries', x['rank']))

    result = {
        'as_of_date': latest_date,
        'industries': industries,
        'summary': {
            'total': len(industries),
            'gainers': gainers,
            'losers': losers,
            'stable': stable,
        }
    }

    write_json(os.path.join(OUTPUT_DIR, 'industries.json'), result)


# ============================================================================
# Top Stocks Export
# ============================================================================

def export_top_stocks(conn):
    """Export top 100 stocks by ATR-adjusted return."""
    print("Exporting stocks_top100.json...")
    cursor = conn.cursor()

    cursor.execute('SELECT MAX(date) FROM stock_metrics')
    latest_date = cursor.fetchone()[0]
    if not latest_date:
        return

    # Industry ranks
    cursor.execute('SELECT industry, rank FROM industry_rankings WHERE date = ?', (latest_date,))
    ind_ranks = {r[0]: r[1] for r in cursor.fetchall()}

    # All stocks with metrics
    cursor.execute('''
        SELECT s.ticker, s.industry, m.rs_rating, m.atr_adjusted_return,
               m.avg_volume_20d, m.atr_70d,
               (SELECT close FROM daily_price_data WHERE ticker = s.ticker ORDER BY date DESC LIMIT 1)
        FROM stocks s JOIN stock_metrics m ON s.ticker = m.ticker
        WHERE m.date = ?
        AND m.rs_rating IS NOT NULL AND m.atr_adjusted_return IS NOT NULL
        AND m.avg_volume_20d IS NOT NULL AND m.atr_70d IS NOT NULL
    ''', (latest_date,))

    filtered = []
    for ticker, industry, rs, atr_ret, avg_vol, atr_70d, last_close in cursor.fetchall():
        if avg_vol is None or avg_vol < 10:
            continue
        if last_close is None or last_close == 0 or atr_70d is None:
            continue
        atr_pct = (atr_70d / last_close) * 100
        if atr_pct < 2.5:
            continue
        filtered.append({
            'ticker': ticker,
            'industry': industry,
            'industry_rank': ind_ranks.get(industry, 0),
            'rs_rating': rs,
            'atr_adj_return': round(atr_ret, 2),
        })

    filtered.sort(key=lambda x: x['atr_adj_return'], reverse=True)
    stocks = filtered[:100]
    for i, s in enumerate(stocks):
        s['rank'] = i + 1

    write_json(os.path.join(OUTPUT_DIR, 'stocks_top100.json'), {
        'as_of_date': latest_date,
        'stocks': stocks,
    })


def export_momentum_stocks(conn):
    """Export top 25 stocks by RS momentum."""
    print("Exporting stocks_momentum.json...")
    cursor = conn.cursor()

    cursor.execute('SELECT MAX(date) FROM stock_metrics')
    latest_date = cursor.fetchone()[0]
    if not latest_date:
        return

    # All dates descending
    cursor.execute('SELECT DISTINCT date FROM stock_metrics ORDER BY date DESC')
    all_dates = [r[0] for r in cursor.fetchall()]
    hist_date = all_dates[45] if len(all_dates) > 45 else all_dates[-1]

    # Industry ranks
    cursor.execute('SELECT industry, rank FROM industry_rankings WHERE date = ?', (latest_date,))
    ind_ranks = {r[0]: r[1] for r in cursor.fetchall()}

    # Current metrics
    cursor.execute('''
        SELECT s.ticker, s.industry, m.rs_rating, m.avg_volume_20d, m.atr_70d,
               (SELECT close FROM daily_price_data WHERE ticker = s.ticker ORDER BY date DESC LIMIT 1)
        FROM stocks s JOIN stock_metrics m ON s.ticker = m.ticker
        WHERE m.date = ? AND m.rs_rating IS NOT NULL AND m.avg_volume_20d IS NOT NULL
    ''', (latest_date,))
    current = {r[0]: r for r in cursor.fetchall()}

    # Historical RS ratings
    cursor.execute('SELECT ticker, rs_rating FROM stock_metrics WHERE date = ? AND rs_rating IS NOT NULL', (hist_date,))
    hist_rs = {r[0]: r[1] for r in cursor.fetchall()}

    filtered = []
    for ticker, (_, industry, rs, avg_vol, atr_70d, last_close) in current.items():
        if avg_vol is None or avg_vol < 10:
            continue
        if last_close is None or last_close == 0 or atr_70d is None:
            continue
        atr_pct = (atr_70d / last_close) * 100
        if atr_pct < 2.5:
            continue
        old_rs = hist_rs.get(ticker)
        rs_change = rs - old_rs if old_rs is not None else None
        filtered.append({
            'ticker': ticker,
            'industry': industry,
            'industry_rank': ind_ranks.get(industry, 0),
            'rs_rating': rs,
            'rs_change': rs_change,
        })

    filtered.sort(key=lambda x: x['rs_change'] if x['rs_change'] is not None else -999, reverse=True)
    stocks = filtered[:25]
    for i, s in enumerate(stocks):
        s['rank'] = i + 1

    write_json(os.path.join(OUTPUT_DIR, 'stocks_momentum.json'), {
        'as_of_date': latest_date,
        'stocks': stocks,
    })


# ============================================================================
# Screener Export
# ============================================================================

MONTH_MAP = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
             'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}


def parse_quarter_to_date(quarter_str):
    """Parse quarter string like 'Dec 2024' to a datetime for sorting."""
    try:
        parts = quarter_str.strip().split()
        if len(parts) == 2:
            month = MONTH_MAP.get(parts[0][:3], 1)
            year = int(parts[1])
            return datetime(year, month, 1)
    except:
        pass
    return datetime(1900, 1, 1)


def get_yoy_quarter(quarter_str):
    """Get the quarter string for the same quarter one year ago."""
    try:
        parts = quarter_str.strip().split()
        if len(parts) == 2:
            return f"{parts[0]} {int(parts[1]) - 1}"
    except:
        pass
    return None


def calc_yoy(current, yoy, field):
    """Calculate YOY growth percentage."""
    if current is None or yoy is None:
        return None
    cur_val = current.get(field)
    yoy_val = yoy.get(field)
    if cur_val is None or yoy_val is None or yoy_val == 0:
        return None
    return round(((cur_val - yoy_val) / abs(yoy_val)) * 100, 1)


def calc_ebitda(q):
    """Calculate EBITDA margin for a quarter."""
    if q is None:
        return None
    op = q.get('operating_profit')
    dep = q.get('depreciation')
    sales = q.get('sales')
    if op is not None and dep is not None and sales and sales != 0:
        return round(((op + dep) / sales) * 100, 1)
    opm = q.get('opm_pct')
    if opm is not None:
        return round(opm, 1)
    return None


def is_fundamentally_strong(row):
    """Check if a stock meets fundamental strength criteria."""
    pat_q1 = row.get('pat_gr_q1')
    pat_q2 = row.get('pat_gr_q2')
    sales_q1 = row.get('sales_gr_q1')
    sales_q2 = row.get('sales_gr_q2')

    if pat_q1 is None or sales_q1 is None:
        return None  # Insufficient data

    # Q1 alone
    if sales_q1 > 35:
        return True
    if pat_q1 > 70:
        return True
    if sales_q1 > 20 and pat_q1 > 40:
        return True

    # Q1 + Q2 combined
    if pat_q2 is not None and sales_q2 is not None:
        if sales_q2 > 35:
            return True
        if pat_q2 > 70:
            return True
        if sales_q2 > 20 and pat_q2 > 40:
            return True
        if sales_q1 > 20 and sales_q2 > 20:
            return True
        if pat_q1 > 40 and pat_q2 > 40:
            return True

    return False


def export_screener_data(conn):
    """Export screener data: index + per-industry JSON files."""
    print("Exporting screener data...")
    cursor = conn.cursor()

    # Get latest metrics date
    cursor.execute('SELECT MAX(date) FROM stock_metrics')
    metrics_date = cursor.fetchone()[0]

    # Industry ranks
    ind_ranks = {}
    if metrics_date:
        cursor.execute('SELECT industry, rank FROM industry_rankings WHERE date = ?', (metrics_date,))
        ind_ranks = {r[0]: r[1] for r in cursor.fetchall()}

    # All stocks grouped by industry
    cursor.execute('SELECT ticker, industry FROM stocks ORDER BY industry, ticker')
    all_stocks = cursor.fetchall()

    # Build ticker->industry lookup and industry->stocks mapping
    ticker_to_industry = {}
    industry_stocks = {}
    for ticker, industry in all_stocks:
        ticker_to_industry[ticker] = industry
        if industry not in industry_stocks:
            industry_stocks[industry] = []
        industry_stocks[industry].append(ticker)

    # Export index
    index_industries = []
    for industry in sorted(industry_stocks.keys()):
        index_industries.append({
            'name': industry,
            'slug': slugify(industry),
            'stock_count': len(industry_stocks[industry]),
            'rank': ind_ranks.get(industry, 0),
        })

    write_json(os.path.join(OUTPUT_DIR, 'screener_index.json'), {
        'industries': index_industries,
        'tickers': ticker_to_industry,
    })

    # Pre-fetch RS history (last 90 days) for all stocks in one pass
    rs_history_map = {}
    cursor.execute('''
        SELECT ticker, date, rs_rating FROM stock_metrics
        WHERE date IN (
            SELECT DISTINCT date FROM stock_metrics ORDER BY date DESC LIMIT 90
        )
        ORDER BY ticker, date ASC
    ''')
    for ticker, date, rs in cursor.fetchall():
        if ticker not in rs_history_map:
            rs_history_map[ticker] = {'dates': [], 'values': []}
        if rs is not None:
            rs_history_map[ticker]['dates'].append(date)
            rs_history_map[ticker]['values'].append(rs)

    # Pre-fetch industry rank history (last 90 days) for all industries
    irank_history_map = {}
    cursor.execute('''
        SELECT industry, date, rank FROM industry_rankings
        WHERE date IN (
            SELECT DISTINCT date FROM industry_rankings ORDER BY date DESC LIMIT 90
        )
        ORDER BY industry, date ASC
    ''')
    for ind, date, rank in cursor.fetchall():
        if ind not in irank_history_map:
            irank_history_map[ind] = {'dates': [], 'values': []}
        irank_history_map[ind]['dates'].append(date)
        irank_history_map[ind]['values'].append(rank)

    # Export per-industry files
    today = datetime.now()
    exported = 0

    for industry, tickers in industry_stocks.items():
        stocks = []
        for ticker in tickers:
            row = {'ticker': ticker}

            # Technical metrics
            if metrics_date:
                cursor.execute('''
                    SELECT rs_rating, avg_volume_20d, atr_70d
                    FROM stock_metrics WHERE ticker = ? AND date = ?
                ''', (ticker, metrics_date))
                m = cursor.fetchone()
                if m:
                    row['rs_rating'] = m[0]
                    row['volume'] = round(m[1], 0) if m[1] else None
                    # Get last close for ATR%
                    cursor.execute('''
                        SELECT close FROM daily_price_data
                        WHERE ticker = ? ORDER BY date DESC LIMIT 1
                    ''', (ticker,))
                    close_row = cursor.fetchone()
                    if close_row and close_row[0] and m[2]:
                        row['atr_pct'] = round((m[2] / close_row[0]) * 100, 1)
                    else:
                        row['atr_pct'] = None
                else:
                    row['rs_rating'] = None
                    row['volume'] = None
                    row['atr_pct'] = None
            else:
                row['rs_rating'] = None
                row['volume'] = None
                row['atr_pct'] = None

            row['industry_rank'] = ind_ranks.get(industry, 0)

            # RS history for tooltip chart
            if ticker in rs_history_map:
                row['rs_history'] = rs_history_map[ticker]

            # Screener metrics
            cursor.execute('''
                SELECT market_cap, pe_ratio, price_to_book, roe_3yr
                FROM screener_metrics WHERE ticker = ?
            ''', (ticker,))
            sm = cursor.fetchone()
            if sm:
                row['market_cap'] = round(sm[0], 0) if sm[0] else None
                row['pe_ratio'] = round(sm[1], 1) if sm[1] else None
                row['price_to_book'] = round(sm[2], 1) if sm[2] else None
                row['roe_3yr'] = round(sm[3], 1) if sm[3] else None
            else:
                row['market_cap'] = None
                row['pe_ratio'] = None
                row['price_to_book'] = None
                row['roe_3yr'] = None

            # Fundamentals
            cursor.execute('''
                SELECT quarter, sales, operating_profit, opm_pct, depreciation, net_profit
                FROM fundamentals WHERE ticker = ? ORDER BY quarter DESC
            ''', (ticker,))
            qrows = cursor.fetchall()

            row['latest_quarter'] = None
            for key in ('pat_gr_q1', 'pat_gr_q2', 'pat_gr_q3',
                       'sales_gr_q1', 'sales_gr_q2', 'sales_gr_q3',
                       'ebitda_q1', 'ebitda_q2', 'ebitda_q3'):
                row[key] = None

            if qrows:
                q_list = []
                for qr in qrows:
                    q_list.append({
                        'quarter': qr[0], 'sales': qr[1], 'operating_profit': qr[2],
                        'opm_pct': qr[3], 'depreciation': qr[4], 'net_profit': qr[5]
                    })
                q_list.sort(key=lambda x: parse_quarter_to_date(x['quarter']), reverse=True)
                q_list = [q for q in q_list if parse_quarter_to_date(q['quarter']) <= today]

                if q_list:
                    q1 = q_list[0] if len(q_list) > 0 else None
                    q2 = q_list[1] if len(q_list) > 1 else None
                    q3 = q_list[2] if len(q_list) > 2 else None

                    row['latest_quarter'] = q1['quarter'] if q1 else None
                    q_lookup = {q['quarter']: q for q in q_list}

                    for qi, qdata, key in [(0, q1, 'q1'), (1, q2, 'q2'), (2, q3, 'q3')]:
                        if qdata:
                            yoy_q = get_yoy_quarter(qdata['quarter'])
                            yoy_data = q_lookup.get(yoy_q) if yoy_q else None
                            row[f'pat_gr_{key}'] = calc_yoy(qdata, yoy_data, 'net_profit')
                            row[f'sales_gr_{key}'] = calc_yoy(qdata, yoy_data, 'sales')
                            row[f'ebitda_{key}'] = calc_ebitda(qdata)

            # Fundamental strength
            row['is_strong'] = is_fundamentally_strong(row)

            stocks.append(row)

        # Sort by RS rating descending
        stocks.sort(key=lambda x: x.get('rs_rating') or 0, reverse=True)

        slug = slugify(industry)
        industry_file = {
            'industry': industry,
            'rank': ind_ranks.get(industry, 0),
            'stocks': stocks,
        }
        # Include industry rank history for tooltip chart
        if industry in irank_history_map:
            industry_file['rank_history'] = irank_history_map[industry]
        write_json(os.path.join(SCREENER_DIR, f'{slug}.json'), industry_file)
        exported += 1

    print(f"  Exported {exported} industry screener files")


# ============================================================================
# Metadata Export
# ============================================================================

def export_metadata(conn):
    """Export metadata (last refresh, data as of, counts)."""
    print("Exporting metadata.json...")
    cursor = conn.cursor()

    # Last refresh
    cursor.execute("SELECT value FROM metadata WHERE key = 'last_refresh'")
    row = cursor.fetchone()
    last_refresh = row[0] if row else None

    # Data as of
    cursor.execute('SELECT MAX(date) FROM stock_metrics')
    row = cursor.fetchone()
    data_as_of = row[0] if row else None

    # Counts
    cursor.execute('SELECT COUNT(DISTINCT ticker) FROM stocks')
    total_stocks = cursor.fetchone()[0]

    cursor.execute('SELECT COUNT(DISTINCT industry) FROM industry_rankings WHERE date = (SELECT MAX(date) FROM industry_rankings)')
    total_industries = cursor.fetchone()[0]

    write_json(os.path.join(OUTPUT_DIR, 'metadata.json'), {
        'last_refresh': last_refresh,
        'data_as_of': data_as_of,
        'export_timestamp': datetime.now().isoformat(),
        'total_stocks': total_stocks,
        'total_industries': total_industries,
    })


# ============================================================================
# Stock Notes Export
# ============================================================================

def export_notes(conn):
    """Export stock notes to a single JSON file."""
    print("Exporting stock notes...")
    cursor = conn.cursor()

    # Check if stock_notes table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_notes'")
    if not cursor.fetchone():
        print("  stock_notes table not found, skipping")
        return

    cursor.execute('SELECT ticker, notes, last_updated FROM stock_notes WHERE notes IS NOT NULL AND notes != ""')
    rows = cursor.fetchall()

    notes_data = {}
    for ticker, notes, last_updated in rows:
        notes_data[ticker] = {
            'notes': notes,
            'last_updated': last_updated
        }

    write_json(os.path.join(OUTPUT_DIR, 'stock_notes.json'), notes_data)
    print(f"  Exported notes for {len(notes_data)} stocks")


# ============================================================================
# Main
# ============================================================================

def main():
    print(f"Database: {DB_PATH}")
    print(f"Output: {OUTPUT_DIR}")
    print()

    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(SCREENER_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)

    export_metadata(conn)
    export_market_data()
    export_industries(conn)
    export_top_stocks(conn)
    export_momentum_stocks(conn)
    export_screener_data(conn)
    export_notes(conn)

    conn.close()
    print()
    print("Export complete!")


if __name__ == '__main__':
    main()
