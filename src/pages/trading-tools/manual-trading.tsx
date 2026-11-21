import React, { useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, getSymbolLabel, SYNTHETIC_SYMBOLS, useTickStream } from './market-data';
import './trading-tools.scss';

type TContractSide = { contract_type: string; label: string };
type TTradeType = { id: string; label: string; has_barrier: boolean; sides: [TContractSide, TContractSide] };

const TRADE_TYPES: TTradeType[] = [
    {
        id: 'rise_fall',
        label: 'Rise / Fall',
        has_barrier: false,
        sides: [
            { contract_type: 'CALL', label: 'Rise' },
            { contract_type: 'PUT', label: 'Fall' },
        ],
    },
    {
        id: 'even_odd',
        label: 'Even / Odd',
        has_barrier: false,
        sides: [
            { contract_type: 'DIGITEVEN', label: 'Even' },
            { contract_type: 'DIGITODD', label: 'Odd' },
        ],
    },
    {
        id: 'over_under',
        label: 'Over / Under',
        has_barrier: true,
        sides: [
            { contract_type: 'DIGITOVER', label: 'Over' },
            { contract_type: 'DIGITUNDER', label: 'Under' },
        ],
    },
    {
        id: 'matches_differs',
        label: 'Matches / Differs',
        has_barrier: true,
        sides: [
            { contract_type: 'DIGITMATCH', label: 'Matches' },
            { contract_type: 'DIGITDIFF', label: 'Differs' },
        ],
    },
];

type TProposal = { id: string; ask_price: number; payout: number } | { error: string };
type TTrade = {
    contract_id: number;
    label: string;
    symbol: string;
    buy_price: number;
    profit?: number;
    status: 'open' | 'won' | 'lost';
};

const ManualTrading = observer(() => {
    const { client } = useStore();
    const { connectionStatus } = useApiBase();
    const is_connected = connectionStatus === CONNECTION_STATUS.OPENED;
    const { is_logged_in, currency } = client;

    const [symbol, setSymbol] = useState<string>('R_100');
    const [trade_type_id, setTradeTypeId] = useState('rise_fall');
    const [stake, setStake] = useState('1');
    const [duration, setDuration] = useState(5);
    const [barrier, setBarrier] = useState(5);
    const [proposals, setProposals] = useState<Record<string, TProposal>>({});
    const [buying, setBuying] = useState('');
    const [message, setMessage] = useState('');
    const [trades, setTrades] = useState<TTrade[]>([]);

    const trade_type = TRADE_TYPES.find(item => item.id === trade_type_id) ?? TRADE_TYPES[0];
    const { prices, pip_size } = useTickStream(symbol, 20);
    const current_price = prices[prices.length - 1];
    const stake_amount = Number(stake);
    const is_stake_valid = Number.isFinite(stake_amount) && stake_amount >= 0.35 && stake_amount <= 50000;

    useEffect(() => {
        if (!is_connected || !is_logged_in || !is_stake_valid) {
            setProposals({});
            return undefined;
        }
        let is_active = true;
        const timer = setTimeout(async () => {
            const entries = await Promise.all(
                trade_type.sides.map(async side => {
                    try {
                        const response: any = await api_base.api.send({
                            proposal: 1,
                            amount: stake_amount,
                            basis: 'stake',
                            contract_type: side.contract_type,
                            currency,
                            duration,
                            duration_unit: 't',
                            symbol,
                            ...(trade_type.has_barrier ? { barrier: String(barrier) } : {}),
                        });
                        const { id, ask_price, payout } = response.proposal;
                        return [side.contract_type, { id, ask_price, payout }] as const;
                    } catch (error: any) {
                        return [side.contract_type, { error: error?.error?.message ?? 'Unavailable' }] as const;
                    }
                })
            );
            if (is_active) setProposals(Object.fromEntries(entries));
        }, 400);
        return () => {
            is_active = false;
            clearTimeout(timer);
        };
    }, [
        is_connected,
        is_logged_in,
        is_stake_valid,
        stake_amount,
        currency,
        duration,
        symbol,
        barrier,
        trade_type,
        prices.length === 0,
    ]);

    const trackContract = (contract_id: number) => {
        const api = api_base.api;
        let subscription_id: string | undefined;
        const message_subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
            const contract = data?.proposal_open_contract;
            if (data?.msg_type !== 'proposal_open_contract' || contract?.contract_id !== contract_id) return;
            subscription_id = data.subscription?.id ?? subscription_id;
            if (!contract.is_sold) return;
            const profit = Number(contract.profit);
            setTrades(prev =>
                prev.map(trade =>
                    trade.contract_id === contract_id
                        ? { ...trade, profit, status: profit >= 0 ? 'won' : 'lost' }
                        : trade
                )
            );
            message_subscription.unsubscribe();
            if (subscription_id) Promise.resolve(api.send({ forget: subscription_id })).catch(() => {});
        });
        Promise.resolve(api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 })).catch(() =>
            message_subscription.unsubscribe()
        );
    };

    const buy = async (side: TContractSide) => {
        const proposal = proposals[side.contract_type];
        if (!proposal || 'error' in proposal) return;
        setBuying(side.contract_type);
        setMessage('');
        try {
            const response: any = await api_base.api.send({ buy: proposal.id, price: proposal.ask_price });
            const { contract_id, buy_price } = response.buy;
            setTrades(prev =>
                [
                    {
                        contract_id,
                        buy_price,
                        symbol,
                        label: trade_type.has_barrier ? `${side.label} ${barrier}` : side.label,
                        status: 'open' as const,
                    },
                    ...prev,
                ].slice(0, 20)
            );
            trackContract(contract_id);
        } catch (error: any) {
            setMessage(error?.error?.message ?? 'Purchase failed.');
        } finally {
            setBuying('');
            setProposals({});
        }
    };

    return (
        <section className='trading-tools' aria-labelledby='manual-trading-title'>
            <header className='trading-tools__header'>
                <div>
                    <h2 id='manual-trading-title' className='trading-tools__title'>
                        Manual Trading
                    </h2>
                    <p className='trading-tools__subtitle'>Place single contracts by hand on the active account.</p>
                </div>
                <div className='trading-tools__live'>
                    <span className='trading-tools__label'>{getSymbolLabel(symbol)}</span>
                    <strong className='trading-tools__price-value' aria-live='polite'>
                        {current_price === undefined ? '—' : current_price.toFixed(pip_size)}
                    </strong>
                    <span className='trading-tools__hint'>
                        Last digit {current_price === undefined ? '—' : getLastDigit(current_price, pip_size)}
                    </span>
                </div>
            </header>

            {!is_logged_in && (
                <p className='trading-tools__notice' role='status'>
                    Log in to your account to see payouts and place trades.
                </p>
            )}
            {message && (
                <p className='trading-tools__notice trading-tools__notice--error' role='alert'>
                    {message}
                </p>
            )}

            <div className='trading-tools__trade-layout'>
                <form className='trading-tools__card trading-tools__form' onSubmit={e => e.preventDefault()}>
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
                    <fieldset className='trading-tools__segmented'>
                        <legend>Trade type</legend>
                        {TRADE_TYPES.map(item => (
                            <label
                                key={item.id}
                                className={classNames('trading-tools__segment', {
                                    'trading-tools__segment--active': item.id === trade_type_id,
                                })}
                            >
                                <input
                                    type='radio'
                                    name='trade-type'
                                    className='sr-only'
                                    checked={item.id === trade_type_id}
                                    onChange={() => setTradeTypeId(item.id)}
                                />
                                {item.label}
                            </label>
                        ))}
                    </fieldset>
                    <div className='trading-tools__form-row'>
                        <label className='trading-tools__field'>
                            <span>Stake ({currency})</span>
                            <input
                                type='number'
                                min={0.35}
                                step={0.01}
                                inputMode='decimal'
                                value={stake}
                                onChange={e => setStake(e.target.value)}
                                aria-invalid={!is_stake_valid}
                            />
                        </label>
                        <label className='trading-tools__field'>
                            <span>Duration (ticks)</span>
                            <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                                {Array.from({ length: 10 }, (_, i) => i + 1).map(ticks => (
                                    <option key={ticks} value={ticks}>
                                        {ticks}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {trade_type.has_barrier && (
                            <label className='trading-tools__field'>
                                <span>Digit</span>
                                <select value={barrier} onChange={e => setBarrier(Number(e.target.value))}>
                                    {Array.from({ length: 10 }, (_, digit) => (
                                        <option key={digit} value={digit}>
                                            {digit}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                    {!is_stake_valid && <p className='trading-tools__field-error'>Enter a stake of at least 0.35.</p>}

                    <div className='trading-tools__buy-buttons'>
                        {trade_type.sides.map((side, index) => {
                            const proposal = proposals[side.contract_type];
                            const has_error = !!proposal && 'error' in proposal;
                            const payout = proposal && !('error' in proposal) ? proposal.payout : null;
                            const error_text = proposal && 'error' in proposal ? proposal.error : '';
                            return (
                                <button
                                    key={side.contract_type}
                                    type='button'
                                    className={classNames('trading-tools__buy', {
                                        'trading-tools__buy--up': index === 0,
                                        'trading-tools__buy--down': index === 1,
                                    })}
                                    onClick={() => buy(side)}
                                    disabled={!proposal || has_error || !!buying}
                                >
                                    <span className='trading-tools__buy-label'>
                                        {buying === side.contract_type ? 'Buying…' : side.label}
                                    </span>
                                    <span className='trading-tools__buy-payout'>
                                        {payout !== null
                                            ? `Payout ${payout.toFixed(2)} ${currency}`
                                            : error_text || '—'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </form>

                <div className='trading-tools__card'>
                    <h3 className='trading-tools__card-title'>Recent trades</h3>
                    {trades.length === 0 ? (
                        <p className='trading-tools__empty'>No trades yet this session.</p>
                    ) : (
                        <ul className='trading-tools__trades'>
                            {trades.map(trade => (
                                <li key={trade.contract_id} className='trading-tools__trade'>
                                    <div>
                                        <strong>{trade.label}</strong>
                                        <span className='trading-tools__hint'>{getSymbolLabel(trade.symbol)}</span>
                                    </div>
                                    <span
                                        className={classNames('trading-tools__trade-result', {
                                            'trading-tools__trade-result--won': trade.status === 'won',
                                            'trading-tools__trade-result--lost': trade.status === 'lost',
                                        })}
                                    >
                                        {trade.status === 'open'
                                            ? 'Open'
                                            : `${(trade.profit ?? 0) >= 0 ? '+' : ''}${trade.profit?.toFixed(2)} ${currency}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
});

export default ManualTrading;
