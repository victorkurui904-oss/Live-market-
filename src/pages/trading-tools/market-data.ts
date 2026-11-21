import { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';

export const SYNTHETIC_SYMBOLS = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
] as const;

export const getSymbolLabel = (symbol: string) =>
    SYNTHETIC_SYMBOLS.find(item => item.value === symbol)?.label ?? symbol;

export const getLastDigit = (price: number, pip_size: number) => Number(price.toFixed(pip_size).slice(-1));

export type TTickStats = {
    total: number;
    digits: number[];
    digit_percentages: number[];
    even: number;
    odd: number;
    rise: number;
    fall: number;
};

export const computeTickStats = (prices: number[], pip_size: number): TTickStats => {
    const digits = prices.map(price => getLastDigit(price, pip_size));
    const total = digits.length;
    const counts = Array(10).fill(0);
    digits.forEach(digit => counts[digit]++);
    const safe_total = total || 1;
    const even_count = digits.filter(digit => digit % 2 === 0).length;

    let rises = 0;
    let falls = 0;
    for (let i = 1; i < prices.length; i++) {
        if (prices[i] > prices[i - 1]) rises++;
        else if (prices[i] < prices[i - 1]) falls++;
    }
    const moves = rises + falls || 1;

    return {
        total,
        digits,
        digit_percentages: counts.map(count => (count / safe_total) * 100),
        even: (even_count / safe_total) * 100,
        odd: ((total - even_count) / safe_total) * 100,
        rise: (rises / moves) * 100,
        fall: (falls / moves) * 100,
    };
};

export const sumDigitPercentages = (digit_percentages: number[], predicate: (digit: number) => boolean) =>
    digit_percentages.reduce((sum, value, digit) => (predicate(digit) ? sum + value : sum), 0);

type TTickStreamState = { prices: number[]; pip_size: number; error: string; is_loading: boolean };

const getErrorMessage = (error: any) => error?.error?.message ?? error?.message ?? 'Unable to load market data';

export const fetchTickHistory = async (symbol: string, count: number) => {
    const response: any = await api_base.api.send({ ticks_history: symbol, count, end: 'latest', style: 'ticks' });
    return { prices: (response?.history?.prices ?? []).map(Number), pip_size: Number(response?.pip_size ?? 2) };
};

/**
 * Streams live ticks for a symbol over the shared API connection. When another part of the app
 * already holds a tick subscription for the symbol, it reuses those messages instead of failing.
 */
export const useTickStream = (symbol: string, count: number) => {
    const { connectionStatus } = useApiBase();
    const [state, setState] = useState<TTickStreamState>({ prices: [], pip_size: 2, error: '', is_loading: true });

    useEffect(() => {
        const api = api_base.api;
        if (!api || connectionStatus !== CONNECTION_STATUS.OPENED) return undefined;

        let is_active = true;
        let own_subscription_id: string | undefined;
        setState({ prices: [], pip_size: 2, error: '', is_loading: true });

        const message_subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
            if (!is_active || data?.msg_type !== 'tick' || data?.tick?.symbol !== symbol) return;
            const quote = Number(data.tick.quote);
            setState(prev => ({ ...prev, prices: [...prev.prices.slice(-(count - 1)), quote] }));
        });

        const loadHistory = async () => {
            try {
                const response: any = await api.send({
                    ticks_history: symbol,
                    count,
                    end: 'latest',
                    style: 'ticks',
                    subscribe: 1,
                });
                if (!is_active) {
                    if (response?.subscription?.id)
                        Promise.resolve(api.send({ forget: response.subscription.id })).catch(() => {});
                    return;
                }
                own_subscription_id = response?.subscription?.id;
                setState({
                    prices: (response?.history?.prices ?? []).map(Number),
                    pip_size: Number(response?.pip_size ?? 2),
                    error: '',
                    is_loading: false,
                });
            } catch (error: any) {
                if (!is_active) return;
                if (error?.error?.code === 'AlreadySubscribed') {
                    const history = await fetchTickHistory(symbol, count).catch(() => null);
                    if (is_active && history) setState({ ...history, error: '', is_loading: false });
                    return;
                }
                setState(prev => ({ ...prev, error: getErrorMessage(error), is_loading: false }));
            }
        };
        loadHistory();

        return () => {
            is_active = false;
            message_subscription.unsubscribe();
            if (own_subscription_id) Promise.resolve(api.send({ forget: own_subscription_id })).catch(() => {});
        };
    }, [symbol, count, connectionStatus]);

    return state;
};

export const formatPercent = (value: number) => `${value.toFixed(1)}%`;
