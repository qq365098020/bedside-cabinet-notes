import {
  APP_VERSION,
  DIRECTIONS,
  ERROR_TAGS,
  KEY_LEVEL_TAGS,
  MARKETS,
  MARKET_ENV_TAGS,
  OUTCOMES,
  REASON_TAGS,
  STATUS,
  STRATEGY_TAGS,
  createTrade,
  deepClone,
  todayKey,
  uid
} from "./data.js";
import {
  deleteImageRecord,
  getAllImages,
  getImageRecord,
  loadState,
  putImageRecord,
  replaceState,
  saveState,
  storeImageDataUrl,
  storeImageFile
} from "./storage.js";
import {
  applyFilters,
  computeStats,
  currentMonthKey,
  effectiveGoodTrade,
  effectiveRuleFollowed,
  formatMoney,
  formatR,
  getTradePnl,
  getTradeR,
  isReviewComplete,
  monthKey,
  monthlyMarketStats,
  percent,
  toNumber
} from "./stats.js";
import { buildBackupZip, downloadBlob, inspectBackupFile, mergeImportBackup } from "./backup.js";

const root = document.getElementById("app");
const modalRoot = document.getElementById("modalRoot");
const toastNode = document.getElementById("toast");

class PriceActionReviewApp {
  constructor() {
    this.state = loadState();
    this.activeTab = "futures";
    this.filters = {
      futures: {},
      fx: {},
      btc: {},
      summary: { market: "all" },
      settings: {}
    };
    this.formTrade = null;
    this.formStage = "plan";
    this.detailTradeId = "";
    this.chartMaps = new Map();
    this.chartAnimations = new Map();
    this.pendingInspection = null;
    this.viewer = null;
    this.applyTheme();
    this.bindEvents();
    this.registerServiceWorker();
    this.render();
  }

  bindEvents() {
    root.addEventListener("click", (event) => this.handleClick(event));
    root.addEventListener("change", (event) => this.handleChange(event));
    modalRoot.addEventListener("click", (event) => this.handleClick(event));
    modalRoot.addEventListener("input", (event) => this.handleInput(event));
    modalRoot.addEventListener("change", (event) => this.handleChange(event));
    modalRoot.addEventListener("dragover", (event) => {
      if (event.target.closest("[data-drop-category]")) event.preventDefault();
    });
    modalRoot.addEventListener("drop", (event) => this.handleDrop(event));
    modalRoot.addEventListener("paste", (event) => this.handlePaste(event));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeModal();
    });
  }

  registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  applyTheme() {
    const theme = this.state.settings.theme || "system";
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
  }

  persist(next = this.state) {
    this.state = saveState(next);
    this.applyTheme();
  }

  toast(message) {
    toastNode.textContent = message;
    toastNode.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toastNode.classList.remove("show"), 2400);
  }

  handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const dataset = target.dataset;
    event.preventDefault();

    const handlers = {
      "switch-tab": () => {
        this.activeTab = dataset.tab;
        this.render();
      },
      "new-trade": () => this.openTradeForm({ market: dataset.market || this.activeTab, symbol: dataset.symbol }),
      "copy-last": () => this.copyLastIntoForm(),
      "use-template": () => this.applyTemplate(dataset.templateId),
      "save-template": () => this.saveCurrentAsTemplate(),
      "set-stage": () => {
        this.formStage = dataset.stage;
        this.renderTradeForm();
      },
      "set-choice": () => this.setFormPath(dataset.path, dataset.value),
      "toggle-tag": () => this.toggleTag(dataset.path, dataset.value),
      "save-trade": () => this.saveTradeAndClose(),
      "close-modal": () => this.closeModal(),
      "open-filter": () => this.openFilterSheet(dataset.scope),
      "clear-filters": () => {
        this.filters[dataset.scope] = dataset.scope === "summary" ? { market: "all" } : {};
        this.render();
      },
      "apply-summary-market": () => {
        this.filters.summary.market = dataset.market;
        this.render();
      },
      "remove-filter": () => {
        delete this.filters[dataset.scope][dataset.key];
        this.render();
      },
      "apply-filter": () => this.applyFilterForm(dataset.scope),
      "save-filter": () => this.saveFilterPreset(dataset.scope),
      "load-filter": () => this.loadFilterPreset(dataset.id),
      "quick-symbol": () => {
        this.filters[dataset.scope] = { ...(this.filters[dataset.scope] || {}), symbol: dataset.symbol };
        this.render();
      },
      "open-detail": () => this.openDetail(dataset.id),
      "edit-trade": () => this.openTradeForm({ tradeId: dataset.id, stage: dataset.stage || "plan" }),
      "delete-trade": () => this.moveToTrash(dataset.id),
      "restore-trade": () => this.restoreTrade(dataset.id),
      "delete-image": () => this.removeImage(dataset.id),
      "set-cover": () => this.setCover(dataset.id),
      "view-image": () => this.openImageViewer(dataset.id),
      "viewer-tool": () => this.setViewerTool(dataset.tool),
      "viewer-zoom": () => this.zoomViewer(Number(dataset.delta || 0)),
      "save-annotation": () => this.saveAnnotation(),
      "open-data": () => this.openDataSheet(),
      "export-backup": () => this.exportBackup(),
      "export-csv": () => this.exportCsv(),
      "trigger-import": () => (modalRoot.querySelector("#backupImport") || root.querySelector("#pageBackupImport"))?.click(),
      "trigger-page-import": () => root.querySelector("#pageBackupImport")?.click(),
      "confirm-import": () => this.confirmImport(),
      "check-update": () => this.checkUpdate(),
      "set-theme": () => {
        this.state.settings.theme = dataset.theme;
        this.persist();
        this.refreshSettingsSurface();
      },
      "open-strategy": () => this.openStrategyEditor(dataset.id),
      "new-strategy": () => this.openStrategyEditor("new"),
      "save-strategy": () => this.saveStrategyEditor(),
      "duplicate-strategy": () => this.duplicateStrategy(dataset.id),
      "danger-reset": () => this.openResetConfirm(),
      "confirm-reset": () => this.resetAllData(),
      "open-trade-list": () => this.openTradeListByIds(dataset.ids, dataset.title),
      "calendar-day": () => this.openTradeListByIds(dataset.ids, dataset.title),
      "mark-status": () => {
        this.setFormPath("status", dataset.status);
      }
    };

    handlers[action]?.();
  }

  handleInput(event) {
    const target = event.target;
    if (target.matches("[data-field]") && this.formTrade) {
      const value = target.type === "checkbox" ? target.checked : target.value;
      this.setFormPath(target.dataset.field, value, { silent: true });
      this.recalculateFormTrade();
      this.autosaveDraft();
      this.updateComputedFields();
    }
  }

  handleChange(event) {
    const target = event.target;
    if (target.matches("[data-upload]") && this.formTrade) {
      this.handleFiles(target.files, target.dataset.upload);
      target.value = "";
    }
    if ((target.id === "backupImport" || target.id === "pageBackupImport") && target.files?.[0]) {
      this.inspectImport(target.files[0]);
      target.value = "";
    }
    if (target.matches("[data-strategy-field]")) {
      this.updateStrategyDraftFromDom();
    }
  }

  async handleDrop(event) {
    const zone = event.target.closest("[data-drop-category]");
    if (!zone || !this.formTrade) return;
    event.preventDefault();
    await this.handleFiles(event.dataTransfer.files, zone.dataset.dropCategory);
  }

  async handlePaste(event) {
    if (!this.formTrade) return;
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    const category = this.formStage === "result" ? "exit_after" : this.formStage === "review" ? "review_marked" : "entry_before";
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    await this.handleFiles(files, category);
  }

  render() {
    const page =
      this.activeTab === "summary"
        ? this.renderSummaryPage()
        : this.activeTab === "settings"
          ? this.renderSettingsPage()
          : this.renderMarketPage(this.activeTab);
    const showFab = ["futures", "fx", "btc"].includes(this.activeTab);
    root.innerHTML = `
      <main class="screen screen-${this.activeTab}" data-page="${this.activeTab}">
        <div class="screen-inner">
          ${page}
        </div>
      </main>
      ${showFab ? `<button class="fab" data-action="new-trade" data-market="${this.activeTab}" aria-label="新建交易">+</button>` : ""}
      ${this.renderBottomNav()}
    `;
    this.hydrateThumbs();
    this.drawCharts();
  }

  renderBottomNav() {
    const tabs = [
      ["futures", "期货", "⌁"],
      ["fx", "黄金外汇", "◇"],
      ["btc", "BTC", "₿"],
      ["summary", "汇总数据", "≋"],
      ["settings", "设置", "⚙"]
    ];
    return `
      <nav class="bottom-nav" aria-label="底部导航">
        ${tabs
          .map(
            ([tab, label, icon]) => `
              <button class="nav-item ${this.activeTab === tab ? "active" : ""}" data-action="switch-tab" data-tab="${tab}">
                <span class="nav-icon">${icon}</span>
                <span class="nav-label">${label}</span>
              </button>
            `
          )
          .join("")}
      </nav>
    `;
  }

  renderSettingsPage() {
    const activeTrades = this.state.trades.filter((trade) => !trade.deletedAt);
    const draftCount = Object.values(this.state.drafts || {}).filter(Boolean).length;
    const releaseVersion = currentReleaseVersion();
    const lastBackup = this.state.settings.lastBackupAt || "未备份";
    const trashCount = (this.state.trash || []).length;
    return `
      <header class="topbar">
        <div>
          <p class="eyebrow">数据与应用设置</p>
          <h1>设置</h1>
          <p class="eyebrow">版本 ${escapeHtml(releaseVersion)} · 数据结构 ${APP_VERSION}</p>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" data-action="check-update" aria-label="检查更新">↻</button>
          <button class="icon-btn" data-action="open-data" aria-label="更多设置">⋯</button>
        </div>
      </header>

      <section class="settings-grid">
        <section class="settings-card settings-card-wide">
          <div class="split">
            <h3>备份与导入</h3>
            <span class="badge">ZIP</span>
          </div>
          <div class="form-grid two-col">
            <button class="primary-btn" data-action="export-backup">导出完整备份</button>
            <button class="ghost-btn" data-action="trigger-page-import">导入备份</button>
            <button class="ghost-btn" data-action="export-csv">导出 CSV 表格</button>
            <button class="ghost-btn" data-action="check-update">检查更新</button>
            <input id="pageBackupImport" type="file" accept=".zip,application/zip" class="hidden">
          </div>
        </section>

        <section class="settings-card">
          <h3>版本与数据</h3>
          <div class="kv-grid">
            ${this.kv("当前版本", releaseVersion)}
            ${this.kv("最近备份", lastBackup)}
            ${this.kv("交易数量", activeTrades.length)}
            ${this.kv("回收站", trashCount)}
            ${this.kv("待同步草稿", draftCount)}
            ${this.kv("策略数量", this.state.strategies.length)}
            ${this.kv("期货预设", this.state.settings.futuresPresets.length)}
            ${this.kv("存储模式", "本地可运行版")}
          </div>
        </section>

        <section class="settings-card">
          <h3>外观</h3>
          <div class="quick-row">
            ${[
              ["system", "跟随系统"],
              ["light", "浅色"],
              ["dark", "深色"]
            ]
              .map(([theme, label]) => `<button class="chip ${this.state.settings.theme === theme ? "active" : ""}" data-action="set-theme" data-theme="${theme}">${label}</button>`)
              .join("")}
          </div>
        </section>

        <section class="settings-card">
          <h3>远程存储状态</h3>
          <div class="list-compact">
            <div class="list-row">
              <strong>D1/R2 尚未接入当前可发布版本</strong>
              <span class="muted">当前先保留 GitHub Pages 可调试版本，避免 Sites 访问异常影响录入和备份。</span>
            </div>
            <div class="list-row">
              <strong>完整备份</strong>
              <span class="muted">备份 ZIP 包含交易数据、截图、缩略图、策略库、标签、预设和设置。</span>
            </div>
          </div>
        </section>
      </section>
    `;
  }

  renderMarketPage(market) {
    const label = MARKETS[market].label;
    const monthly = monthlyMarketStats(this.state.trades, market);
    const filters = this.filters[market] || {};
    const trades = this.visibleTrades(market);
    const recent = trades.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 30);
    const commonSymbols = this.state.settings.commonSymbols[market] || [];
    const draft = this.state.drafts[market];
    return `
      <header class="topbar">
        <div>
          <p class="eyebrow">价格行为交易复盘 · ${label}</p>
          <h1>${label}</h1>
          <p class="eyebrow">${new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</p>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" data-action="open-filter" data-scope="${market}" aria-label="筛选">⌕</button>
          <button class="icon-btn" data-action="open-data" aria-label="数据和策略">⋯</button>
        </div>
      </header>

      <section class="metric-grid">
        ${this.metric("本月累计盈亏", formatMoney(monthly.pnl), monthly.pnl)}
        ${this.metric("本月累计 R", formatR(monthly.r), monthly.r)}
        ${this.metric("本月规则遵守率", percent(monthly.compliance), null, "完整复盘优先")}
        ${this.metric("待复盘交易", `${monthly.pendingReview}`, monthly.pendingReview ? -1 : 0)}
      </section>

      ${draft ? this.renderDraftResume(market, draft) : ""}

      <section>
        <div class="section-head">
          <h2>常用品种</h2>
          <button class="small-icon-btn" data-action="new-trade" data-market="${market}" aria-label="新建">+</button>
        </div>
        <div class="quick-row">
          ${commonSymbols
            .map(
              (symbol) => `
                <button class="chip" data-action="quick-symbol" data-scope="${market}" data-symbol="${escapeAttr(symbol)}">${escapeHtml(symbol)}</button>
              `
            )
            .join("")}
        </div>
      </section>

      ${this.renderFilterChips(market)}

      <section>
        <div class="section-head">
          <div>
            <h2>最近交易</h2>
            <div class="muted">${recent.length ? `显示 ${recent.length} 笔` : "暂无符合条件的交易"}</div>
          </div>
          <div class="row-actions">
            ${Object.keys(filters).length ? `<button class="ghost-btn" data-action="clear-filters" data-scope="${market}">清除筛选</button>` : ""}
          </div>
        </div>
        <div class="trade-list">
          ${recent.length ? recent.map((trade) => this.tradeCard(trade)).join("") : `<div class="empty">还没有交易记录</div>`}
        </div>
      </section>
    `;
  }

  renderDraftResume(market, draft) {
    return `
      <section class="panel split">
        <div>
          <strong>有未完成草稿</strong>
          <div class="muted">${escapeHtml(draft.symbol || MARKETS[market].defaultSymbol)} · ${escapeHtml(draft.plan?.strategy || "")} · ${escapeHtml(draft.tradeDate || "")}</div>
        </div>
        <button class="primary-btn" data-action="new-trade" data-market="${market}">继续</button>
      </section>
    `;
  }

  metric(label, value, signedValue = null, foot = "") {
    const tone = signedValue === null ? "" : signedValue > 0 ? "positive" : signedValue < 0 ? "negative" : "neutral";
    return `
      <div class="metric-card">
        <div class="metric-label">${label}</div>
        <div class="metric-value ${tone}">${value}</div>
        ${foot ? `<div class="metric-foot">${foot}</div>` : ""}
      </div>
    `;
  }

  visibleTrades(scope) {
    const market = scope === "summary" ? this.filters.summary.market : scope;
    const filters = { ...(this.filters[scope] || {}) };
    if (scope !== "summary") filters.market = scope;
    else if (market && market !== "all") filters.market = market;
    return applyFilters(this.state.trades, filters);
  }

  renderFilterChips(scope) {
    const filters = this.filters[scope] || {};
    const labels = {
      market: "市场",
      startDate: "开始",
      endDate: "结束",
      symbol: "品种",
      strategy: "策略",
      direction: "方向",
      status: "状态",
      outcome: "结果",
      ruleFollowed: "规则",
      goodTrade: "好交易",
      errorTag: "错误",
      environment: "环境",
      reviewComplete: "复盘",
      timeframe: "周期"
    };
    const chips = Object.entries(filters).filter(([, value]) => value && value !== "all");
    if (!chips.length) return "";
    return `
      <div class="chip-row">
        ${chips
          .map(([key, value]) => {
            const display = this.filterDisplay(key, value);
            return `<button class="filter-chip" data-action="remove-filter" data-scope="${scope}" data-key="${key}">${labels[key] || key}: ${escapeHtml(display)} ×</button>`;
          })
          .join("")}
      </div>
    `;
  }

  filterDisplay(key, value) {
    if (key === "market") return value === "all" ? "全部" : MARKETS[value]?.label || value;
    if (key === "direction") return DIRECTIONS[value] || value;
    if (key === "status") return STATUS[value] || value;
    if (key === "outcome") return OUTCOMES[value] || value;
    if (key === "ruleFollowed" || key === "goodTrade" || key === "reviewComplete") return value === "yes" ? "是" : "否";
    return value;
  }

  tradeCard(trade) {
    const r = getTradeR(trade);
    const pnl = getTradePnl(trade);
    const followed = effectiveRuleFollowed(trade);
    const ruleClass = followed === true ? "good" : followed === false ? "bad" : "warn";
    const ruleText = followed === true ? "遵守规则" : followed === false ? "违反规则" : "未评估规则";
    const cover = trade.coverImageId || trade.plan?.screenshots?.[0] || trade.result?.exitScreenshots?.[0] || "";
    const valueText = r !== null ? formatR(r) : formatMoney(pnl);
    const tone = (r ?? pnl) > 0 ? "positive" : (r ?? pnl) < 0 ? "negative" : "neutral";
    return `
      <article class="trade-card" data-action="open-detail" data-id="${trade.id}">
        <div class="thumb" data-thumb="${cover}">截图</div>
        <div class="trade-main">
          <div class="trade-title-row">
            <div class="trade-symbol">${escapeHtml(trade.symbol || "未填写品种")} · ${DIRECTIONS[trade.direction] || ""}</div>
            <div class="trade-pnl ${tone}">${valueText}</div>
          </div>
          <div class="trade-sub">${escapeHtml(trade.tradeDate || "")} · ${escapeHtml(trade.plan?.strategy || "未选策略")} · ${escapeHtml((trade.plan?.environmentTags || [])[0] || "未标记环境")}</div>
          <div class="badge-row">
            <span class="badge ${ruleClass}">${ruleText}</span>
            <span class="badge">${STATUS[trade.status] || trade.status}</span>
            ${isReviewComplete(trade) ? `<span class="badge good">完整样本</span>` : `<span class="badge warn">未完整复盘</span>`}
          </div>
        </div>
      </article>
    `;
  }

  async hydrateThumbs(container = document) {
    const nodes = Array.from(container.querySelectorAll("[data-thumb]"));
    await Promise.all(
      nodes.map(async (node) => {
        const id = node.dataset.thumb;
        if (!id) return;
        const record = await getImageRecord(id);
        if (record?.thumbnailDataUrl) {
          node.innerHTML = `<img src="${record.thumbnailDataUrl}" alt="">`;
        }
      })
    );
  }

  openTradeForm({ market = this.activeTab, tradeId = "", stage = "plan", symbol = "" } = {}) {
    const existing = tradeId ? this.state.trades.find((trade) => trade.id === tradeId) : null;
    const draft = !existing && this.state.drafts[market] ? deepClone(this.state.drafts[market]) : null;
    this.formTrade = existing ? deepClone(existing) : draft || createTrade(market, { symbol }, this.state.settings);
    if (symbol) this.formTrade.symbol = symbol;
    this.formStage = stage;
    this.renderTradeForm();
  }

  renderTradeForm() {
    const trade = this.formTrade;
    if (!trade) return;
    const marketLabel = MARKETS[trade.market]?.label || "";
    const templates = this.state.settings.templates || [];
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel fullscreen" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>${trade.id && this.state.trades.some((item) => item.id === trade.id) ? "编辑交易" : "新建交易"}</h3>
              <p>${marketLabel} · 自动保存草稿 · ${escapeHtml(trade.id)}</p>
            </div>
            <div class="row-actions">
              <button class="small-icon-btn" data-action="copy-last" aria-label="复制上一笔">⧉</button>
              <button class="small-icon-btn" data-action="save-template" aria-label="保存模板">☆</button>
              <button class="small-icon-btn" data-action="close-modal" aria-label="关闭">×</button>
            </div>
          </header>
          <div class="modal-body">
            <div class="stage-tabs">
              ${this.stageButton("plan", "入场计划")}
              ${this.stageButton("result", "平仓结果")}
              ${this.stageButton("review", "交易复盘")}
            </div>
            ${templates.length ? this.renderTemplateRow(templates) : ""}
            ${this.formStage === "plan" ? this.renderPlanStage(trade) : ""}
            ${this.formStage === "result" ? this.renderResultStage(trade) : ""}
            ${this.formStage === "review" ? this.renderReviewStage(trade) : ""}
          </div>
          <footer class="modal-footer">
            <button class="ghost-btn" data-action="close-modal">稍后继续</button>
            <button class="primary-btn" data-action="save-trade">保存并退出</button>
          </footer>
        </section>
      </div>
    `;
    this.hydrateThumbs(modalRoot);
  }

  stageButton(stage, label) {
    return `<button class="seg-btn ${this.formStage === stage ? "active" : ""}" data-action="set-stage" data-stage="${stage}">${label}</button>`;
  }

  renderTemplateRow(templates) {
    return `
      <div class="quick-row" style="margin-bottom:12px">
        ${templates
          .map((template) => `<button class="chip" data-action="use-template" data-template-id="${template.id}">模板 ${escapeHtml(template.name)}</button>`)
          .join("")}
      </div>
    `;
  }

  renderPlanStage(trade) {
    const strategy = this.state.strategies.find((item) => item.name === trade.plan.strategy);
    const futuresMeta = this.getFuturesMeta(trade.symbol);
    return `
      <div class="form-grid">
        <div class="form-grid two-col">
          ${this.symbolField(trade)}
          ${this.inputField("tradeDate", "交易日期", trade.tradeDate, "date")}
          ${this.choiceField("direction", "多空方向", DIRECTIONS, trade.direction, "two")}
          ${this.choiceField("status", "当前状态", { planned: "计划中", holding: "持仓中" }, trade.status === "holding" ? "holding" : "planned", "two")}
        </div>

        ${futuresMeta ? `<div class="panel"><strong>${escapeHtml(futuresMeta.name)}</strong><div class="muted">${escapeHtml(futuresMeta.exchange)} · ${escapeHtml(futuresMeta.code)} · 乘数 ${futuresMeta.multiplier} · 最小变动 ${futuresMeta.tick} · ${escapeHtml(futuresMeta.quoteUnit)}</div></div>` : ""}

        ${this.uploadBlock("入场前截图", "entry_before", trade.plan.screenshots)}

        ${this.tagSelect("plan.strategy", "价格行为策略标签", this.strategyNames(), trade.plan.strategy, false)}
        ${strategy ? this.strategyChecklist(strategy, trade.plan.checklist || []) : ""}
        ${this.tagSelect("plan.environmentTags", "市场环境标签", MARKET_ENV_TAGS, trade.plan.environmentTags || [], true)}
        ${this.tagSelect("plan.keyLevelTags", "关键位置标签", KEY_LEVEL_TAGS, trade.plan.keyLevelTags || [], true)}

        <div class="form-grid two-col">
          ${this.inputField("plan.riskAmount", "计划风险金额", trade.plan.riskAmount, "number", "例如 500")}
          ${this.inputField("plan.riskPercent", "风险占账户比例 %", trade.plan.riskPercent, "number", "选填")}
        </div>

        ${this.tagSelect("plan.reasonTags", "入场理由标签", REASON_TAGS, trade.plan.reasonTags || [], true)}
        ${this.textareaField("plan.reasonNote", "入场理由补充", trade.plan.reasonNote, "一句话即可")}

        <details class="advanced">
          <summary>更多信息</summary>
          <div class="form-grid two-col">
            ${this.inputField("account", "账户", trade.account)}
            ${this.inputField("timeframe", "最近使用周期", trade.timeframe)}
            ${this.inputField("plan.advanced.observeTimeframe", "观察周期", trade.plan.advanced.observeTimeframe)}
            ${this.inputField("plan.advanced.entryTimeframe", "入场周期", trade.plan.advanced.entryTimeframe)}
            ${trade.market === "futures" ? this.inputField("plan.advanced.contractMonth", "具体合约月份", trade.plan.advanced.contractMonth, "text", "例如 MA2609") : ""}
            ${trade.market === "btc" ? this.choiceField("plan.advanced.btcTradeType", "现货或合约", { "现货": "现货", "合约": "合约" }, trade.plan.advanced.btcTradeType || "合约", "two") : ""}
            ${this.inputField("plan.advanced.plannedEntry", "计划入场价", trade.plan.advanced.plannedEntry, "number")}
            ${this.inputField("plan.advanced.plannedStop", "计划止损价", trade.plan.advanced.plannedStop, "number")}
            ${this.inputField("plan.advanced.plannedTarget", "计划止盈价", trade.plan.advanced.plannedTarget, "number")}
            ${this.inputField("plan.advanced.plannedRR", "计划盈亏比", trade.plan.advanced.plannedRR, "number")}
          </div>
          ${this.textareaField("plan.advanced.detail", "详细文字说明", trade.plan.advanced.detail)}
          ${this.textareaField("plan.advanced.news", "重要新闻备注", trade.plan.advanced.news)}
          ${this.inputField("plan.advanced.emotion", "情绪状态", trade.plan.advanced.emotion)}
        </details>
      </div>
    `;
  }

  renderResultStage(trade) {
    return `
      <div class="form-grid">
        <div class="form-grid two-col">
          ${this.inputField("result.pnl", "实际净盈亏金额", trade.result.pnl, "number")}
          ${this.choiceField("result.outcome", "交易结果", OUTCOMES, trade.result.outcome, "three")}
          ${this.choiceField("result.followedPlan", "是否完全按原计划执行", { yes: "是", no: "否" }, trade.result.followedPlan, "two")}
          ${this.inputField("result.finalR", "最终 R", trade.result.finalR, "number", "可自动计算或直接输入")}
        </div>
        ${this.uploadBlock("出场后截图", "exit_after", trade.result.exitScreenshots)}
        <details class="advanced">
          <summary>更多信息</summary>
          <div class="form-grid two-col">
            ${this.inputField("result.advanced.actualEntry", "实际入场价", trade.result.advanced.actualEntry, "number")}
            ${this.inputField("result.advanced.actualExit", "实际出场价", trade.result.advanced.actualExit, "number")}
            ${this.inputField("result.advanced.size", "实际持仓数量", trade.result.advanced.size)}
            ${this.inputField("result.advanced.exitReason", "出场原因", trade.result.advanced.exitReason)}
            ${this.checkboxField("result.advanced.earlyProfit", "是否提前止盈", trade.result.advanced.earlyProfit)}
            ${this.checkboxField("result.advanced.movedStop", "是否移动止损", trade.result.advanced.movedStop)}
            ${this.checkboxField("result.advanced.addPosition", "是否加仓", trade.result.advanced.addPosition)}
            ${this.checkboxField("result.advanced.reducePosition", "是否减仓", trade.result.advanced.reducePosition)}
            ${this.checkboxField("result.advanced.unplannedAction", "是否发生计划外操作", trade.result.advanced.unplannedAction)}
            ${this.inputField("result.advanced.margin", "保证金占用比例 %", trade.result.advanced.margin, "number")}
            ${this.inputField("result.advanced.platform", "交易平台", trade.result.advanced.platform)}
            ${this.inputField("result.advanced.leverage", "杠杆倍数", trade.result.advanced.leverage, "number")}
          </div>
        </details>
      </div>
    `;
  }

  renderReviewStage(trade) {
    return `
      <div class="form-grid">
        <div class="form-grid two-col">
          ${this.choiceField("review.goodTrade", "这是不是一笔好交易", { yes: "好交易", no: "坏交易" }, trade.review.goodTrade, "two")}
          ${this.choiceField("review.ruleFollowed", "是否遵守规则", { yes: "遵守", no: "违反" }, trade.review.ruleFollowed, "two")}
        </div>
        ${this.tagSelect("review.maxProblemTags", "最大问题标签", ERROR_TAGS, trade.review.maxProblemTags || [], true)}
        ${this.textareaField("review.sentence", "一句话复盘", trade.review.sentence, "哪里做对了，哪里偏离了计划")}
        ${this.textareaField("review.nextAction", "下次遇到同类行情应该怎么做", trade.review.nextAction)}
        ${this.uploadBlock("复盘标注图", "review_marked", trade.review.annotatedScreenshots || [])}
        <details class="advanced">
          <summary>评分</summary>
          <div class="form-grid two-col">
            ${this.ratingField("review.ratings.strategy", "策略判断", trade.review.ratings.strategy)}
            ${this.ratingField("review.ratings.entry", "入场质量", trade.review.ratings.entry)}
            ${this.ratingField("review.ratings.management", "持仓管理", trade.review.ratings.management)}
            ${this.ratingField("review.ratings.emotion", "情绪控制", trade.review.ratings.emotion)}
            ${this.ratingField("review.ratings.execution", "总体执行", trade.review.ratings.execution)}
          </div>
        </details>
      </div>
    `;
  }

  symbolField(trade) {
    const symbols = this.state.settings.commonSymbols[trade.market] || [];
    return `
      <div class="field">
        <label>品种</label>
        <input data-field="symbol" list="symbolList-${trade.market}" value="${escapeAttr(trade.symbol || "")}" placeholder="选择或输入品种">
        <datalist id="symbolList-${trade.market}">
          ${symbols.map((symbol) => `<option value="${escapeAttr(symbol)}"></option>`).join("")}
        </datalist>
      </div>
    `;
  }

  inputField(path, label, value = "", type = "text", placeholder = "") {
    return `
      <div class="field">
        <label>${label}</label>
        <input data-field="${path}" type="${type}" value="${escapeAttr(value ?? "")}" placeholder="${escapeAttr(placeholder)}" ${type === "number" ? 'inputmode="decimal"' : ""}>
      </div>
    `;
  }

  textareaField(path, label, value = "", placeholder = "") {
    return `
      <div class="field">
        <label>${label}</label>
        <textarea data-field="${path}" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value || "")}</textarea>
      </div>
    `;
  }

  checkboxField(path, label, checked) {
    return `
      <label class="field" style="grid-template-columns:auto 1fr;align-items:center;display:grid">
        <input data-field="${path}" type="checkbox" ${checked ? "checked" : ""} style="width:22px;min-height:22px">
        <span>${label}</span>
      </label>
    `;
  }

  ratingField(path, label, value) {
    return `
      <div class="field">
        <label>${label}</label>
        <select data-field="${path}">
          <option value="">不评分</option>
          ${[1, 2, 3, 4, 5].map((num) => `<option value="${num}" ${String(value) === String(num) ? "selected" : ""}>${num} 分</option>`).join("")}
        </select>
      </div>
    `;
  }

  choiceField(path, label, options, selected, columns = "three") {
    const entries = Object.entries(options);
    return `
      <div class="field">
        <div class="field-label">${label}</div>
        <div class="segmented ${columns}">
          ${entries
            .map(
              ([value, text]) => `
                <button class="seg-btn ${String(selected) === String(value) ? "active" : ""}" data-action="set-choice" data-path="${path}" data-value="${escapeAttr(value)}">${text}</button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  tagSelect(path, label, options, selected, multi) {
    const selectedList = Array.isArray(selected) ? selected : [selected].filter(Boolean);
    return `
      <div class="field">
        <div class="field-label">${label}</div>
        <div class="tag-grid">
          ${options
            .map(
              (option) => `
                <button class="tag-chip ${selectedList.includes(option) ? "active" : ""}" data-action="toggle-tag" data-path="${path}" data-value="${escapeAttr(option)}" data-multi="${multi ? "true" : "false"}">${escapeHtml(option)}</button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  strategyChecklist(strategy, selected) {
    return `
      <div class="panel">
        <div class="split">
          <strong>${escapeHtml(strategy.name)} 检查项</strong>
          <span class="badge">${escapeHtml(strategy.version)}</span>
        </div>
        <div class="tag-grid" style="margin-top:10px">
          ${strategy.mustConditions
            .map(
              (item) => `
                <button class="tag-chip ${selected.includes(item) ? "active" : ""}" data-action="toggle-tag" data-path="plan.checklist" data-value="${escapeAttr(item)}" data-multi="true">${escapeHtml(item)}</button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  uploadBlock(label, category, ids) {
    return `
      <div class="field">
        <div class="field-label">${label}</div>
        <label class="upload-zone" data-drop-category="${category}">
          <input type="file" data-upload="${category}" accept="image/*" multiple capture="environment">
          <strong>上传、粘贴或拖拽图片</strong>
          <span>图片会先保存到本地；列表只加载缩略图</span>
        </label>
        ${this.imageStrip(ids)}
      </div>
    `;
  }

  imageStrip(ids = []) {
    if (!ids.length) return "";
    return `
      <div class="image-strip">
        ${ids
          .map(
            (id) => `
              <div class="image-tile" data-thumb="${id}">
                <div class="image-tile-actions">
                  <button data-action="view-image" data-id="${id}" aria-label="查看">⌕</button>
                  <button data-action="set-cover" data-id="${id}" aria-label="封面">★</button>
                  <button data-action="delete-image" data-id="${id}" aria-label="删除">×</button>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  strategyNames() {
    const names = new Set([...STRATEGY_TAGS, ...this.state.strategies.map((strategy) => strategy.name)]);
    return Array.from(names);
  }

  getFuturesMeta(symbol) {
    if (this.formTrade?.market !== "futures" && this.activeTab !== "futures") return null;
    return this.state.settings.futuresPresets.find((item) => item.name === symbol || item.code === symbol) || null;
  }

  setFormPath(path, value, options = {}) {
    if (!this.formTrade) return;
    setByPath(this.formTrade, path, value);
    if (path === "plan.strategy") {
      const strategy = this.state.strategies.find((item) => item.name === value);
      this.formTrade.plan.strategyVersion = strategy?.version || "1.0";
      this.formTrade.plan.checklist = [];
    }
    this.recalculateFormTrade();
    this.autosaveDraft();
    if (!options.silent) this.renderTradeForm();
  }

  toggleTag(path, value) {
    if (!this.formTrade) return;
    const button = modalRoot.querySelector(`[data-action="toggle-tag"][data-path="${cssEscape(path)}"][data-value="${cssEscape(value)}"]`);
    const multi = button?.dataset.multi === "true";
    const current = getByPath(this.formTrade, path);
    if (multi) {
      const list = Array.isArray(current) ? [...current] : [];
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1);
      else {
        if (value === "无错误") list.splice(0, list.length, value);
        else {
          const noneIndex = list.indexOf("无错误");
          if (noneIndex >= 0) list.splice(noneIndex, 1);
          list.push(value);
        }
      }
      setByPath(this.formTrade, path, list);
    } else {
      setByPath(this.formTrade, path, value);
      if (path === "plan.strategy") {
        const strategy = this.state.strategies.find((item) => item.name === value);
        this.formTrade.plan.strategyVersion = strategy?.version || "1.0";
        this.formTrade.plan.checklist = [];
      }
    }
    this.recalculateFormTrade();
    this.autosaveDraft();
    this.renderTradeForm();
  }

  recalculateFormTrade() {
    const trade = this.formTrade;
    if (!trade) return;
    const entry = toNumber(trade.plan.advanced.plannedEntry);
    const stop = toNumber(trade.plan.advanced.plannedStop);
    const target = toNumber(trade.plan.advanced.plannedTarget);
    if (entry !== null && stop !== null && target !== null && entry !== stop) {
      trade.plan.advanced.plannedRR = (Math.abs(target - entry) / Math.abs(entry - stop)).toFixed(2);
    }
    const pnl = toNumber(trade.result.pnl);
    const risk = toNumber(trade.plan.riskAmount);
    if (pnl !== null && risk && risk !== 0) {
      trade.result.finalR = (pnl / Math.abs(risk)).toFixed(2);
    }
    if (trade.market === "futures") {
      const meta = this.state.settings.futuresPresets.find((item) => item.name === trade.symbol || item.code === trade.symbol);
      trade.plan.advanced.futuresMeta = meta || {};
    }
  }

  updateComputedFields() {
    const rr = modalRoot.querySelector('[data-field="plan.advanced.plannedRR"]');
    if (rr) rr.value = this.formTrade?.plan.advanced.plannedRR || "";
    const finalR = modalRoot.querySelector('[data-field="result.finalR"]');
    if (finalR) finalR.value = this.formTrade?.result.finalR || "";
  }

  autosaveDraft() {
    if (!this.formTrade) return;
    this.formTrade.updatedAt = new Date().toISOString();
    this.state.drafts[this.formTrade.market] = deepClone(this.formTrade);
    this.persist();
  }

  copyLastIntoForm() {
    if (!this.formTrade) return;
    const market = this.formTrade.market;
    const last = this.state.trades
      .filter((trade) => !trade.deletedAt && trade.market === market)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!last) {
      this.toast("没有可复制的上一笔交易");
      return;
    }
    const keep = {
      id: this.formTrade.id,
      createdAt: this.formTrade.createdAt,
      updatedAt: new Date().toISOString(),
      tradeDate: this.formTrade.tradeDate,
      status: "planned",
      result: this.formTrade.result,
      review: this.formTrade.review
    };
    this.formTrade = {
      ...deepClone(last),
      ...keep,
      plan: {
        ...deepClone(last.plan),
        screenshots: []
      },
      coverImageId: ""
    };
    this.autosaveDraft();
    this.renderTradeForm();
    this.toast("已复制上一笔的常用信息");
  }

  applyTemplate(templateId) {
    if (!this.formTrade) return;
    const template = this.state.settings.templates.find((item) => item.id === templateId);
    if (!template) return;
    this.formTrade = {
      ...this.formTrade,
      symbol: template.symbol || this.formTrade.symbol,
      direction: template.direction || this.formTrade.direction,
      timeframe: template.timeframe || this.formTrade.timeframe,
      account: template.account || this.formTrade.account,
      plan: {
        ...this.formTrade.plan,
        ...deepClone(template.plan),
        screenshots: this.formTrade.plan.screenshots
      }
    };
    this.autosaveDraft();
    this.renderTradeForm();
  }

  saveCurrentAsTemplate() {
    if (!this.formTrade) return;
    const name = `${this.formTrade.symbol || "交易"} · ${this.formTrade.plan.strategy || "策略"}`;
    const template = {
      id: uid("template"),
      name,
      market: this.formTrade.market,
      symbol: this.formTrade.symbol,
      direction: this.formTrade.direction,
      timeframe: this.formTrade.timeframe,
      account: this.formTrade.account,
      plan: {
        strategy: this.formTrade.plan.strategy,
        strategyVersion: this.formTrade.plan.strategyVersion,
        checklist: [],
        environmentTags: this.formTrade.plan.environmentTags,
        keyLevelTags: this.formTrade.plan.keyLevelTags,
        reasonTags: this.formTrade.plan.reasonTags,
        riskAmount: this.formTrade.plan.riskAmount,
        riskPercent: this.formTrade.plan.riskPercent,
        reasonNote: "",
        advanced: this.formTrade.plan.advanced
      },
      createdAt: new Date().toISOString()
    };
    this.state.settings.templates.unshift(template);
    this.persist();
    this.toast("已保存为模板");
    this.renderTradeForm();
  }

  async handleFiles(files, category) {
    if (!files?.length || !this.formTrade) return;
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!list.length) {
      this.toast("请选择图片文件");
      return;
    }
    for (const file of list) {
      const record = await storeImageFile(file, {
        tradeId: this.formTrade.id,
        category,
        isCover: !this.formTrade.coverImageId
      });
      this.addImageToForm(category, record.id);
    }
    this.autosaveDraft();
    this.renderTradeForm();
    this.toast(`已保存 ${list.length} 张图片`);
  }

  addImageToForm(category, imageId) {
    const trade = this.formTrade;
    if (category === "entry_before" || category === "entry_plan" || category === "holding") {
      trade.plan.screenshots = unique([...trade.plan.screenshots, imageId]);
    } else if (category === "exit_after") {
      trade.result.exitScreenshots = unique([...trade.result.exitScreenshots, imageId]);
    } else {
      trade.review.annotatedScreenshots = unique([...(trade.review.annotatedScreenshots || []), imageId]);
    }
    if (!trade.coverImageId) trade.coverImageId = imageId;
  }

  async removeImage(imageId) {
    if (!this.formTrade) return;
    this.formTrade.plan.screenshots = (this.formTrade.plan.screenshots || []).filter((id) => id !== imageId);
    this.formTrade.result.exitScreenshots = (this.formTrade.result.exitScreenshots || []).filter((id) => id !== imageId);
    this.formTrade.review.annotatedScreenshots = (this.formTrade.review.annotatedScreenshots || []).filter((id) => id !== imageId);
    if (this.formTrade.coverImageId === imageId) {
      this.formTrade.coverImageId = this.formTrade.plan.screenshots[0] || this.formTrade.result.exitScreenshots[0] || this.formTrade.review.annotatedScreenshots?.[0] || "";
    }
    await deleteImageRecord(imageId);
    this.autosaveDraft();
    this.renderTradeForm();
  }

  async setCover(imageId) {
    if (!this.formTrade) return;
    this.formTrade.coverImageId = imageId;
    const record = await getImageRecord(imageId);
    if (record) {
      record.isCover = true;
      await putImageRecord(record);
    }
    this.autosaveDraft();
    this.toast("已设为封面图");
  }

  saveTradeAndClose() {
    if (!this.formTrade) return;
    const trade = deepClone(this.formTrade);
    trade.updatedAt = new Date().toISOString();
    trade.status = this.deriveStatus(trade);

    const existingIndex = this.state.trades.findIndex((item) => item.id === trade.id);
    if (existingIndex >= 0) this.state.trades[existingIndex] = trade;
    else this.state.trades.unshift(trade);

    this.state.drafts[trade.market] = null;
    this.updateRecentFromTrade(trade);
    this.persist();
    this.closeModal();
    this.render();
    this.toast("交易已保存");
  }

  deriveStatus(trade) {
    if (this.formStage === "plan") return trade.status === "holding" ? "holding" : "planned";
    if (isReviewComplete(trade)) return "completed";
    if (trade.result?.pnl !== "" || trade.result?.outcome || trade.result?.exitScreenshots?.length) return "pending_review";
    return trade.status || "planned";
  }

  updateRecentFromTrade(trade) {
    const recent = this.state.settings.recent;
    recent.account = trade.account || recent.account;
    recent.timeframe = trade.timeframe || recent.timeframe;
    recent.strategy = trade.plan.strategy || recent.strategy;
    recent.riskAmount = trade.plan.riskAmount || recent.riskAmount;
    recent.riskPercent = trade.plan.riskPercent || recent.riskPercent;
    if (trade.market === "futures" && trade.symbol && trade.plan.advanced.contractMonth) {
      recent.futuresContracts[trade.symbol] = trade.plan.advanced.contractMonth;
    }
    const common = this.state.settings.commonSymbols[trade.market] || [];
    if (trade.symbol && !common.includes(trade.symbol)) {
      common.unshift(trade.symbol);
      this.state.settings.commonSymbols[trade.market] = common.slice(0, 12);
    }
  }

  openDetail(tradeId) {
    const trade = this.state.trades.find((item) => item.id === tradeId);
    if (!trade) return;
    this.detailTradeId = tradeId;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel fullscreen" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>${escapeHtml(trade.symbol)} · ${DIRECTIONS[trade.direction]}</h3>
              <p>${MARKETS[trade.market]?.label} · ${escapeHtml(trade.tradeDate || "")} · ${STATUS[trade.status]}</p>
            </div>
            <div class="row-actions">
              <button class="small-icon-btn" data-action="edit-trade" data-id="${trade.id}" aria-label="编辑">✎</button>
              <button class="small-icon-btn" data-action="close-modal" aria-label="关闭">×</button>
            </div>
          </header>
          <div class="modal-body">
            ${this.renderTradeTimeline(trade)}
          </div>
          <footer class="modal-footer">
            <button class="danger-btn" data-action="delete-trade" data-id="${trade.id}">移入回收站</button>
            <button class="primary-btn" data-action="edit-trade" data-id="${trade.id}" data-stage="${this.nextStageForTrade(trade)}">继续记录</button>
          </footer>
        </section>
      </div>
    `;
    this.hydrateThumbs(modalRoot);
  }

  nextStageForTrade(trade) {
    if (!trade.result?.pnl && !trade.result?.outcome) return "result";
    if (!isReviewComplete(trade)) return "review";
    return "plan";
  }

  renderTradeTimeline(trade) {
    const followed = effectiveRuleFollowed(trade);
    const good = effectiveGoodTrade(trade);
    return `
      <div class="timeline">
        <section class="timeline-item">
          <h4>1. 市场背景</h4>
          <div class="badge-row">
            ${(trade.plan.environmentTags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("") || `<span class="badge warn">未标记环境</span>`}
            ${(trade.plan.keyLevelTags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </section>
        <section class="timeline-item">
          <h4>2. 入场前计划</h4>
          <div class="kv-grid">
            ${this.kv("策略", `${trade.plan.strategy || "--"} v${trade.plan.strategyVersion || "--"}`)}
            ${this.kv("计划风险", trade.plan.riskAmount ? formatMoney(trade.plan.riskAmount) : "--")}
            ${this.kv("计划 R/R", trade.plan.advanced.plannedRR || "--")}
            ${this.kv("账户/周期", `${trade.account || "--"} · ${trade.timeframe || "--"}`)}
          </div>
          <p>${escapeHtml(trade.plan.reasonNote || "未写入场理由补充")}</p>
          <div class="badge-row">${(trade.plan.reasonTags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}</div>
        </section>
        <section class="timeline-item">
          <h4>3. 入场截图</h4>
          ${this.imageStrip(trade.plan.screenshots || []) || `<p>未上传入场截图</p>`}
        </section>
        <section class="timeline-item">
          <h4>4. 实际成交</h4>
          <div class="kv-grid">
            ${this.kv("实际入场", trade.result.advanced.actualEntry || "--")}
            ${this.kv("实际出场", trade.result.advanced.actualExit || "--")}
            ${this.kv("数量", trade.result.advanced.size || "--")}
            ${this.kv("滑点", this.slippageText(trade))}
          </div>
        </section>
        <section class="timeline-item">
          <h4>5. 持仓管理</h4>
          <div class="badge-row">
            ${trade.result.advanced.earlyProfit ? `<span class="badge warn">提前止盈</span>` : ""}
            ${trade.result.advanced.movedStop ? `<span class="badge warn">移动止损</span>` : ""}
            ${trade.result.advanced.addPosition ? `<span class="badge">加仓</span>` : ""}
            ${trade.result.advanced.reducePosition ? `<span class="badge">减仓</span>` : ""}
            ${trade.result.advanced.unplannedAction ? `<span class="badge bad">计划外操作</span>` : ""}
            ${!trade.result.advanced.earlyProfit && !trade.result.advanced.movedStop && !trade.result.advanced.unplannedAction ? `<span class="badge good">无明显计划外管理</span>` : ""}
          </div>
        </section>
        <section class="timeline-item">
          <h4>6. 出场结果</h4>
          <div class="kv-grid">
            ${this.kv("净盈亏", formatMoney(getTradePnl(trade)))}
            ${this.kv("最终 R", getTradeR(trade) !== null ? formatR(getTradeR(trade)) : "--")}
            ${this.kv("结果", OUTCOMES[trade.result.outcome] || "--")}
            ${this.kv("按计划执行", followed === null ? "--" : followed ? "是" : "否")}
          </div>
        </section>
        <section class="timeline-item">
          <h4>7. 出场截图</h4>
          ${this.imageStrip(trade.result.exitScreenshots || []) || `<p>未上传出场截图</p>`}
        </section>
        <section class="timeline-item">
          <h4>8. 执行质量</h4>
          <div class="kv-grid">
            ${this.kv("好交易", good === null ? "--" : good ? "是" : "否")}
            ${this.kv("遵守规则", followed === null ? "--" : followed ? "是" : "否")}
            ${this.kv("完整样本", isReviewComplete(trade) ? "是" : "否")}
            ${this.kv("状态", STATUS[trade.status])}
          </div>
        </section>
        <section class="timeline-item">
          <h4>9. 错误标签</h4>
          <div class="badge-row">${(trade.review.maxProblemTags || []).map((tag) => `<span class="badge ${tag === "无错误" ? "good" : "bad"}">${escapeHtml(tag)}</span>`).join("") || `<span class="badge warn">未标记</span>`}</div>
        </section>
        <section class="timeline-item">
          <h4>10. 复盘结论</h4>
          <p>${escapeHtml(trade.review.sentence || "未完成一句话复盘")}</p>
          <p><strong>下次：</strong>${escapeHtml(trade.review.nextAction || "未填写")}</p>
          ${this.imageStrip(trade.review.annotatedScreenshots || [])}
        </section>
      </div>
    `;
  }

  kv(label, value) {
    return `<div class="kv"><span>${label}</span><strong>${escapeHtml(String(value ?? "--"))}</strong></div>`;
  }

  slippageText(trade) {
    const planned = toNumber(trade.plan.advanced.plannedEntry);
    const actual = toNumber(trade.result.advanced.actualEntry);
    if (planned === null || actual === null) return "--";
    const slip = trade.direction === "long" ? actual - planned : planned - actual;
    return slip.toFixed(2);
  }

  moveToTrash(tradeId) {
    const index = this.state.trades.findIndex((trade) => trade.id === tradeId);
    if (index < 0) return;
    const trade = this.state.trades[index];
    trade.deletedAt = new Date().toISOString();
    this.state.trash.unshift(trade);
    this.state.trades.splice(index, 1);
    this.persist();
    this.closeModal();
    this.render();
    this.toast("已移入回收站");
  }

  restoreTrade(tradeId) {
    const index = this.state.trash.findIndex((trade) => trade.id === tradeId);
    if (index < 0) return;
    const trade = this.state.trash[index];
    trade.deletedAt = "";
    this.state.trades.unshift(trade);
    this.state.trash.splice(index, 1);
    this.persist();
    this.openDataSheet();
    this.render();
    this.toast("已恢复交易");
  }

  openFilterSheet(scope = this.activeTab) {
    const filters = this.filters[scope] || {};
    const market = scope === "summary" ? filters.market || "all" : scope;
    const symbols = market === "all" ? allSymbols(this.state.trades) : this.state.settings.commonSymbols[market] || allSymbols(this.state.trades.filter((trade) => trade.market === market));
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>搜索与筛选</h3>
              <p>组合条件会显示为可删除标签</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal" aria-label="关闭">×</button>
          </header>
          <div class="modal-body">
            <div class="form-grid two-col">
              ${scope === "summary" ? this.selectField("market", "市场", { all: "全部", futures: "期货", fx: "黄金外汇", btc: "BTC" }, filters.market || "all", "data-filter-field") : ""}
              ${this.inputFilter("startDate", "开始日期", filters.startDate, "date")}
              ${this.inputFilter("endDate", "结束日期", filters.endDate, "date")}
              ${this.selectField("symbol", "品种", optionMap(symbols), filters.symbol, "data-filter-field", true)}
              ${this.selectField("strategy", "策略", optionMap(this.strategyNames()), filters.strategy, "data-filter-field", true)}
              ${this.selectField("direction", "多空方向", DIRECTIONS, filters.direction, "data-filter-field", true)}
              ${this.selectField("outcome", "盈利或亏损", OUTCOMES, filters.outcome, "data-filter-field", true)}
              ${this.selectField("ruleFollowed", "是否遵守规则", { yes: "是", no: "否" }, filters.ruleFollowed, "data-filter-field", true)}
              ${this.selectField("goodTrade", "好交易或坏交易", { yes: "好交易", no: "坏交易" }, filters.goodTrade, "data-filter-field", true)}
              ${this.selectField("errorTag", "错误标签", optionMap(ERROR_TAGS), filters.errorTag, "data-filter-field", true)}
              ${this.selectField("environment", "市场环境", optionMap(MARKET_ENV_TAGS), filters.environment, "data-filter-field", true)}
              ${this.selectField("reviewComplete", "是否完成复盘", { yes: "完整", no: "未完整" }, filters.reviewComplete, "data-filter-field", true)}
              ${this.inputFilter("timeframe", "交易周期", filters.timeframe)}
            </div>
            <div class="field" style="margin-top:12px">
              <label>筛选方案名称</label>
              <input id="filterPresetName" placeholder="例如 黄金假突破" value="">
            </div>
            ${this.renderSavedFilters(scope)}
          </div>
          <footer class="modal-footer">
            <button class="ghost-btn" data-action="save-filter" data-scope="${scope}">保存筛选</button>
            <button class="primary-btn" data-action="apply-filter" data-scope="${scope}">应用</button>
          </footer>
        </section>
      </div>
    `;
  }

  inputFilter(key, label, value = "", type = "text") {
    return `
      <div class="field">
        <label>${label}</label>
        <input data-filter-field="${key}" type="${type}" value="${escapeAttr(value || "")}">
      </div>
    `;
  }

  selectField(key, label, options, selected = "", attr = "data-field", allowEmpty = false) {
    return `
      <div class="field">
        <label>${label}</label>
        <select ${attr}="${key}">
          ${allowEmpty ? `<option value="">不限</option>` : ""}
          ${Object.entries(options)
            .map(([value, text]) => `<option value="${escapeAttr(value)}" ${String(selected || "") === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`)
            .join("")}
        </select>
      </div>
    `;
  }

  renderSavedFilters(scope) {
    const saved = (this.state.settings.savedFilters || []).filter((item) => item.scope === scope || scope === "summary");
    if (!saved.length) return "";
    return `
      <div class="section-head"><h2>常用筛选</h2></div>
      <div class="quick-row">
        ${saved.map((item) => `<button class="chip" data-action="load-filter" data-id="${item.id}">${escapeHtml(item.name)}</button>`).join("")}
      </div>
    `;
  }

  applyFilterForm(scope) {
    const filters = {};
    modalRoot.querySelectorAll("[data-filter-field]").forEach((input) => {
      if (input.value) filters[input.dataset.filterField] = input.value;
    });
    if (scope === "summary" && !filters.market) filters.market = "all";
    this.filters[scope] = filters;
    this.closeModal();
    this.render();
  }

  saveFilterPreset(scope) {
    const name = modalRoot.querySelector("#filterPresetName")?.value?.trim();
    if (!name) {
      this.toast("请先填写筛选方案名称");
      return;
    }
    const filters = {};
    modalRoot.querySelectorAll("[data-filter-field]").forEach((input) => {
      if (input.value) filters[input.dataset.filterField] = input.value;
    });
    this.state.settings.savedFilters.unshift({ id: uid("filter"), name, scope, filters });
    this.persist();
    this.toast("筛选方案已保存");
    this.openFilterSheet(scope);
  }

  loadFilterPreset(id) {
    const preset = this.state.settings.savedFilters.find((item) => item.id === id);
    if (!preset) return;
    this.filters[preset.scope] = deepClone(preset.filters);
    this.closeModal();
    this.render();
  }

  renderSummaryPage() {
    const trades = this.visibleTrades("summary");
    const stats = computeStats(trades);
    this.lastSummary = { trades, stats };
    return `
      <header class="topbar">
        <div>
          <p class="eyebrow">资金成绩单 + 执行质量成绩单</p>
          <h1>汇总数据</h1>
          <p class="eyebrow">样本 ${stats.sampleCount} 笔 · 完整复盘 ${stats.completedSampleCount} 笔</p>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" data-action="open-filter" data-scope="summary" aria-label="筛选">⌕</button>
          <button class="icon-btn" data-action="open-data" aria-label="数据">⋯</button>
        </div>
      </header>

      <div class="quick-row">
        ${[
          ["all", "全部"],
          ["futures", "期货"],
          ["fx", "黄金外汇"],
          ["btc", "BTC"]
        ]
          .map(
            ([market, label]) => `
              <button class="chip ${(this.filters.summary.market || "all") === market ? "active" : ""}" data-action="apply-summary-market" data-market="${market}">${label}</button>
            `
          )
          .join("")}
      </div>
      ${this.renderFilterChips("summary")}

      <section class="metric-grid">
        ${this.metric("总交易次数", `${stats.money.count}`, null, "有结果样本")}
        ${this.metric("净盈亏", formatMoney(stats.money.netPnl), stats.money.netPnl)}
        ${this.metric("累计 R", formatR(stats.money.cumulativeR), stats.money.cumulativeR)}
        ${this.metric("胜率", percent(stats.money.winRate), null)}
        ${this.metric("平均盈利 R", stats.money.avgWinR === null ? "--" : formatR(stats.money.avgWinR), stats.money.avgWinR)}
        ${this.metric("平均亏损 R", stats.money.avgLossR === null ? "--" : `-${formatR(stats.money.avgLossR).replace("+", "")}`, -stats.money.avgLossR)}
        ${this.metric("盈亏比", stats.money.rrRatio === null ? "--" : stats.money.rrRatio.toFixed(2), stats.money.rrRatio)}
        ${this.metric("盈利因子", stats.money.profitFactor === Infinity ? "∞" : stats.money.profitFactor === null ? "--" : stats.money.profitFactor.toFixed(2), stats.money.profitFactor)}
        ${this.metric("单笔期望值", stats.money.expectancy === null ? "--" : formatR(stats.money.expectancy), stats.money.expectancy)}
        ${this.metric("最大回撤", formatMoney(stats.money.maxDrawdown), stats.money.maxDrawdown)}
        ${this.metric("最大连续亏损", `${stats.money.maxLossStreak}`, -stats.money.maxLossStreak)}
        ${this.metric("当前连续状态", this.currentStreakText(stats.money.currentStreak), null)}
      </section>

      <section class="metric-grid">
        ${this.metric("规则遵守率", percent(stats.quality.ruleCompliance), null)}
        ${this.metric("好交易占比", percent(stats.quality.goodTradeRate), null)}
        ${this.metric("违规交易数量", `${stats.quality.violationCount}`, -stats.quality.violationCount)}
        ${this.metric("违规交易累计损失", formatR(stats.quality.violationLossR), stats.quality.violationLossR)}
        ${this.metric("冲动交易次数", `${stats.quality.impulseCount}`, -stats.quality.impulseCount)}
        ${this.metric("提前止盈次数", `${stats.quality.earlyProfitCount}`, -stats.quality.earlyProfitCount)}
        ${this.metric("随意移动止损次数", `${stats.quality.movedStopCount}`, -stats.quality.movedStopCount)}
        ${this.metric("计划外操作次数", `${stats.quality.unplannedCount}`, -stats.quality.unplannedCount)}
      </section>

      <section class="panel">
        <div class="split">
          <div>
            <strong>遵守规则的交易结果</strong>
            <div class="metric-value ${stats.quality.obeyR >= 0 ? "positive" : "negative"}">${formatR(stats.quality.obeyR)}</div>
          </div>
          <div>
            <strong>违反规则的交易结果</strong>
            <div class="metric-value ${stats.quality.brokenR >= 0 ? "positive" : "negative"}">${formatR(stats.quality.brokenR)}</div>
          </div>
        </div>
      </section>

      <section class="metric-grid">
        ${this.metric("平均单笔风险比例", stats.capitalUsage.avgRiskPercent === null ? "--" : `${stats.capitalUsage.avgRiskPercent.toFixed(2)}%`, null)}
        ${this.metric("最大单笔风险比例", stats.capitalUsage.maxRiskPercent === null ? "--" : `${stats.capitalUsage.maxRiskPercent.toFixed(2)}%`, null)}
        ${stats.capitalUsage.avgMarginPercent === null ? "" : this.metric("平均保证金占用", `${stats.capitalUsage.avgMarginPercent.toFixed(2)}%`, null)}
        ${stats.capitalUsage.maxMarginPercent === null ? "" : this.metric("最大保证金占用", `${stats.capitalUsage.maxMarginPercent.toFixed(2)}%`, null)}
      </section>

      ${this.renderCharts(stats)}
    `;
  }

  currentStreakText(streak) {
    if (!streak || streak.type === "flat" || !streak.count) return "--";
    return `${streak.type === "win" ? "连续盈利" : "连续亏损"} ${streak.count}`;
  }

  renderCharts(stats) {
    return `
      <section class="summary-grid">
        ${this.chartCanvas("累计收益曲线", "pnl")}
        ${this.chartCanvas("累计 R 曲线", "r")}
        ${this.chartCanvas("回撤曲线", "drawdown")}
        ${this.calendarChart(stats.calendar)}
        ${this.monthlyBarChart(stats.monthlyBars)}
        ${this.groupChart("不同策略表现对比", stats.groups.strategy, "strategy")}
        ${this.groupChart("不同品种表现对比", stats.groups.symbol, "symbol")}
        ${this.groupChart("多单与空单表现对比", stats.groups.direction, "direction")}
        ${this.groupChart("不同市场环境表现对比", stats.groups.environment, "environment")}
        ${this.errorCostChart(stats.quality.errorCost)}
        ${this.complianceTrendChart(stats.complianceTrend)}
      </section>
    `;
  }

  chartCanvas(title, type) {
    return `
      <article class="chart-card">
        <h3>${title}</h3>
        <canvas class="chart-canvas" data-chart="${type}"></canvas>
      </article>
    `;
  }

  monthlyBarChart(rows) {
    return `
      <article class="chart-card">
        <h3>每月盈亏柱状图</h3>
        <div class="bar-list">
          ${rows.length ? rows.map((row) => this.barRow(row.month, row.r, row.ids, `${row.month} 交易`)).join("") : `<div class="empty">暂无月度数据</div>`}
        </div>
      </article>
    `;
  }

  groupChart(title, rows, type) {
    return `
      <article class="chart-card">
        <h3>${title}</h3>
        <div class="bar-list">
          ${rows.length ? rows.slice(0, 8).map((row) => this.barRow(row.label, row.r, row.ids, `${title} · ${row.label}`, row.count)).join("") : `<div class="empty">暂无数据</div>`}
        </div>
      </article>
    `;
  }

  errorCostChart(rows) {
    return `
      <article class="chart-card">
        <h3>错误类型损失排名</h3>
        <div class="bar-list">
          ${rows.length ? rows.slice(0, 10).map((row) => this.barRow(row.tag, row.lossR, [], `${row.tag}`, row.count, "loss")).join("") : `<div class="empty">暂无错误成本样本</div>`}
        </div>
      </article>
    `;
  }

  complianceTrendChart(rows) {
    return `
      <article class="chart-card">
        <h3>规则遵守率变化趋势</h3>
        <canvas class="chart-canvas" data-chart="compliance"></canvas>
      </article>
    `;
  }

  barRow(label, value, ids, title, count = null) {
    const max = Math.max(1, Math.abs(value));
    const width = Math.min(100, Math.max(8, Math.abs(value) / max * 100));
    const negative = value < 0;
    return `
      <div class="bar-row" data-action="open-trade-list" data-ids="${escapeAttr((ids || []).join(","))}" data-title="${escapeAttr(title || label)}">
        <div class="bar-label">${escapeHtml(label)}${count !== null ? ` · ${count}` : ""}</div>
        <div class="bar-track"><div class="bar-fill ${negative ? "neg" : ""}" style="width:${width}%"></div></div>
        <div class="bar-value ${negative ? "negative" : "positive"}">${formatR(value)}</div>
      </div>
    `;
  }

  calendarChart(rows) {
    const now = new Date();
    const month = currentMonthKey();
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const days = new Date(year, monthNumber, 0).getDate();
    const map = new Map(rows.filter((row) => row.date.startsWith(month)).map((row) => [row.date, row]));
    const cells = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push(`<div class="calendar-day empty-day"></div>`);
    for (let day = 1; day <= days; day += 1) {
      const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const row = map.get(date);
      const cls = row ? (row.r >= 0 ? "win" : "loss") : "";
      cells.push(`
        <button class="calendar-day ${cls}" data-action="calendar-day" data-ids="${escapeAttr((row?.ids || []).join(","))}" data-title="${date} 交易" ${row ? "" : "disabled"}>
          <span class="day-num">${day}</span>
          ${row ? `<span class="day-r">${formatR(row.r)}</span>` : ""}
        </button>
      `);
    }
    return `
      <article class="chart-card">
        <h3>每月盈亏日历 · ${month}</h3>
        <div class="calendar-grid">${cells.join("")}</div>
      </article>
    `;
  }

  drawCharts() {
    if (!this.lastSummary) return;
    this.chartAnimations.forEach((frameId) => cancelAnimationFrame(frameId));
    this.chartAnimations.clear();
    const { stats } = this.lastSummary;
    root.querySelectorAll("canvas[data-chart]").forEach((canvas) => {
      const type = canvas.dataset.chart;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.round(rect.width * dpr));
      canvas.height = Math.round(180 * dpr);
      ctx.scale(dpr, dpr);
      if (type === "compliance") this.drawLineChart(canvas, stats.complianceTrend, "rate", { percent: true });
      else this.drawLineChart(canvas, stats.series, type);
    });
  }

  drawLineChart(canvas, rows, key, options = {}) {
    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth || 320;
    const height = 180;
    const drawBase = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = getCss("--border");
      ctx.beginPath();
      ctx.moveTo(12, height - 28);
      ctx.lineTo(width - 10, height - 28);
      ctx.stroke();
    };
    drawBase();
    if (!rows.length) {
      ctx.fillStyle = getCss("--muted");
      ctx.font = "13px -apple-system";
      ctx.fillText("暂无数据", 18, 80);
      return;
    }
    const values = rows.map((row) => Number(row[key] || 0));
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    const points = rows.map((row, index) => {
      const x = 16 + (rows.length === 1 ? 0 : (index / (rows.length - 1)) * (width - 34));
      const y = 16 + ((max - Number(row[key] || 0)) / span) * (height - 48);
      return { x, y, row };
    });
    const last = values[values.length - 1];
    const strokeColor = key === "drawdown" ? getCss("--red") : getCss("--blue");
    const labelText = options.percent ? `${Math.round(last * 100)}%` : key === "pnl" ? formatMoney(last) : formatR(last);
    const drawFrame = (progress) => {
      const revealX = points.length === 1 ? width : 16 + (width - 34) * progress;
      drawBase();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, revealX, height);
      ctx.clip();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = strokeColor;
      points
        .filter((point) => point.x <= revealX || progress >= 1)
        .forEach((point) => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      ctx.save();
      ctx.globalAlpha = Math.min(1, progress * 1.8);
      ctx.fillStyle = getCss("--muted");
      ctx.font = "12px -apple-system";
      ctx.fillText(labelText, 18, 18);
      ctx.restore();
    };
    const duration = prefersReducedMotion() ? 0 : 620;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const progress = duration ? easeOutCubic(Math.min(1, elapsed / duration)) : 1;
      drawFrame(progress);
      if (progress < 1) {
        this.chartAnimations.set(canvas, requestAnimationFrame(tick));
      }
    };
    if (duration) {
      this.chartAnimations.set(canvas, requestAnimationFrame(tick));
    } else {
      drawFrame(1);
    }
    canvas.onclick = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const nearest = points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), points[0]);
      if (!nearest?.row) return;
      if (nearest.row.id) this.openTradeListByIds(nearest.row.id, nearest.row.date);
      else if (nearest.row.ids) this.openTradeListByIds(nearest.row.ids.join(","), nearest.row.month);
    };
  }

  openTradeListByIds(ids = "", title = "交易列表") {
    const idList = String(ids).split(",").filter(Boolean);
    const trades = idList.length
      ? this.state.trades.filter((trade) => idList.includes(trade.id))
      : this.visibleTrades("summary");
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>${escapeHtml(title)}</h3>
              <p>${trades.length} 笔交易</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal">×</button>
          </header>
          <div class="modal-body">
            <div class="trade-list">
              ${trades.length ? trades.map((trade) => this.tradeCard(trade)).join("") : `<div class="empty">没有可追溯交易</div>`}
            </div>
          </div>
        </section>
      </div>
    `;
    this.hydrateThumbs(modalRoot);
  }

  async openImageViewer(imageId) {
    const record = await getImageRecord(imageId);
    if (!record) return;
    this.viewer = {
      imageId,
      record,
      tool: "line",
      shapes: [],
      scale: 1,
      drawing: null,
      pointers: new Map(),
      lastDistance: 0
    };
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel fullscreen" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>${escapeHtml(record.fileName || "交易截图")}</h3>
              <p>${escapeHtml(record.category)} · 原图与标注图分开保存</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal">×</button>
          </header>
          <div class="modal-body">
            <div class="viewer-stage" id="viewerStage">
              <img id="viewerImage" src="${record.originalDataUrl}" alt="">
              <canvas id="annotationCanvas"></canvas>
            </div>
            <div class="viewer-tools">
              ${[
                ["hline", "水平线"],
                ["line", "趋势线"],
                ["rect", "矩形"],
                ["arrow", "箭头"],
                ["text", "文字"],
                ["entry", "入场"],
                ["stop", "止损"],
                ["target", "目标"]
              ]
                .map(([tool, label]) => `<button class="chip ${tool === "line" ? "active" : ""}" data-action="viewer-tool" data-tool="${tool}">${label}</button>`)
                .join("")}
              <button class="chip" data-action="viewer-zoom" data-delta="0.15">放大</button>
              <button class="chip" data-action="viewer-zoom" data-delta="-0.15">缩小</button>
              <button class="primary-btn" data-action="save-annotation">保存标注图</button>
            </div>
          </div>
        </section>
      </div>
    `;
    this.setupAnnotationCanvas();
  }

  setupAnnotationCanvas() {
    const image = modalRoot.querySelector("#viewerImage");
    const canvas = modalRoot.querySelector("#annotationCanvas");
    const stage = modalRoot.querySelector("#viewerStage");
    if (!image || !canvas || !stage) return;
    const resize = () => {
      const rect = image.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      this.redrawAnnotation();
    };
    image.onload = resize;
    setTimeout(resize, 100);
    canvas.addEventListener("pointerdown", (event) => this.annotationPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.annotationPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.annotationPointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.annotationPointerUp(event));
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomViewer(event.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
  }

  setViewerTool(tool) {
    if (!this.viewer) return;
    this.viewer.tool = tool;
    modalRoot.querySelectorAll("[data-action='viewer-tool']").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
  }

  zoomViewer(delta) {
    if (!this.viewer) return;
    this.viewer.scale = Math.min(3, Math.max(0.6, this.viewer.scale + delta));
    const img = modalRoot.querySelector("#viewerImage");
    const canvas = modalRoot.querySelector("#annotationCanvas");
    if (img) img.style.transform = `scale(${this.viewer.scale})`;
    if (canvas) canvas.style.transform = `scale(${this.viewer.scale})`;
  }

  annotationPointerDown(event) {
    if (!this.viewer) return;
    this.viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.viewer.pointers.size === 2) {
      const points = Array.from(this.viewer.pointers.values());
      this.viewer.lastDistance = distance(points[0], points[1]);
      return;
    }
    const point = canvasPoint(event);
    const tool = this.viewer.tool;
    const text = ["text", "entry", "stop", "target"].includes(tool)
      ? tool === "text"
        ? prompt("标注文字", "")
        : tool === "entry"
          ? "入场"
          : tool === "stop"
            ? "止损"
            : "目标"
      : "";
    this.viewer.drawing = { tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, text };
  }

  annotationPointerMove(event) {
    if (!this.viewer) return;
    if (this.viewer.pointers.has(event.pointerId)) this.viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.viewer.pointers.size === 2) {
      const points = Array.from(this.viewer.pointers.values());
      const nextDistance = distance(points[0], points[1]);
      if (this.viewer.lastDistance) this.zoomViewer((nextDistance - this.viewer.lastDistance) / 500);
      this.viewer.lastDistance = nextDistance;
      return;
    }
    if (!this.viewer.drawing) return;
    const point = canvasPoint(event);
    this.viewer.drawing.x2 = point.x;
    this.viewer.drawing.y2 = this.viewer.drawing.tool === "hline" ? this.viewer.drawing.y1 : point.y;
    this.redrawAnnotation();
  }

  annotationPointerUp(event) {
    if (!this.viewer) return;
    this.viewer.pointers.delete(event.pointerId);
    this.viewer.lastDistance = 0;
    if (!this.viewer.drawing) return;
    if (this.viewer.drawing.tool === "text" && !this.viewer.drawing.text) {
      this.viewer.drawing = null;
      return;
    }
    this.viewer.shapes.push(this.viewer.drawing);
    this.viewer.drawing = null;
    this.redrawAnnotation();
  }

  redrawAnnotation() {
    if (!this.viewer) return;
    const canvas = modalRoot.querySelector("#annotationCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    [...this.viewer.shapes, this.viewer.drawing].filter(Boolean).forEach((shape) => drawShape(ctx, shape));
  }

  async saveAnnotation() {
    if (!this.viewer) return;
    const image = modalRoot.querySelector("#viewerImage");
    const overlay = modalRoot.querySelector("#annotationCanvas");
    if (!image || !overlay) return;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / overlay.width;
    const scaleY = canvas.height / overlay.height;
    ctx.save();
    ctx.scale(scaleX, scaleY);
    this.viewer.shapes.forEach((shape) => drawShape(ctx, shape));
    ctx.restore();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const record = await storeImageDataUrl(dataUrl, {
      tradeId: this.formTrade?.id || this.detailTradeId || this.viewer.record.tradeId,
      category: "review_marked",
      fileName: `annotated-${Date.now()}.jpg`
    });
    const trade = this.formTrade || this.state.trades.find((item) => item.id === record.tradeId);
    if (trade) {
      trade.review.annotatedScreenshots = unique([...(trade.review.annotatedScreenshots || []), record.id]);
      if (this.formTrade) this.autosaveDraft();
      else {
        const index = this.state.trades.findIndex((item) => item.id === trade.id);
        if (index >= 0) this.state.trades[index] = trade;
        this.persist();
      }
    }
    this.toast("标注图已另存");
    this.closeModal();
    if (trade?.id) this.openDetail(trade.id);
  }

  renderSummaryMarketButtons() {
    return "";
  }

  openDataSheet() {
    const trash = this.state.trash || [];
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel fullscreen" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>数据、策略与设置</h3>
              <p>版本 ${APP_VERSION} · 最近备份 ${this.state.settings.lastBackupAt || "未备份"}</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal">×</button>
          </header>
          <div class="modal-body">
            <div class="settings-grid">
              <section class="settings-card">
                <h3>远程存储状态</h3>
                <div class="list-compact">
                  <div class="list-row">
                    <strong>D1/R2 尚未配置</strong>
                    <span class="muted">当前账号环境没有可调用的 D1/R2 创建或绑定工具，主数据仍保留在本地版本中，避免破坏现有可运行状态。</span>
                  </div>
                  <div class="list-row">
                    <strong>本地缓存用途</strong>
                    <span class="muted">草稿、待同步队列、少量最近记录、缩略图缓存和界面偏好。</span>
                  </div>
                </div>
              </section>
              <section class="settings-card">
                <h3>备份与导入</h3>
                <div class="form-grid">
                  <button class="primary-btn" data-action="export-backup">完整 ZIP 备份</button>
                  <button class="ghost-btn" data-action="export-csv">导出 CSV 表格</button>
                  <button class="ghost-btn" data-action="trigger-import">合并导入备份</button>
                  <input id="backupImport" type="file" accept=".zip,application/zip" class="hidden">
                </div>
              </section>
              <section class="settings-card">
                <h3>外观</h3>
                <div class="quick-row">
                  ${[
                    ["system", "跟随系统"],
                    ["light", "浅色"],
                    ["dark", "深色"]
                  ]
                    .map(([theme, label]) => `<button class="chip ${this.state.settings.theme === theme ? "active" : ""}" data-action="set-theme" data-theme="${theme}">${label}</button>`)
                    .join("")}
                </div>
              </section>
              <section class="settings-card">
                <div class="split">
                  <h3>策略库</h3>
                  <button class="small-icon-btn" data-action="new-strategy">+</button>
                </div>
                <div class="list-compact">
                  ${this.state.strategies
                    .map(
                      (strategy) => `
                        <div class="list-row">
                          <div class="split">
                            <strong>${escapeHtml(strategy.name)} v${escapeHtml(strategy.version)}</strong>
                            <div class="row-actions">
                              <button class="small-icon-btn" data-action="duplicate-strategy" data-id="${strategy.id}">⧉</button>
                              <button class="small-icon-btn" data-action="open-strategy" data-id="${strategy.id}">✎</button>
                            </div>
                          </div>
                          <span class="muted">${escapeHtml(strategy.description || "")}</span>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </section>
              <section class="settings-card">
                <h3>回收站</h3>
                <div class="list-compact">
                  ${trash.length
                    ? trash
                        .map(
                          (trade) => `
                            <div class="list-row">
                              <div class="split">
                                <strong>${escapeHtml(trade.symbol)} · ${escapeHtml(trade.tradeDate || "")}</strong>
                                <button class="ghost-btn" data-action="restore-trade" data-id="${trade.id}">恢复</button>
                              </div>
                            </div>
                          `
                        )
                        .join("")
                    : `<div class="empty">回收站为空</div>`}
                </div>
              </section>
              <section class="settings-card">
                <h3>期货品种预设库</h3>
                <div class="list-compact">
                  ${this.state.settings.futuresPresets
                    .map((item) => `<div class="list-row"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.code)}</strong><span class="muted">${escapeHtml(item.exchange)} · 乘数 ${item.multiplier} · 最小变动 ${item.tick} · ${escapeHtml(item.quoteUnit)}</span></div>`)
                    .join("")}
                </div>
              </section>
              <section class="settings-card">
                <h3>高级设置</h3>
                <div class="list-compact">
                  <div class="list-row">
                    <strong>费用统计模式</strong>
                    <span class="muted">第一版使用直接输入实际净盈亏</span>
                  </div>
                  <button class="danger-btn" data-action="danger-reset">覆盖清空全部数据</button>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  refreshSettingsSurface() {
    if (this.activeTab === "settings" && !modalRoot.innerHTML.trim()) this.render();
    else this.openDataSheet();
  }

  async checkUpdate() {
    const currentVersion = currentReleaseVersion();
    this.toast("正在检查更新");
    try {
      const response = await fetch(`./version.json?check=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("版本文件读取失败");
      const remote = await response.json();
      const latestVersion = String(remote.version || "").trim();
      if (!latestVersion) throw new Error("版本号为空");

      if (latestVersion === currentVersion) {
        this.toast(`已是最新版本 ${currentVersion}`);
        return;
      }

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
      }

      this.toast(`发现新版本 ${latestVersion}，正在刷新`);
      window.setTimeout(() => {
        window.location.replace(`./?v=${encodeURIComponent(latestVersion)}`);
      }, 700);
    } catch (error) {
      this.toast(error.message || "检查更新失败");
    }
  }

  async exportBackup() {
    const { blob, manifest } = await buildBackupZip();
    const fileName = `价格行为复盘完整备份-${manifest.backupCreatedAt.slice(0, 10)}.zip`;
    downloadBlob(blob, fileName);
    this.state.settings.lastBackupAt = new Date().toLocaleString("zh-CN");
    this.persist();
    this.refreshSettingsSurface();
    this.toast("完整备份已生成");
  }

  async exportCsv() {
    const images = await getAllImages();
    const imageMap = groupImagesByTrade(images);
    const rows = [
      [
        "交易唯一编号",
        "市场",
        "日期",
        "品种",
        "方向",
        "状态",
        "策略",
        "策略版本",
        "市场环境",
        "计划风险金额",
        "实际净盈亏",
        "最终R",
        "是否遵守规则",
        "是否好交易",
        "错误标签",
        "一句话复盘",
        "图片文件名",
        "图片分类",
        "图片相对路径"
      ]
    ];
    this.state.trades.forEach((trade) => {
      const related = imageMap.get(trade.id) || [null];
      related.forEach((image) => {
        rows.push([
          trade.id,
          MARKETS[trade.market]?.label || trade.market,
          trade.tradeDate,
          trade.symbol,
          DIRECTIONS[trade.direction],
          STATUS[trade.status],
          trade.plan.strategy,
          trade.plan.strategyVersion,
          (trade.plan.environmentTags || []).join(";"),
          trade.plan.riskAmount,
          trade.result.pnl,
          getTradeR(trade) ?? "",
          effectiveRuleFollowed(trade) === null ? "" : effectiveRuleFollowed(trade) ? "是" : "否",
          effectiveGoodTrade(trade) === null ? "" : effectiveGoodTrade(trade) ? "是" : "否",
          (trade.review.maxProblemTags || []).join(";"),
          trade.review.sentence,
          image?.fileName || "",
          image?.category || "",
          image ? `images/original/${image.id}.${image.extension || "jpg"}` : ""
        ]);
      });
    });
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), `价格行为复盘交易表-${todayKey()}.csv`);
    this.toast("CSV 已导出");
  }

  async inspectImport(file) {
    try {
      this.pendingInspection = await inspectBackupFile(file);
      const report = this.pendingInspection.report;
      modalRoot.innerHTML = `
        <div class="modal-backdrop">
          <section class="modal-panel" role="dialog" aria-modal="true">
            <header class="modal-header">
              <div class="modal-title">
                <h3>导入前检查</h3>
                <p>${report.compatible ? "数据版本兼容" : "数据版本不兼容"}</p>
              </div>
              <button class="small-icon-btn" data-action="close-modal">×</button>
            </header>
            <div class="modal-body">
              <div class="kv-grid">
                ${this.kv("交易数量", report.tradeCount)}
                ${this.kv("图片数量", report.imageCount)}
                ${this.kv("时间范围", `${report.dateRange.start || "--"} 至 ${report.dateRange.end || "--"}`)}
                ${this.kv("重复交易", report.duplicateTrades)}
                ${this.kv("损坏图片", report.missingImages)}
                ${this.kv("备份版本", this.pendingInspection.manifest.appVersion || "--")}
              </div>
            </div>
            <footer class="modal-footer">
              <button class="ghost-btn" data-action="close-modal">取消</button>
              <button class="primary-btn" data-action="confirm-import" ${report.compatible && report.missingImages === 0 ? "" : "disabled"}>合并导入</button>
            </footer>
          </section>
        </div>
      `;
    } catch (error) {
      this.toast(error.message || "备份检查失败");
    }
  }

  async confirmImport() {
    if (!this.pendingInspection) return;
    try {
      const result = await mergeImportBackup(this.pendingInspection);
      this.state = loadState();
      this.closeModal();
      this.render();
      this.toast(`已导入 ${result.importedTrades} 笔交易`);
    } catch (error) {
      this.toast(error.message || "导入失败");
    }
  }

  openStrategyEditor(id) {
    const strategy =
      id === "new"
        ? {
            id: uid("strategy"),
            name: "新策略",
            version: "1.0",
            description: "",
            applicableEnv: [],
            mustConditions: [],
            forbiddenConditions: [],
            entrySignal: "",
            stopRule: "",
            exitRule: "",
            goodCaseImages: [],
            badCaseImages: []
          }
        : deepClone(this.state.strategies.find((item) => item.id === id));
    if (!strategy) return;
    this.strategyDraft = strategy;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel fullscreen" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>策略库</h3>
              <p>历史交易会保存当时的策略版本</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal">×</button>
          </header>
          <div class="modal-body">
            <div class="form-grid two-col">
              ${this.strategyInput("name", "策略名称", strategy.name)}
              ${this.strategyInput("version", "策略版本号", strategy.version)}
            </div>
            ${this.strategyTextarea("description", "简短说明", strategy.description)}
            ${this.strategyTextarea("applicableEnv", "适用市场环境", (strategy.applicableEnv || []).join("\n"))}
            ${this.strategyTextarea("mustConditions", "必须满足的条件", (strategy.mustConditions || []).join("\n"))}
            ${this.strategyTextarea("forbiddenConditions", "禁止入场的条件", (strategy.forbiddenConditions || []).join("\n"))}
            ${this.strategyTextarea("entrySignal", "入场信号", strategy.entrySignal)}
            ${this.strategyTextarea("stopRule", "止损原则", strategy.stopRule)}
            ${this.strategyTextarea("exitRule", "出场原则", strategy.exitRule)}
          </div>
          <footer class="modal-footer">
            <button class="ghost-btn" data-action="open-data">返回</button>
            <button class="primary-btn" data-action="save-strategy">保存策略</button>
          </footer>
        </section>
      </div>
    `;
  }

  strategyInput(key, label, value) {
    return `<div class="field"><label>${label}</label><input data-strategy-field="${key}" value="${escapeAttr(value || "")}"></div>`;
  }

  strategyTextarea(key, label, value) {
    return `<div class="field" style="margin-top:12px"><label>${label}</label><textarea data-strategy-field="${key}">${escapeHtml(value || "")}</textarea></div>`;
  }

  updateStrategyDraftFromDom() {
    if (!this.strategyDraft) return;
    modalRoot.querySelectorAll("[data-strategy-field]").forEach((input) => {
      const key = input.dataset.strategyField;
      const multi = ["applicableEnv", "mustConditions", "forbiddenConditions"].includes(key);
      this.strategyDraft[key] = multi ? input.value.split("\n").map((item) => item.trim()).filter(Boolean) : input.value;
    });
  }

  saveStrategyEditor() {
    this.updateStrategyDraftFromDom();
    const index = this.state.strategies.findIndex((item) => item.id === this.strategyDraft.id);
    if (index >= 0) this.state.strategies[index] = this.strategyDraft;
    else this.state.strategies.unshift(this.strategyDraft);
    this.persist();
    this.toast("策略已保存");
    this.openDataSheet();
  }

  duplicateStrategy(id) {
    const original = this.state.strategies.find((item) => item.id === id);
    if (!original) return;
    const copy = deepClone(original);
    copy.id = uid("strategy");
    copy.name = `${copy.name} 副本`;
    this.state.strategies.unshift(copy);
    this.persist();
    this.openDataSheet();
  }

  openResetConfirm() {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal-panel" role="dialog" aria-modal="true">
          <header class="modal-header">
            <div class="modal-title">
              <h3>危险操作</h3>
              <p>覆盖清空会删除交易、草稿、回收站和本地图片</p>
            </div>
            <button class="small-icon-btn" data-action="close-modal">×</button>
          </header>
          <div class="modal-body">
            <p class="muted">这是高级设置中的覆盖操作。请先导出完整备份，再执行清空。</p>
          </div>
          <footer class="modal-footer">
            <button class="ghost-btn" data-action="open-data">取消</button>
            <button class="danger-btn" data-action="confirm-reset">确认清空</button>
          </footer>
        </section>
      </div>
    `;
  }

  async resetAllData() {
    const { clearAllImages } = await import("./storage.js");
    await clearAllImages();
    replaceState(undefined);
    this.state = loadState();
    this.closeModal();
    this.render();
    this.toast("全部数据已清空");
  }

  closeModal() {
    const closingNode = modalRoot.firstElementChild;
    this.formTrade = null;
    this.strategyDraft = null;
    this.viewer = null;
    if (!closingNode) {
      modalRoot.innerHTML = "";
      return;
    }
    closingNode.classList.add("is-closing");
    window.setTimeout(() => {
      if (modalRoot.firstElementChild === closingNode) modalRoot.innerHTML = "";
    }, 460);
  }
}

function setByPath(object, path, value) {
  const parts = path.split(".");
  let cursor = object;
  while (parts.length > 1) {
    const key = parts.shift();
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[0]] = value;
}

function getByPath(object, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], object);
}

function currentReleaseVersion() {
  return document.querySelector('meta[name="version"]')?.content || APP_VERSION;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function optionMap(values) {
  return values.reduce((map, value) => {
    map[value] = value;
    return map;
  }, {});
}

function allSymbols(trades) {
  return unique(trades.map((trade) => trade.symbol).filter(Boolean));
}

function groupImagesByTrade(images) {
  const map = new Map();
  images.forEach((image) => {
    if (!map.has(image.tradeId)) map.set(image.tradeId, []);
    map.get(image.tradeId).push(image);
  });
  return map;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function canvasPoint(event) {
  const canvas = event.target;
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function drawShape(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = shape.tool === "stop" ? "#ef4444" : shape.tool === "target" ? "#2dbf63" : shape.tool === "entry" ? "#0a84ff" : "#ffcc00";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shape.tool === "rect") {
    ctx.strokeRect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
  } else if (["text", "entry", "stop", "target"].includes(shape.tool)) {
    ctx.font = "bold 18px -apple-system";
    ctx.fillText(shape.text || "", shape.x1, shape.y1);
  } else {
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();
    if (shape.tool === "arrow") {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
      const size = 12;
      ctx.beginPath();
      ctx.moveTo(shape.x2, shape.y2);
      ctx.lineTo(shape.x2 - size * Math.cos(angle - Math.PI / 6), shape.y2 - size * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(shape.x2 - size * Math.cos(angle + Math.PI / 6), shape.y2 - size * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

new PriceActionReviewApp();
