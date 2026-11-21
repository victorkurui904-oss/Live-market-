import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import MasterFiveBot from './master-five-bot';
import './trading-tools.scss';

type TFreeBot = { file: string; name: string; description: string; risk: 'Low' | 'Medium' | 'High' };

const FREE_BOTS: TFreeBot[] = [
    {
        file: 'martingale',
        name: 'Martingale',
        description: 'Doubles the stake after each loss to recover previous losses with one win.',
        risk: 'High',
    },
    {
        file: 'dalembert',
        name: "D'Alembert",
        description: 'Raises the stake by one unit after a loss and lowers it after a win.',
        risk: 'Medium',
    },
    {
        file: 'oscars_grind',
        name: "Oscar's Grind",
        description: 'Aims for one unit of profit per series, increasing stake only after wins.',
        risk: 'Low',
    },
    {
        file: 'reverse_martingale',
        name: 'Reverse Martingale',
        description: 'Doubles the stake after each win to ride winning streaks, resets after a loss.',
        risk: 'Medium',
    },
    {
        file: 'reverse_dalembert',
        name: "Reverse D'Alembert",
        description: 'Adds a unit after wins and removes a unit after losses.',
        risk: 'Medium',
    },
    {
        file: '1_3_2_6',
        name: '1-3-2-6',
        description: 'Follows a fixed 1-3-2-6 stake sequence across consecutive wins.',
        risk: 'Low',
    },
];

const DEFAULT_VALUES: Record<string, number> = {
    stake: 1,
    duration: 5,
    profit: 10,
    loss: 10,
    size: 2,
    unit: 1,
    alembert_unit: 1,
    dalembert_unit: 1,
    oscar_unit: 1,
    max_stake: 10,
};

const DEFAULT_FIELDS: Record<string, string> = {
    MARKET_LIST: 'synthetic_index',
    SUBMARKET_LIST: 'random_index',
    SYMBOL_LIST: 'R_100',
};

const prepareBotXml = (xml: string) => {
    const dom = window.Blockly.utils.xml.textToDom(xml);
    dom.querySelectorAll('value[strategy_value]').forEach((el: Element) => {
        const key = el.getAttribute('strategy_value') ?? '';
        if (key.startsWith('boolean')) {
            el.innerHTML = '<block type="logic_boolean"><field name="BOOL">FALSE</field></block>';
        } else if (key in DEFAULT_VALUES) {
            el.innerHTML = `<shadow type="math_number"><field name="NUM">${DEFAULT_VALUES[key]}</field></shadow>`;
        }
    });
    Object.entries(DEFAULT_FIELDS).forEach(([name, value]) => {
        dom.querySelectorAll(`field[name="${name}"]`).forEach((el: Element) => {
            el.innerHTML = value;
        });
    });
    return window.Blockly.Xml.domToText(dom);
};

const waitForWorkspace = async (attempts = 20) => {
    for (let i = 0; i < attempts; i++) {
        if (window.Blockly?.derivWorkspace) return window.Blockly.derivWorkspace;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
};

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const [loading_file, setLoadingFile] = useState('');
    const [error, setError] = useState('');

    const loadBot = async (bot: TFreeBot) => {
        setLoadingFile(bot.file);
        setError('');
        try {
            const xml_module = await import(/* webpackChunkName: `[request]` */ `../../xml/${bot.file}.xml`);
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            const workspace = await waitForWorkspace();
            if (!workspace) throw new Error('Bot Builder is not ready yet.');
            await load({
                block_string: prepareBotXml(xml_module.default),
                file_name: bot.name,
                workspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });
        } catch (e: any) {
            dashboard.setActiveTab(DBOT_TABS.FREE_BOTS);
            setError(e?.message ?? 'Failed to load bot.');
        } finally {
            setLoadingFile('');
        }
    };

    return (
        <section className='trading-tools' aria-labelledby='free-bots-title'>
            <header className='trading-tools__header'>
                <div>
                    <h2 id='free-bots-title' className='trading-tools__title'>
                        Free Bots
                    </h2>
                    <p className='trading-tools__subtitle'>
                        Ready-made strategies. Load one into Bot Builder, review the settings, then press Run.
                    </p>
                </div>
            </header>

            {error && (
                <p className='trading-tools__notice trading-tools__notice--error' role='alert'>
                    {error}
                </p>
            )}

            <MasterFiveBot />

            <ul className='trading-tools__bots'>
                {FREE_BOTS.map(bot => (
                    <li key={bot.file} className='trading-tools__card trading-tools__bot'>
                        <div className='trading-tools__card-row'>
                            <h3 className='trading-tools__card-title'>{bot.name}</h3>
                            <span
                                className={`trading-tools__badge trading-tools__badge--risk-${bot.risk.toLowerCase()}`}
                            >
                                {bot.risk} risk
                            </span>
                        </div>
                        <p className='trading-tools__bot-description'>{bot.description}</p>
                        <p className='trading-tools__hint'>Volatility 100 Index · Rise/Fall · stake 1</p>
                        <button
                            type='button'
                            className='trading-tools__button trading-tools__button--primary'
                            onClick={() => loadBot(bot)}
                            disabled={!!loading_file}
                        >
                            {loading_file === bot.file ? 'Loading…' : 'Load bot'}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
});

export default FreeBots;
