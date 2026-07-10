import { ERROR_TAGS, MARKETS } from "./data.js";

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

export function formatR(value) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}R`;
}

export function percent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

export function effectiveRuleFollowed(trade) {
  const reviewValue = trade.review?.ruleFollowed;
  if (reviewValue === "yes" || reviewValue === true) return true;
  if (reviewValue === "no" || reviewValue === false) return false;
  const resultValue = trade.result?.followedPlan;
  if (resultValue === "yes" || resultValue === true) return true;
  if (resultValue === "no" || resultValue === false) return false;
  return null;
}

export function effectiveGoodTrade(trade) {
  const value = trade.review?.goodTrade;
  if (value === "yes" || value === true) return true;
  if (value === "no" || value === false) return false;
  return null;
}

export function getTradeR(trade) {
  const explicit = toNumber(trade.result?.finalR);
  if (explicit !== null) return explicit;
  const pnl = toNumber(trade.result?.pnl);
  const risk = toNumber(trade.plan?.riskAmount);
  if (pnl !== null && risk && risk !== 0) return pnl / Math.abs(risk);
  return null;
}

export function getTradePnl(trade) {
  return toNumber(trade.result?.pnl) || 0;
}

export function isReviewComplete(trade) {
  return Boolean(
    trade.review?.goodTrade &&
      trade.review?.ruleFollowed &&
      trade.review?.sentence &&
      trade.review?.nextAction
  );
}

export function monthKey(dateString) {
  return (dateString || "").slice(0, 7);
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function compareTradeDate(a, b) {
  return String(a.tradeDate || a.createdAt || "").localeCompare(String(b.tradeDate || b.createdAt || ""));
}

export function applyFilters(trades, filters = {}) {
  return trades.filter((trade) => {
    if (trade.deletedAt) return false;
    if (filters.market && filters.market !== "all" && trade.market !== filters.market) return false;
    if (filters.startDate && (trade.tradeDate || "") < filters.startDate) return false;
    if (filters.endDate && (trade.tradeDate || "") > filters.endDate) return false;
    if (filters.symbol && trade.symbol !== filters.symbol) return false;
    if (filters.strategy && trade.plan?.strategy !== filters.strategy) return false;
    if (filters.direction && trade.direction !== filters.direction) return false;
    if (filters.status && trade.status !== filters.status) return false;
    if (filters.outcome && trade.result?.outcome !== filters.outcome) return false;
    if (filters.ruleFollowed) {
      const followed = effectiveRuleFollowed(trade);
      if (filters.ruleFollowed === "yes" && followed !== true) return false;
      if (filters.ruleFollowed === "no" && followed !== false) return false;
    }
    if (filters.goodTrade) {
      const good = effectiveGoodTrade(trade);
      if (filters.goodTrade === "yes" && good !== true) return false;
      if (filters.goodTrade === "no" && good !== false) return false;
    }
    if (filters.errorTag && !(trade.review?.maxProblemTags || []).includes(filters.errorTag)) return false;
    if (filters.environment && !(trade.plan?.environmentTags || []).includes(filters.environment)) return false;
    if (filters.reviewComplete) {
      const complete = isReviewComplete(trade);
      if (filters.reviewComplete === "yes" && !complete) return false;
      if (filters.reviewComplete === "no" && complete) return false;
    }
    if (filters.timeframe && trade.timeframe !== filters.timeframe && trade.plan?.advanced?.entryTimeframe !== filters.timeframe) {
      return false;
    }
    return true;
  });
}

export function computeStats(trades) {
  const sorted = [...trades].sort(compareTradeDate);
  const withPnl = sorted.filter((trade) => trade.result?.pnl !== "" || getTradeR(trade) !== null);
  const pnlValues = withPnl.map(getTradePnl);
  const rValues = withPnl.map((trade) => getTradeR(trade)).filter((value) => value !== null);
  const wins = withPnl.filter((trade) => getTradePnl(trade) > 0 || getTradeR(trade) > 0);
  const losses = withPnl.filter((trade) => getTradePnl(trade) < 0 || getTradeR(trade) < 0);
  const winR = wins.map((trade) => getTradeR(trade)).filter((value) => value !== null && value > 0);
  const lossR = losses.map((trade) => getTradeR(trade)).filter((value) => value !== null && value < 0);
  const grossProfit = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const netPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const cumulativeR = rValues.reduce((sum, value) => sum + value, 0);
  const avgWinR = average(winR);
  const avgLossR = average(lossR.map(Math.abs));
  const expectancy = rValues.length ? cumulativeR / rValues.length : null;
  const drawdown = computeDrawdown(withPnl);
  const streaks = computeStreaks(withPnl);
  const completeReviews = sorted.filter(isReviewComplete);
  const reviewSample = completeReviews.length ? completeReviews : sorted;
  const ruleKnown = reviewSample.filter((trade) => effectiveRuleFollowed(trade) !== null);
  const ruleFollowed = ruleKnown.filter((trade) => effectiveRuleFollowed(trade) === true);
  const ruleBroken = ruleKnown.filter((trade) => effectiveRuleFollowed(trade) === false);
  const goodKnown = reviewSample.filter((trade) => effectiveGoodTrade(trade) !== null);
  const goodTrades = goodKnown.filter((trade) => effectiveGoodTrade(trade) === true);
  const errorCost = computeErrorCost(reviewSample);
  const specificErrorCount = (tag) => reviewSample.filter((trade) => (trade.review?.maxProblemTags || []).includes(tag)).length;
  const violationLoss = ruleBroken.reduce((sum, trade) => sum + Math.min(0, getTradeR(trade) || 0), 0);
  const obeyR = ruleFollowed.reduce((sum, trade) => sum + (getTradeR(trade) || 0), 0);
  const brokenR = ruleBroken.reduce((sum, trade) => sum + (getTradeR(trade) || 0), 0);
  const riskPercents = sorted.map((trade) => toNumber(trade.plan?.riskPercent)).filter((value) => value !== null);
  const margins = sorted.map((trade) => toNumber(trade.result?.advanced?.margin)).filter((value) => value !== null);

  return {
    sampleCount: sorted.length,
    completedSampleCount: completeReviews.length,
    money: {
      count: withPnl.length,
      netPnl,
      cumulativeR,
      winRate: withPnl.length ? wins.length / withPnl.length : null,
      avgWinR,
      avgLossR,
      rrRatio: avgWinR !== null && avgLossR ? avgWinR / avgLossR : null,
      profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
      expectancy,
      maxDrawdown: drawdown.maxDrawdown,
      maxDrawdownR: drawdown.maxDrawdownR,
      maxLossStreak: streaks.maxLoss,
      maxWinStreak: streaks.maxWin,
      currentStreak: streaks.current
    },
    quality: {
      ruleCompliance: ruleKnown.length ? ruleFollowed.length / ruleKnown.length : null,
      goodTradeRate: goodKnown.length ? goodTrades.length / goodKnown.length : null,
      violationCount: ruleBroken.length,
      violationLossR: violationLoss,
      impulseCount: specificErrorCount("追涨杀跌") + specificErrorCount("报复性交易") + specificErrorCount("害怕错过"),
      earlyProfitCount: specificErrorCount("提前止盈"),
      movedStopCount: specificErrorCount("随意移动止损"),
      oversizeCount: specificErrorCount("仓位过大"),
      unplannedCount: sorted.filter((trade) => trade.result?.advanced?.unplannedAction).length + specificErrorCount("违反策略规则"),
      obeyR,
      brokenR,
      errorCost
    },
    capitalUsage: {
      avgRiskPercent: riskPercents.length ? average(riskPercents) : null,
      maxRiskPercent: riskPercents.length ? Math.max(...riskPercents) : null,
      avgMarginPercent: margins.length ? average(margins) : null,
      maxMarginPercent: margins.length ? Math.max(...margins) : null,
      maxConcurrentRiskPercent: riskPercents.length ? Math.max(...riskPercents) : null
    },
    series: buildSeries(withPnl),
    groups: buildGroups(sorted),
    calendar: buildCalendar(withPnl),
    monthlyBars: buildMonthlyBars(withPnl),
    complianceTrend: buildComplianceTrend(reviewSample)
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeDrawdown(trades) {
  let equity = 0;
  let equityR = 0;
  let peak = 0;
  let peakR = 0;
  let maxDrawdown = 0;
  let maxDrawdownR = 0;
  trades.forEach((trade) => {
    equity += getTradePnl(trade);
    equityR += getTradeR(trade) || 0;
    peak = Math.max(peak, equity);
    peakR = Math.max(peakR, equityR);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    maxDrawdownR = Math.min(maxDrawdownR, equityR - peakR);
  });
  return { maxDrawdown, maxDrawdownR };
}

function computeStreaks(trades) {
  let maxWin = 0;
  let maxLoss = 0;
  let currentCount = 0;
  let currentType = "";
  trades.forEach((trade) => {
    const value = getTradeR(trade) ?? getTradePnl(trade);
    const type = value > 0 ? "win" : value < 0 ? "loss" : "flat";
    if (type === "flat") {
      currentCount = 0;
      currentType = "";
      return;
    }
    if (type === currentType) currentCount += 1;
    else {
      currentType = type;
      currentCount = 1;
    }
    if (type === "win") maxWin = Math.max(maxWin, currentCount);
    if (type === "loss") maxLoss = Math.max(maxLoss, currentCount);
  });
  return {
    maxWin,
    maxLoss,
    current: currentType ? { type: currentType, count: currentCount } : { type: "flat", count: 0 }
  };
}

function computeErrorCost(trades) {
  const map = new Map();
  ERROR_TAGS.filter((tag) => tag !== "无错误").forEach((tag) => {
    map.set(tag, { tag, count: 0, lossR: 0, lossMoney: 0 });
  });
  trades.forEach((trade) => {
    (trade.review?.maxProblemTags || []).forEach((tag) => {
      if (tag === "无错误") return;
      const item = map.get(tag) || { tag, count: 0, lossR: 0, lossMoney: 0 };
      item.count += 1;
      item.lossR += Math.min(0, getTradeR(trade) || 0);
      item.lossMoney += Math.min(0, getTradePnl(trade));
      map.set(tag, item);
    });
  });
  return Array.from(map.values())
    .filter((item) => item.count > 0)
    .sort((a, b) => a.lossR - b.lossR || b.count - a.count);
}

function buildSeries(trades) {
  let pnl = 0;
  let r = 0;
  let peak = 0;
  let peakR = 0;
  return trades.sort(compareTradeDate).map((trade, index) => {
    pnl += getTradePnl(trade);
    r += getTradeR(trade) || 0;
    peak = Math.max(peak, pnl);
    peakR = Math.max(peakR, r);
    return {
      index,
      id: trade.id,
      date: trade.tradeDate || trade.createdAt?.slice(0, 10) || "",
      pnl,
      r,
      drawdown: pnl - peak,
      drawdownR: r - peakR
    };
  });
}

function buildCalendar(trades) {
  const map = new Map();
  trades.forEach((trade) => {
    const key = trade.tradeDate || trade.createdAt?.slice(0, 10);
    if (!key) return;
    const item = map.get(key) || { date: key, pnl: 0, r: 0, count: 0, ids: [] };
    item.pnl += getTradePnl(trade);
    item.r += getTradeR(trade) || 0;
    item.count += 1;
    item.ids.push(trade.id);
    map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildMonthlyBars(trades) {
  const map = new Map();
  trades.forEach((trade) => {
    const key = monthKey(trade.tradeDate || trade.createdAt?.slice(0, 10));
    if (!key) return;
    const item = map.get(key) || { month: key, pnl: 0, r: 0, count: 0, ids: [] };
    item.pnl += getTradePnl(trade);
    item.r += getTradeR(trade) || 0;
    item.count += 1;
    item.ids.push(trade.id);
    map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function buildGroups(trades) {
  return {
    strategy: groupBy(trades, (trade) => trade.plan?.strategy || "未标记"),
    symbol: groupBy(trades, (trade) => trade.symbol || "未填写"),
    direction: groupBy(trades, (trade) => (trade.direction === "long" ? "多单" : "空单")),
    environment: groupByMany(trades, (trade) => trade.plan?.environmentTags || ["未标记"]),
    market: groupBy(trades, (trade) => MARKETS[trade.market]?.label || trade.market)
  };
}

function groupBy(trades, getter) {
  const map = new Map();
  trades.forEach((trade) => {
    const key = getter(trade);
    const item = map.get(key) || { label: key, count: 0, pnl: 0, r: 0, ids: [] };
    item.count += 1;
    item.pnl += getTradePnl(trade);
    item.r += getTradeR(trade) || 0;
    item.ids.push(trade.id);
    map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => Math.abs(b.r) - Math.abs(a.r) || b.count - a.count);
}

function groupByMany(trades, getter) {
  const map = new Map();
  trades.forEach((trade) => {
    const values = getter(trade);
    (values.length ? values : ["未标记"]).forEach((key) => {
      const item = map.get(key) || { label: key, count: 0, pnl: 0, r: 0, ids: [] };
      item.count += 1;
      item.pnl += getTradePnl(trade);
      item.r += getTradeR(trade) || 0;
      item.ids.push(trade.id);
      map.set(key, item);
    });
  });
  return Array.from(map.values()).sort((a, b) => Math.abs(b.r) - Math.abs(a.r) || b.count - a.count);
}

function buildComplianceTrend(trades) {
  const map = new Map();
  trades.forEach((trade) => {
    const key = monthKey(trade.tradeDate || trade.createdAt?.slice(0, 10));
    const followed = effectiveRuleFollowed(trade);
    if (!key || followed === null) return;
    const item = map.get(key) || { month: key, total: 0, followed: 0, ids: [] };
    item.total += 1;
    if (followed) item.followed += 1;
    item.ids.push(trade.id);
    map.set(key, item);
  });
  return Array.from(map.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({ ...item, rate: item.total ? item.followed / item.total : null }));
}

export function monthlyMarketStats(trades, market) {
  const key = currentMonthKey();
  const list = trades.filter((trade) => !trade.deletedAt && trade.market === market && monthKey(trade.tradeDate || trade.createdAt) === key);
  const stats = computeStats(list);
  const pendingReview = trades.filter((trade) => !trade.deletedAt && trade.market === market && trade.status === "pending_review").length;
  return {
    pnl: stats.money.netPnl,
    r: stats.money.cumulativeR,
    compliance: stats.quality.ruleCompliance,
    pendingReview
  };
}
