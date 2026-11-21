type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    ANALYSIS_TOOL: 4,
    FREE_BOTS: 5,
    AI_SCANNER: 6,
    MANUAL_TRADING: 7,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-analysis-tool',
    'id-free-bots',
    'id-ai-scanner',
    'id-manual-trading',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
