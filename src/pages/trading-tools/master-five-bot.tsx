import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, getSymbolLabel, SYNTHETIC_SYMBOLS, useTickStream } from './market-data';
import './trading-tools.scss';

type TPrediction = 'ODD' | 'EVEN';
type TStatus = 'idle' | 'waiting' | 'trading';
type TLogEntry = { id: number; contract_id?: number; stake: number; profit?: number; status: 'open' | 'won' | 'lost' };

type TSettings = {
    symbol: string;
    prediction: TPrediction;
    stake: number;
    martingale: number;
    take_profit: number;
    stop_loss: number;
    ticks: number;
    streak_target: number;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const isWaitingDigit = (digit: number, prediction: TPrediction) =>
    prediction === 'ODD' ? digit % 2 === 0 : digit % 2 === 1;

const getTrailingStreak = (digits: number[], prediction: TPrediction) => {
    let streak = 0;
    for (let i = digits.length - 1; i >= 0 && isWaitingDigit(digits[i], prediction); i--) streak++;
    return streak;
};

const waitForSettlement = (contract_id: number) =>
    new Promise<number>((resolve, reject) => {
        const api = api_base.api;
        let subscription_id: string | undefined;
        const message_subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
            const contract = data?.proposal_open_contract;
            if (data?.msg_type !== 'proposal_open_contract' || contract?.contract_id !== contract_id) return;
            subscription_id = data.subscription?.id ?? subscription_id;
            if (!contract.is_sold) return;
            message_subscription.unsubscribe();
            if (subscription_id) Promise.resolve(api.send({ forget: subscription_id })).catch(() => {});
            resolve(Number(contract.profit));
        });
        Promise.resolve(api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 })).catch(error => {
            message_subscription.unsubscribe();
            reject(error);
        });
    });

const NumberField = ({
    label,
    value,
    onChange,
    min,
    step,
    disabled,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    min: number;
    step: number;
    disabled: boolean;
}) => (
    <label className='trading-tools__field'>
        <span>{label}</span>
        <input
            type='number'
            inputMode='decimal'
            min={min}
            step={step}
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            aria-invalid={!(Number(value) >= min)}
        />
    </label>
);

const MasterFiveBot = observer(() => {
    const { client } = useStore();
    const { is_logged_in, currency } = client;

    const [symbol, setSymbol] = useState('R_100');
    const [prediction, setPrediction] = useState<TPrediction>('ODD');
    const [stake, setStake] = useState('1');
    const [martingale, setMartingale] = useState('2');
    const [take_profit, setTakeProfit] = useState('10');
    const [stop_loss, setStopLoss] = useState('20');
    const [ticks, setTicks] = useState(1);
    const [streak_target, setStreakTarget] = useState('5');

    const [status, setStatus] = useState<TStatus>('idle');
    const [streak, setStreak] = useState(0);
    const [current_stake, setCurrentStake] = useState(1);
    const [total_profit, setTotalProfit] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [log, setLog] = useState<TLogEntry[]>([]);
    const [message, setMessage] = useState('');

    const { prices, pip_size, error: stream_error } = useTickStream(symbol, 30);
    const digits = prices.map(price => getLastDigit(price, pip_size));
    const last_digit = digits[digits.length - 1];

    const settings: TSettings = {
        symbol,
        prediction,
        stake: Number(stake),
        martingale: Number(martingale),
        take_profit: Number(take_profit),
        stop_loss: Number(stop_loss),
        ticks,
        streak_target: Math.round(Number(streak_target)),
    };
    const is_valid =
        settings.stake >= 0.35 &&
        settings.martingale >= 1 &&
        settings.take_profit > 0 &&
        settings.stop_loss > 0 &&
        settings.streak_target >= 1;

    const run = useRef({ is_running: false, in_trade: false, streak: 0, stake: 0, profit: 0, settings });
    const is_running = status !== 'idle';
    const waiting_label = prediction === 'ODD' ? 'even' : 'odd';

    const stopBot = (reason: string) => {
        run.current.is_running = false;
        setStatus('idle');
        setMessage(reason);
    };

    const placeTrade = async () => {
        const state = run.current;
        const { settings: s } = state;
        state.in_trade = true;
        state.streak = 0;
        setStreak(0);
        setStatus('trading');

        const entry_id = Date.now();
        const trade_stake = state.stake;
        setLog(prev => [{ id: entry_id, stake: trade_stake, status: 'open' as const }, ...prev].slice(0, 30));

        try {
            const response: any = await api_base.api.send({
                buy: 1,
                price: trade_stake,
                parameters: {
                    amount: trade_stake,
                    basis: 'stake',
                    contract_type: s.prediction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN',
                    currency,
                    duration: s.ticks,
                    duration_unit: 't',
                    symbol: s.symbol,
                },
            });
            const contract_id = response.buy.contract_id;
            setLog(prev => prev.map(entry => (entry.id === entry_id ? { ...entry, contract_id } : entry)));

            const profit = await waitForSettlement(contract_id);
            const has_won = profit > 0;
            state.profit = roundMoney(state.profit + profit);
            state.stake = has_won ? s.stake : roundMoney(state.stake * s.martingale);

            setLog(prev =>
                prev.map(entry =>
                    entry.id === entry_id ? { ...entry, profit, status: has_won ? 'won' : 'lost' } : entry
                )
            );
            setTotalProfit(state.profit);
            setCurrentStake(state.stake);
            if (has_won) setWins(count => count + 1);
            else setLosses(count => count + 1);

            if (state.profit >= s.take_profit) {
                stopBot(`Take profit reached: +${state.profit.toFixed(2)} ${currency}.`);
            } else if (state.profit <= -s.stop_loss) {
                stopBot(`Stop loss reached: ${state.profit.toFixed(2)} ${currency}.`);
            } else if (state.is_running) {
                setStatus('waiting');
            }
        } catch (error: any) {
            setLog(prev => prev.filter(entry => entry.id !== entry_id));
            stopBot(error?.error?.message ?? error?.message ?? 'Purchase failed. Bot stopped.');
        } finally {
            state.in_trade = false;
        }
    };

    useEffect(() => {
        const state = run.current;
        if (!state.is_running || state.in_trade || last_digit === undefined) return;
        state.streak = isWaitingDigit(last_digit, state.settings.prediction) ? state.streak + 1 : 0;
        setStreak(state.streak);
        if (state.streak >= state.settings.streak_target) placeTrade();
        // Runs once per incoming tick; all other values are read from the run ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prices]);

    useEffect(
        () => () => {
            run.current.is_running = false;
        },
        []
    );

    const startBot = () => {
        const initial_streak = Math.min(getTrailingStreak(digits, prediction), settings.streak_target - 1);
        run.current = {
            is_running: true,
            in_trade: false,
            streak: initial_streak,
            stake: settings.stake,
            profit: 0,
            settings,
        };
        setStreak(initial_streak);
        setCurrentStake(settings.stake);
        setTotalProfit(0);
        setWins(0);
        setLosses(0);
        setLog([]);
        setMessage('');
        setStatus('waiting');
    };

    const status_text =
        status === 'trading'
            ? `Trade open: ${prediction === 'ODD' ? 'Odd' : 'Even'} for ${run.current.stake.toFixed(2)} ${currency}`
            : status === 'waiting'
              ? `Waiting for ${settings.streak_target} ${waiting_label} digits in a row (${streak}/${settings.streak_target})`
              : 'Bot is stopped';

    return (
        <article className='trading-tools__card master-five' aria-labelledby='master-five-title'>
            <div className='trading-tools__card-row'>
                <div>
                    <h3 id='master-five-title' className='trading-tools__card-title'>
                        Master 5
                    </h3>
                    <p className='trading-tools__bot-description'>
                        Trades Even/Odd. Picking Odd waits for {settings.streak_target || 5} even digits in a row,
                        then buys Odd. Picking Even waits for {settings.streak_target || 5} odd digits in a row,
                        then buys Even.
                    </p>
                </div>
                <span className='trading-tools__badge trading-tools__badge--risk-high'>High risk</span>
            </div>

            {!is_logged_in && (
                <p className='trading-tools__notice' role='status'>
                    Log in to your account to run this bot.
                </p>
            )}
            {(message || stream_error) && (
                <p className='trading-tools__notice' role='status'>
                    {message || stream_error}
                </p>
            )}

            <div className='master-five__layout'>
                <form className='trading-tools__form' onSubmit={e => e.preventDefault()}>
                    <label className='trading-tools__field'>
                        <span>Market</span>
                        <select value={symbol} onChange={e => setSymbol(e.target.value)} disabled={is_running}>
                            {SYNTHETIC_SYMBOLS.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <fieldset className='trading-tools__segmented' disabled={is_running}>
                        <legend>Enter on</legend>
                        {(['ODD', 'EVEN'] as const).map(option => (
                            <label
                                key={option}
                                className={classNames('trading-tools__segment', {
                                    'trading-tools__segment--active': option === prediction,
                                })}
                            >
                                <input
                                    type='radio'
                                    name='master-five-prediction'
                                    className='sr-only'
                                    checked={option === prediction}
                                    onChange={() => setPrediction(option)}
                                />
                                {option === 'ODD' ? 'Odd (after evens)' : 'Even (after odds)'}
                            </label>
                        ))}
                    </fieldset>

                    <div className='master-five__fields'>
                        <NumberField
                            label={`Stake (${currency})`}
                            value={stake}
                            onChange={setStake}
                            min={0.35}
                            step={0.01}
                            disabled={is_running}
                        />
                        <NumberField
                            label='Martingale ×'
                            value={martingale}
                            onChange={setMartingale}
                            min={1}
                            step={0.1}
                            disabled={is_running}
                        />
                        <NumberField
                            label={`Take profit (${currency})`}
                            value={take_profit}
                            onChange={setTakeProfit}
                            min={0.01}
                            step={0.01}
                            disabled={is_running}
                        />
                        <NumberField
                            label={`Stop loss (${currency})`}
                            value={stop_loss}
                            onChange={setStopLoss}
                            min={0.01}
                            step={0.01}
                            disabled={is_running}
                        />
                        <label className='trading-tools__field'>
                            <span>Ticks</span>
                            <select
                                value={ticks}
                                onChange={e => setTicks(Number(e.target.value))}
                                disabled={is_running}
                            >
                                {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
                                    <option key={value} value={value}>
                                        {value}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <NumberField
                            label='Streak length'
                            value={streak_target}
                            onChange={setStreakTarget}
                            min={1}
                            step={1}
                            disabled={is_running}
                        />
                    </div>
                    {!is_valid && (
                        <p className='trading-tools__field-error'>
                            Stake must be at least 0.35, martingale at least 1, and take profit, stop loss and
                            streak above 0.
                        </p>
                    )}

                    {is_running ? (
                        <button
                            type='button'
                            className='trading-tools__button master-five__stop'
                            onClick={() => stopBot('Bot stopped by you.')}
                        >
                            Stop bot
                        </button>
                    ) : (
                        <button
                            type='button'
                            className='trading-tools__button trading-tools__button--primary'
                            onClick={startBot}
                            disabled={!is_logged_in || !is_valid || prices.length === 0}
                        >
                            Start bot
                        </button>
                    )}
                </form>

                <div className='master-five__panel'>
                    <p
                        className={classNames('master-five__status', `master-five__status--${status}`)}
                        aria-live='polite'
                    >
                        {status_text}
                    </p>

                    <div>
                        <span className='trading-tools__label'>{getSymbolLabel(symbol)} · last digits</span>
                        <div className='trading-tools__stream' aria-label='Recent last digits'>
                            {digits.slice(-15).map((digit, index) => (
                                <span
                                    key={`${prices.length}-${index}`}
                                    className={classNames('trading-tools__stream-digit', 'master-five__digit', {
                                        'master-five__digit--even': digit % 2 === 0,
                                        'master-five__digit--odd': digit % 2 === 1,
                                    })}
                                >
                                    {digit}
                                </span>
                            ))}
                        </div>
                    </div>

                    <dl className='master-five__stats'>
                        <div>
                            <dt>Total P/L</dt>
                            <dd
                                className={classNames({
                                    'master-five__positive': total_profit > 0,
                                    'master-five__negative': total_profit < 0,
                                })}
                            >
                                {total_profit >= 0 ? '+' : ''}
                                {total_profit.toFixed(2)}
                            </dd>
                        </div>
                        <div>
                            <dt>Next stake</dt>
                            <dd>{current_stake.toFixed(2)}</dd>
                        </div>
                        <div>
                            <dt>Wins</dt>
                            <dd>{wins}</dd>
                        </div>
                        <div>
                            <dt>Losses</dt>
                            <dd>{losses}</dd>
                        </div>
                    </dl>

                    {log.length > 0 && (
                        <ul className='trading-tools__trades'>
                            {log.map(entry => (
                                <li key={entry.id} className='trading-tools__trade'>
                                    <div>
                                        <strong>{prediction === 'ODD' ? 'Odd' : 'Even'}</strong>
                                        <span className='trading-tools__hint'>
                                            Stake {entry.stake.toFixed(2)} {currency}
                                        </span>
                                    </div>
                                    <span
                                        className={classNames('trading-tools__trade-result', {
                                            'trading-tools__trade-result--won': entry.status === 'won',
                                            'trading-tools__trade-result--lost': entry.status === 'lost',
                                        })}
                                    >
                                        {entry.status === 'open'
                                            ? 'Open'
                                            : `${(entry.profit ?? 0) >= 0 ? '+' : ''}${entry.profit?.toFixed(2)}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <p className='trading-tools__hint'>
                After a loss the stake is multiplied by the martingale value; after a win it resets. Each new entry
                needs a fresh streak. Keep this tab open while the bot runs.
            </p>
        </article>
    );
});

export default MasterFiveBot;
