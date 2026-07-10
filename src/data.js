export const APP_VERSION = "1.0.0";
export const DATA_VERSION = 1;

export const MARKETS = {
  futures: { label: "期货", short: "期货", defaultSymbol: "甲醇" },
  fx: { label: "黄金外汇", short: "外汇", defaultSymbol: "XAUUSD" },
  btc: { label: "BTC", short: "BTC", defaultSymbol: "BTCUSDT" }
};

export const STATUS = {
  planned: "计划中",
  holding: "持仓中",
  pending_review: "待复盘",
  completed: "已完成"
};

export const DIRECTIONS = {
  long: "做多",
  short: "做空"
};

export const OUTCOMES = {
  win: "盈利",
  loss: "亏损",
  breakeven: "保本"
};

export const STRATEGY_TAGS = [
  "趋势回调",
  "突破回踩",
  "假突破",
  "区间边缘反转",
  "双顶",
  "双底",
  "吞没",
  "Pin Bar",
  "二次入场",
  "关键位置反转"
];

export const MARKET_ENV_TAGS = [
  "上涨趋势",
  "下跌趋势",
  "震荡区间",
  "趋势末端",
  "突破阶段",
  "深度回调",
  "新闻前后",
  "方向不清晰"
];

export const KEY_LEVEL_TAGS = [
  "前高",
  "前低",
  "支撑",
  "阻力",
  "区间上沿",
  "区间下沿",
  "趋势线",
  "整数关口",
  "突破位",
  "回踩位"
];

export const REASON_TAGS = [
  "趋势延续",
  "回踩确认",
  "关键位反应",
  "形态完成",
  "量价配合",
  "风险回报合适",
  "等待确认后入场",
  "无追单"
];

export const ERROR_TAGS = [
  "无错误",
  "追涨杀跌",
  "过早入场",
  "逆势交易",
  "区间中间入场",
  "没有等待确认",
  "止损过小",
  "止损过大",
  "随意移动止损",
  "提前止盈",
  "扛单",
  "过度交易",
  "报复性交易",
  "害怕错过",
  "仓位过大",
  "新闻前入场",
  "违反策略规则"
];

export const FUTURES_PRESETS = [
  { name: "甲醇", code: "MA", exchange: "郑商所", multiplier: 10, tick: 1, quoteUnit: "元/吨" },
  { name: "玻璃", code: "FG", exchange: "郑商所", multiplier: 20, tick: 1, quoteUnit: "元/吨" },
  { name: "纯碱", code: "SA", exchange: "郑商所", multiplier: 20, tick: 1, quoteUnit: "元/吨" },
  { name: "燃油", code: "FU", exchange: "上期所", multiplier: 10, tick: 1, quoteUnit: "元/吨" },
  { name: "螺纹钢", code: "RB", exchange: "上期所", multiplier: 10, tick: 1, quoteUnit: "元/吨" },
  { name: "豆粕", code: "M", exchange: "大商所", multiplier: 10, tick: 1, quoteUnit: "元/吨" },
  { name: "棕榈油", code: "P", exchange: "大商所", multiplier: 10, tick: 2, quoteUnit: "元/吨" },
  { name: "沪金", code: "AU", exchange: "上期所", multiplier: 1000, tick: 0.02, quoteUnit: "元/克" }
];

export const DEFAULT_STRATEGIES = [
  {
    id: "strategy-trend-pullback",
    name: "趋势回调",
    version: "1.0",
    description: "顺大周期方向，等待价格回调到关键位置后出现止跌或止涨信号。",
    applicableEnv: ["上涨趋势", "下跌趋势", "深度回调"],
    mustConditions: [
      "大周期方向明确",
      "价格回调到关键位置",
      "没有在区间中间入场",
      "小周期出现确认信号",
      "止损位置有逻辑依据",
      "计划盈亏比达到要求"
    ],
    forbiddenConditions: ["新闻前后方向不清晰", "追突破后的末端价格", "止损只能放在随机位置"],
    entrySignal: "小周期拒绝继续回调、吞没、Pin Bar 或二次入场。",
    stopRule: "止损放在结构外侧，而不是刚好放在噪音区。",
    exitRule: "优先按计划目标或结构破坏离场。",
    goodCaseImages: [],
    badCaseImages: []
  },
  {
    id: "strategy-break-retest",
    name: "突破回踩",
    version: "1.0",
    description: "有效突破关键区间后，等待回踩突破位并出现承接。",
    applicableEnv: ["突破阶段", "上涨趋势", "下跌趋势"],
    mustConditions: [
      "突破发生在关键位置",
      "突破后没有立刻追单",
      "回踩位置清晰",
      "回踩时波动收敛",
      "入场前有明确失效点"
    ],
    forbiddenConditions: ["假突破概率高但没有确认", "突破后离突破位过远", "盈亏比不足"],
    entrySignal: "回踩突破位后再次顺突破方向启动。",
    stopRule: "止损放在回踩结构外侧。",
    exitRule: "目标看向下一关键位置，弱势回踩失败及时离场。",
    goodCaseImages: [],
    badCaseImages: []
  },
  {
    id: "strategy-false-break",
    name: "假突破",
    version: "1.0",
    description: "价格刺破关键位后快速收回，利用失败突破后的反向流动性。",
    applicableEnv: ["震荡区间", "趋势末端", "方向不清晰"],
    mustConditions: [
      "关键位足够明显",
      "突破后快速收回",
      "没有追随突破方向",
      "反向入场有确认",
      "止损可放在假突破极值外侧"
    ],
    forbiddenConditions: ["真实突破后顺势加速", "重要新闻正在释放", "收回不明显"],
    entrySignal: "刺破后收回关键位并出现反向确认。",
    stopRule: "止损放在假突破高低点外侧。",
    exitRule: "第一目标为区间中部或对侧关键位。",
    goodCaseImages: [],
    badCaseImages: []
  }
];

export const DEFAULT_SETTINGS = {
  accounts: ["主账户"],
  feeMode: "direct_net_pnl",
  commonSymbols: {
    futures: ["甲醇", "玻璃", "纯碱", "燃油"],
    fx: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
    btc: ["BTCUSDT", "ETHUSDT", "BTCUSD 永续"]
  },
  futuresPresets: FUTURES_PRESETS,
  platforms: ["Binance", "OKX"],
  defaultMarginMode: "逐仓",
  recent: {
    account: "主账户",
    timeframe: "15m",
    strategy: "趋势回调",
    riskAmount: "",
    riskPercent: "",
    futuresContracts: {}
  },
  templates: [],
  savedFilters: [],
  lastBackupAt: "",
  theme: "system"
};

export function uid(prefix = "id") {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createTrade(market, overrides = {}, settings = DEFAULT_SETTINGS) {
  const now = new Date().toISOString();
  const symbol = overrides.symbol || MARKETS[market]?.defaultSymbol || "";
  const strategy = overrides.strategy || settings.recent?.strategy || STRATEGY_TAGS[0];
  const matchedStrategy = DEFAULT_STRATEGIES.find((item) => item.name === strategy);
  return {
    id: uid("trade"),
    dataVersion: DATA_VERSION,
    market,
    symbol,
    direction: overrides.direction || "long",
    status: overrides.status || "planned",
    account: overrides.account || settings.recent?.account || "主账户",
    timeframe: overrides.timeframe || settings.recent?.timeframe || "15m",
    createdAt: now,
    updatedAt: now,
    tradeDate: todayKey(),
    deletedAt: "",
    coverImageId: "",
    plan: {
      strategy,
      strategyVersion: matchedStrategy?.version || "1.0",
      checklist: [],
      environmentTags: [],
      keyLevelTags: [],
      reasonTags: [],
      riskAmount: settings.recent?.riskAmount || "",
      riskPercent: settings.recent?.riskPercent || "",
      reasonNote: "",
      screenshots: [],
      advanced: {
        observeTimeframe: settings.recent?.timeframe || "15m",
        entryTimeframe: settings.recent?.timeframe || "15m",
        plannedEntry: "",
        plannedStop: "",
        plannedTarget: "",
        plannedRR: "",
        detail: "",
        news: "",
        emotion: "",
        contractMonth: "",
        futuresMeta: {},
        btcTradeType: "合约"
      }
    },
    result: {
      pnl: "",
      outcome: "",
      followedPlan: "",
      finalR: "",
      exitScreenshots: [],
      advanced: {
        actualEntry: "",
        actualExit: "",
        size: "",
        exitReason: "",
        earlyProfit: false,
        movedStop: false,
        addPosition: false,
        reducePosition: false,
        unplannedAction: false,
        leverage: "",
        marginMode: settings.defaultMarginMode || "逐仓",
        platform: settings.platforms?.[0] || "",
        margin: ""
      }
    },
    review: {
      goodTrade: "",
      ruleFollowed: "",
      maxProblemTags: [],
      sentence: "",
      nextAction: "",
      annotatedScreenshots: [],
      ratings: {
        strategy: "",
        entry: "",
        management: "",
        emotion: "",
        execution: ""
      }
    }
  };
}

export function createInitialState() {
  return {
    appVersion: APP_VERSION,
    dataVersion: DATA_VERSION,
    trades: [],
    strategies: deepClone(DEFAULT_STRATEGIES),
    settings: deepClone(DEFAULT_SETTINGS),
    drafts: { futures: null, fx: null, btc: null },
    trash: []
  };
}

export function mergeDefaults(state) {
  const base = createInitialState();
  const merged = {
    ...base,
    ...state,
    settings: {
      ...base.settings,
      ...(state?.settings || {}),
      commonSymbols: {
        ...base.settings.commonSymbols,
        ...(state?.settings?.commonSymbols || {})
      },
      recent: {
        ...base.settings.recent,
        ...(state?.settings?.recent || {}),
        futuresContracts: {
          ...base.settings.recent.futuresContracts,
          ...(state?.settings?.recent?.futuresContracts || {})
        }
      }
    },
    drafts: {
      ...base.drafts,
      ...(state?.drafts || {})
    }
  };
  if (!Array.isArray(merged.strategies) || merged.strategies.length === 0) {
    merged.strategies = deepClone(DEFAULT_STRATEGIES);
  }
  if (!Array.isArray(merged.settings.futuresPresets) || merged.settings.futuresPresets.length === 0) {
    merged.settings.futuresPresets = deepClone(FUTURES_PRESETS);
  }
  return merged;
}
