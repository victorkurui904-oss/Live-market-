import React, { useCallback, useEffect, useState } from 'react';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import {
    computeTickStats,
    fetchTickHistory,
    formatPercent,
    SYNTHETIC_SYMBOLS,
    sumDigitPercentages,
} from './market-data';
import './trading-tools.scss';

const SAMPLE_SIZE = 500;
const AUTO_SCAN_MS = 30000;

type TSignal = { symbol: string; label: string; signal: string; probability: number; edge: number };

const pickBestSignal = (symbol: string, label: string, prices: number[], pip_size: number): TSignal => {
    const stats = computeTickStats(prices, pip_size);
    const over_4 = sumDigitPercentages(stats.digit_percentages, digit => digit > 4);
    const candidates = [
        { signal: stats.even >= stats.odd ? 'Even' : 'Odd', probability: Math.max(stats.even, stats.odd) },
        { signal: stats.rise >= stats.fall ? 'Rise' : 'Fall', probability: Math.max(stats.rise, stats.fall) },
        { signal: over_4 >= 50 ? 'Over 4' : 'Under 5', probability: Math.max(over_4, 100 - over_4) },
    ];
    const best = candidates.reduce((a, b) => (b.probability > a.probability ? b : a));
    return { symbol, label, ...best, edge: best.probability - 50 };
};

const getStrength = (edge: number) => {
    if (edge >= 3) return { text: 'Strong', modifier: 'strong' };
    if (edge >= 1.5) return { text: 'Moderate', modifier: 'moderate' };
    return { text: 'Weak', modifier: 'weak' };
};

const AiScanner = () => {
    const { connectionStatus } = useApiBase();
    const [signals, setSignals] = useState<TSignal[]>([]);
    const [is_scanning, setIsScanning] = useState(false);
    const [auto_scan, setAutoScan] = useState(false);
    const [last_scan, setLastScan] = useState<Date | null>(null);
    const [error, setError] = useState('');
    const is_connected = connectionStatus === CONNECTION_STATUS.OPENED;

    const scan = useCallback(async () => {
        setIsScanning(true);
        setError('');
        const results = await Promise.allSettled(
            SYNTHETIC_SYMBOLS.map(async ({ value, label }) => {
                const { prices, pip_size } = await fetchTickHistory(value, SAMPLE_SIZE);
                return pickBestSignal(value, label, prices, pip_size);
            })
        );
        const fulfilled = results
            .filter((r): r is PromiseFulfilledResult<TSignal> => r.status === 'fulfilled')
            .map(r => r.value)
            .sort((a, b) => b.edge - a.edge);
        if (!fulfilled.length) setError('Scan failed. Check your connection and try again.');
        setSignals(fulfilled);
        setLastScan(new Date());
        setIsScanning(false);
    }, []);

    useEffect(() => {
        if (!auto_scan || !is_connected) return undefined;
        scan();
        const interval = setInterval(scan, AUTO_SCAN_MS);
        return () => clearInterval(interval);
    }, [auto_scan, is_connected, scan]);

    return (
        <section className='trading-tools' aria-labelledby='ai-scanner-title'>
            <header className='trading-tools__header'>
                <div>
                    <h2 id='ai-scanner-title' className='trading-tools__title'>
                        AI Scanner
                    </h2>
                    <p className='trading-tools__subtitle'>
                        Scans every volatility index over the last {SAMPLE_SIZE} ticks and ranks the strongest
                        statistical bias.
                    </p>
                </div>
                <div className='trading-tools__controls'>
                    <label className='trading-tools__toggle'>
                        <input type='checkbox' checked={auto_scan} onChange={e => setAutoScan(e.target.checked)} />
                        <span>Auto-scan every 30s</span>
                    </label>
                    <button
                        type='button'
                        className='trading-tools__button trading-tools__button--primary'
                        onClick={scan}
                        disabled={is_scanning || !is_connected}
                    >
                        {is_scanning ? 'Scanning…' : 'Scan markets'}
                    </button>
                </div>
            </header>

            {error && (
                <p className='trading-tools__notice trading-tools__notice--error' role='alert'>
                    {error}
                </p>
            )}

            <div className='trading-tools__card trading-tools__table-wrapper'>
                {signals.length === 0 ? (
                    <p className='trading-tools__empty'>
                        {is_scanning ? 'Analysing markets…' : 'Run a scan to see ranked signals.'}
                    </p>
                ) : (
                    <table className='trading-tools__table'>
                        <thead>
                            <tr>
                                <th scope='col'>Rank</th>
                                <th scope='col'>Market</th>
                                <th scope='col'>Signal</th>
                                <th scope='col'>Hit rate</th>
                                <th scope='col'>Strength</th>
                            </tr>
                        </thead>
                        <tbody>
                            {signals.map((item, index) => {
                                const strength = getStrength(item.edge);
                                return (
                                    <tr key={item.symbol}>
                                        <td>{index + 1}</td>
                                        <td>{item.label}</td>
                                        <td>
                                            <strong>{item.signal}</strong>
                                        </td>
                                        <td>{formatPercent(item.probability)}</td>
                                        <td>
                                            <span
                                                className={`trading-tools__badge trading-tools__badge--${strength.modifier}`}
                                            >
                                                {strength.text}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            <p className='trading-tools__hint'>
                {last_scan ? `Last scan: ${last_scan.toLocaleTimeString()}. ` : ''}
                Signals reflect recent tick history only and do not guarantee future results.
            </p>
        </section>
    );
};

export default AiScanner;
