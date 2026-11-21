import React, { useMemo, useState } from 'react';
import classNames from 'classnames';
import {
    computeTickStats,
    formatPercent,
    getLastDigit,
    SYNTHETIC_SYMBOLS,
    sumDigitPercentages,
    useTickStream,
} from './market-data';
import SplitBar from './split-bar';
import './trading-tools.scss';

const TICK_COUNTS = [100, 500, 1000];

const AnalysisTool = () => {
    const [symbol, setSymbol] = useState<string>('R_100');
    const [tick_count, setTickCount] = useState(1000);
    const [barrier, setBarrier] = useState(4);
    const { prices, pip_size, error, is_loading } = useTickStream(symbol, tick_count);

    const stats = useMemo(() => computeTickStats(prices, pip_size), [prices, pip_size]);
    const current_price = prices[prices.length - 1];
    const current_digit = current_price !== undefined ? getLastDigit(current_price, pip_size) : null;
    const max_pct = Math.max(...stats.digit_percentages);
    const min_pct = Math.min(...stats.digit_percentages);
    const over = sumDigitPercentages(stats.digit_percentages, digit => digit > barrier);
    const under = sumDigitPercentages(stats.digit_percentages, digit => digit < barrier);

    return (
        <section className='trading-tools' aria-labelledby='analysis-tool-title'>
            <header className='trading-tools__header'>
                <div>
                    <h2 id='analysis-tool-title' className='trading-tools__title'>
                        Analysis Tool
                    </h2>
                    <p className='trading-tools__subtitle'>Live digit, parity and direction statistics.</p>
                </div>
                <div className='trading-tools__controls'>
                    <label className='trading-tools__field'>
                        <span>Market</span>
                        <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                            {SYNTHETIC_SYMBOLS.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='trading-tools__field'>
                        <span>Ticks</span>
                        <select value={tick_count} onChange={e => setTickCount(Number(e.target.value))}>
                            {TICK_COUNTS.map(count => (
                                <option key={count} value={count}>
                                    {count}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </header>

            {error && (
                <p className='trading-tools__notice trading-tools__notice--error' role='alert'>
                    {error}
                </p>
            )}

            <div className='trading-tools__card trading-tools__price'>
                <div>
                    <span className='trading-tools__label'>Current price</span>
                    <strong className='trading-tools__price-value' aria-live='polite'>
                        {is_loading || current_price === undefined ? '—' : current_price.toFixed(pip_size)}
                    </strong>
                </div>
                <div>
                    <span className='trading-tools__label'>Last digit</span>
                    <strong className='trading-tools__price-value'>{current_digit ?? '—'}</strong>
                </div>
                <div>
                    <span className='trading-tools__label'>Sample</span>
                    <strong className='trading-tools__price-value'>{stats.total}</strong>
                </div>
            </div>

            <div className='trading-tools__card'>
                <h3 className='trading-tools__card-title'>Digit distribution</h3>
                <ul className='trading-tools__digits'>
                    {stats.digit_percentages.map((pct, digit) => (
                        <li
                            key={digit}
                            className={classNames('trading-tools__digit', {
                                'trading-tools__digit--high': stats.total > 0 && pct === max_pct,
                                'trading-tools__digit--low': stats.total > 0 && pct === min_pct,
                                'trading-tools__digit--current': digit === current_digit,
                            })}
                        >
                            <span className='trading-tools__digit-number'>{digit}</span>
                            <span className='trading-tools__digit-pct'>{formatPercent(pct)}</span>
                        </li>
                    ))}
                </ul>
                <p className='trading-tools__hint'>Green = most frequent, red = least frequent, outline = current.</p>
            </div>

            <div className='trading-tools__grid'>
                <div className='trading-tools__card'>
                    <h3 className='trading-tools__card-title'>Even / Odd</h3>
                    <SplitBar left_label='Even' left={stats.even} right_label='Odd' right={stats.odd} />
                </div>
                <div className='trading-tools__card'>
                    <h3 className='trading-tools__card-title'>Rise / Fall</h3>
                    <SplitBar left_label='Rise' left={stats.rise} right_label='Fall' right={stats.fall} />
                </div>
                <div className='trading-tools__card'>
                    <div className='trading-tools__card-row'>
                        <h3 className='trading-tools__card-title'>Over / Under</h3>
                        <label className='trading-tools__field trading-tools__field--inline'>
                            <span>Barrier</span>
                            <select value={barrier} onChange={e => setBarrier(Number(e.target.value))}>
                                {Array.from({ length: 10 }, (_, digit) => (
                                    <option key={digit} value={digit}>
                                        {digit}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <SplitBar
                        left_label={`Over ${barrier}`}
                        left={over}
                        right_label={`Under ${barrier}`}
                        right={under}
                    />
                </div>
            </div>

            <div className='trading-tools__card'>
                <h3 className='trading-tools__card-title'>Last 30 digits</h3>
                <ol className='trading-tools__stream'>
                    {stats.digits.slice(-30).map((digit, index) => (
                        <li
                            // eslint-disable-next-line react/no-array-index-key
                            key={`${index}-${digit}`}
                            className={classNames('trading-tools__stream-digit', {
                                'trading-tools__stream-digit--even': digit % 2 === 0,
                            })}
                        >
                            {digit}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
};

export default AnalysisTool;
