"""Fetch a fixed research sample; no credentials and no runtime API dependency."""
import concurrent.futures
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'TSLA', 'GOOGL', 'META', 'NVDA', 'AMD',
           'INTC', 'QCOM', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'JPM', 'BAC', 'GS',
           'V', 'MA', 'XOM', 'CVX', 'JNJ', 'PFE', 'UNH', 'LLY', 'KO', 'PEP',
           'WMT', 'COST', 'DIS', 'BRK-B', 'BABA', 'IBM', 'CSCO', 'TXN', 'AMAT',
           'MU', 'INTU', 'PLTR', 'ABBV', 'MRK', 'ABT', 'TMO', 'DHR', 'PG',
           'MCD', 'NKE', 'SBUX', 'HD', 'LOW', 'TGT', 'UPS', 'FDX', 'CAT',
           'DE', 'BA', 'GE', 'GILD', 'COP', 'NEE', 'SPY']
START, END = '2025-01-01', '2026-01-01'


def fetch(symbol):
    epoch = lambda date: int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp())
    params = urllib.parse.urlencode({'period1': epoch(START), 'period2': epoch(END),
                                    'interval': '1d', 'events': 'div,splits', 'includeAdjustedClose': 'true'})
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{params}'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    chart = json.loads(raw)['chart']
    if chart.get('error'):
        raise ValueError(chart['error'])
    result = chart['result'][0]
    if result.get('events', {}).get('splits'):
        raise ValueError(f'{symbol}: split in sample; normalize share units before use')
    if result['meta']['currency'] != 'USD':
        raise ValueError('Only USD supported')
    quotes = result['indicators']['quote'][0]
    dividends = {dt.datetime.fromtimestamp(e['date'], dt.timezone.utc).date().isoformat(): e['amount']
                 for e in result.get('events', {}).get('dividends', {}).values()}
    bars = []
    for i, timestamp in enumerate(result['timestamp']):
        date = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).date().isoformat()
        bar = {k: quotes[k][i] for k in ['open', 'high', 'low', 'close', 'volume']}
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in bar.values()):
            raise ValueError(f'{symbol} {date}: missing/non-finite OHLCV')
        if not (0 < bar['low'] <= min(bar['open'], bar['close']) <= max(bar['open'], bar['close']) <= bar['high']) or bar['volume'] < 0:
            raise ValueError(f'{symbol} {date}: invalid OHLCV')
        bars.append({'date': date, **bar, 'dividend': dividends.get(date, 0)})
    dates = [b['date'] for b in bars]
    if dates != sorted(set(dates)) or len(bars) < 120:
        raise ValueError(f'{symbol}: insufficient or unordered bars')
    return symbol, {'name': result['meta'].get('shortName', symbol), 'bars': bars,
                    'sourceUrl': url, 'rawSha256': hashlib.sha256(raw).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='Refetch all existing series')
    args = parser.parse_args()
    output = ROOT / 'dist' / 'data' / 'us-2025.json'
    previous = json.loads(output.read_text(encoding='utf-8')) if output.exists() else None
    # Append new stocks without changing the series or numeric tickets of existing games.
    retained = previous['stocks'] if previous and not args.refresh else {}
    missing = [symbol for symbol in SYMBOLS if symbol not in retained]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        downloaded = dict(pool.map(fetch, missing))
    stocks = {symbol: retained[symbol] if symbol in retained else downloaded[symbol] for symbol in SYMBOLS}
    dates = [b['date'] for b in stocks['SPY']['bars']]
    for symbol, stock in stocks.items():
        if [b['date'] for b in stock['bars']] != dates:
            raise ValueError(f'{symbol}: calendar mismatch, refusing silent intersection')
    digest = hashlib.sha256(json.dumps(stocks, sort_keys=True).encode()).hexdigest()[:16]
    payload = {'version': 1, 'id': f'yahoo-us-2025-{digest}', 'source': 'Yahoo Finance chart endpoint',
               'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'currency': 'USD',
               'usage': 'Local personal research sample; public redistribution rights not verified.',
               'priceBasis': 'Yahoo quote OHLC; no dividend adjustment; no splits inside selected year.',
               'tradable': SYMBOLS[:-1], 'benchmark': 'SPY', 'startIndex': 59, 'sessions': 60,
               'stocks': stocks}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    temporary.replace(output)
    print(json.dumps({'path': str(output), 'bytes': output.stat().st_size, 'id': payload['id'],
                      'symbols': {s: len(v['bars']) for s, v in stocks.items()},
                      'historyStart': dates[0], 'historyEnd': dates[-1],
                      'decisionDate': dates[59], 'firstExecution': dates[60], 'finalClose': dates[119],
                      'dividendEvents': {s: sum(b['dividend'] > 0 for b in v['bars']) for s, v in stocks.items()}}, indent=2))


if __name__ == '__main__':
    main()
