const sourceData = window.REORDER_DATA || { styles: [] };
const imageMap = window.WHOAU_IMAGE_MAP?.images || {};

const ITEM_GROUPS = [
  { id: "all", label: "전체", codes: null },
  { id: "outer", label: "아우터", codes: ["JD", "JE", "JJ", "JK", "JL", "JP", "JT", "JW", "VW"] },
  { id: "knitTop", label: "다이마루 상의", codes: ["HA", "HS", "HW", "LA", "LS", "LW", "MA", "MH", "MW", "MZ", "RA", "RN", "RP", "RS", "RW"] },
  { id: "sweater", label: "스웨터", codes: ["CK", "KA", "KV", "KW"] },
  { id: "shirt", label: "셔츠", codes: ["BL", "YA", "YC", "YJ", "YS", "YW"] },
  { id: "bottom", label: "하의", codes: ["TA", "TC", "TH", "TJ", "TM"] },
  { id: "skirt", label: "스커트(원피스)", codes: ["OJ", "OM", "ON", "OW", "WH", "WJ", "WK", "WM"] },
  { id: "knitBottom", label: "다이마루 하의", codes: ["TM"] },
  { id: "wovenBottom", label: "우븐 하의", codes: ["TA", "TC", "TH"] },
  { id: "denimBottom", label: "데님 하의", codes: ["TJ"] },
  { id: "goods", label: "잡화", codes: ["AB", "AC", "AG", "AK", "AM", "AP", "AQ", "AR", "AW", "AY", "BG", "BM", "HM", "PG", "PP"] },
];

const SEASON_FILTERS = [
  { id: "all", label: "전체" },
  { id: "G1", label: "G1" },
  { id: "G2", label: "G2" },
  { id: "G3", label: "G3" },
  { id: "G4", label: "G4" },
];

const CHANNEL_FILTERS = [
  { id: "all", label: "전체" },
  { id: "offline", label: "오프라인" },
  { id: "online", label: "온라인" },
  { id: "buyer", label: "면세" },
];

const CHANNEL_METRICS = new Set(["weeklyQty", "weeklyAmount"]);
const TOP_LIMIT = 20;

const state = {
  selectedCategory: "all",
  selectedSeason: "all",
  selectedChannel: "all",
  metric: "weeklyQty",
  query: "",
  detailStyleCode: "",
};

const numberFormat = new Intl.NumberFormat("ko-KR");
const moneyFormat = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const byStyle = new Map((sourceData.styles || []).map((style) => [style.styleCode, style]));

function compactMoney(value) {
  const amount = Number(value || 0);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}백만`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}만`;
  return moneyFormat.format(Math.round(amount));
}

const METRICS = {
  weeklyQty: {
    label: "주판량",
    totalLabel: "주판량 합계",
    unit: "pcs",
    subtitle: "전 주 월요일부터 일요일까지 판매 수량 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => channelValue(row, "qty"),
    total: (rows) => rows.reduce((sum, row) => sum + channelValue(row, "qty"), 0),
    format: (value) => numberFormat.format(Math.round(Number(value || 0))),
    subText: (row) => state.selectedChannel === "all" ? moneyFormat.format(row.weeklySalesAmount || row.weeklyQty * Number(row.price || 0)) : compactMoney(channelValue(row, "amount")),
  },
  weeklyAmount: {
    label: "주판액",
    totalLabel: "주판액 합계",
    unit: "",
    subtitle: "전 주 월요일부터 일요일까지 판매 금액 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => channelValue(row, "amount"),
    total: (rows) => rows.reduce((sum, row) => sum + channelValue(row, "amount"), 0),
    format: (value) => compactMoney(value),
    subText: (row) => `${numberFormat.format(row.weeklyQty)}pcs · 주판율 ${percent(row.weeklySalesAmount, row.inboundAmount)}`,
  },
  weeklyRate: {
    label: "주판율",
    totalLabel: "평균 주판율",
    unit: "%",
    subtitle: "전 주 판매액을 입고액으로 나눈 비율 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => row.weeklyRate,
    total: (rows) => safeDivide(
      rows.reduce((sum, row) => sum + Number(row.weeklySalesAmount || 0), 0),
      rows.reduce((sum, row) => sum + inboundAmountFor(row), 0),
    ),
    format: (value) => `${(Number(value || 0) * 100).toFixed(1)}`,
    subText: (row) => `${compactMoney(row.weeklySalesAmount)} / 입고액 ${compactMoney(row.inboundAmount)}`,
  },
  normalQty: {
    label: "정판량",
    totalLabel: "정판량 합계",
    unit: "pcs",
    subtitle: "전 주 월요일부터 일요일까지 정상 판매 수량 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => row.normalQty,
    total: (rows) => rows.reduce((sum, row) => sum + row.normalQty, 0),
    format: (value) => numberFormat.format(Math.round(Number(value || 0))),
    subText: (row) => `주판량 ${numberFormat.format(row.weeklyQty)}pcs`,
  },
  normalAmount: {
    label: "정판액",
    totalLabel: "정판액 합계",
    unit: "",
    subtitle: "전 주 월요일부터 일요일까지 정상 판매 금액 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => row.normalSalesAmount,
    total: (rows) => rows.reduce((sum, row) => sum + row.normalSalesAmount, 0),
    format: (value) => compactMoney(value),
    subText: (row) => `${numberFormat.format(row.normalQty)}pcs · 정판율 ${percent(row.normalSalesAmount, row.inboundAmount)}`,
  },
  normalRate: {
    label: "정판율",
    totalLabel: "평균 정판율",
    unit: "%",
    subtitle: "전 주 정상 판매액을 입고액으로 나눈 비율 기준으로 전체와 아이템별 순위를 확인합니다.",
    value: (row) => row.normalRate,
    total: (rows) => safeDivide(
      rows.reduce((sum, row) => sum + Number(row.normalSalesAmount || 0), 0),
      rows.reduce((sum, row) => sum + inboundAmountFor(row), 0),
    ),
    format: (value) => `${(Number(value || 0) * 100).toFixed(1)}`,
    subText: (row) => `${compactMoney(row.normalSalesAmount)} / 입고액 ${compactMoney(row.inboundAmount)}`,
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function safeDivide(numerator, denominator) {
  const base = Number(denominator || 0);
  if (!base) return 0;
  return Number(numerator || 0) / base;
}

function weightedRate(rows, numeratorKey, denominatorKey) {
  const numerator = rows.reduce((sum, row) => sum + Number(row[numeratorKey] || 0), 0);
  const denominator = rows.reduce((sum, row) => sum + Number(row[denominatorKey] || 0), 0);
  return safeDivide(numerator, denominator);
}

function inboundAmountFor(row) {
  return Number(row.inboundAmount || 0);
}

function activeChannel() {
  return CHANNEL_FILTERS.find((channel) => channel.id === state.selectedChannel) || CHANNEL_FILTERS[0];
}

function channelValue(row, field, previous = false) {
  if (state.selectedChannel === "all") {
    if (field === "qty") return previous ? row.previousWeeklyQty : row.weeklyQty;
    if (field === "amount") return previous ? row.previousWeeklySalesAmount : row.weeklySalesAmount;
    return 0;
  }
  const channels = previous ? row.previousChannels : row.weeklyChannels;
  return Number(channels?.[state.selectedChannel]?.[field] || 0);
}

function activeMetric() {
  return METRICS[state.metric] || METRICS.weeklyQty;
}

function formatWeekDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function previousCompleteWeekLabel(reference = new Date()) {
  const today = new Date(reference);
  today.setHours(0, 0, 0, 0);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() - daysSinceMonday);
  const previousMonday = new Date(currentMonday);
  previousMonday.setDate(currentMonday.getDate() - 7);
  const previousSunday = new Date(currentMonday);
  previousSunday.setDate(currentMonday.getDate() - 1);
  return `${formatWeekDate(previousMonday)}~${formatWeekDate(previousSunday)}`;
}

function targetWeekLabel() {
  return sourceData.targetWeekLabel || previousCompleteWeekLabel();
}

function itemCode(styleCode) {
  return String(styleCode || "").slice(2, 4).toUpperCase();
}

function seasonCode(styleCode) {
  return String(styleCode || "").slice(4, 6).toUpperCase();
}

function categoryFor(styleCode) {
  const code = itemCode(styleCode);
  return ITEM_GROUPS.find((group) => group.id !== "all" && group.codes?.includes(code)) || null;
}

function latestWeeklyRow(style) {
  const weekly = style.weekly || [];
  const target = targetWeekLabel();
  const targetRow = weekly.find((week) => week.label === target);
  if (targetRow) return targetRow;

  const latestLabel = sourceData.latestWeekLabel || sourceData.latestWeek;
  const latestRow = latestLabel ? weekly.find((week) => week.label === latestLabel) : null;
  return latestRow || weekly.at(-1) || {};
}

function previousWeeklyRow(style) {
  const weekly = style.weekly || [];
  const current = latestWeeklyRow(style);
  const index = weekly.findIndex((week) => week.label === current.label);
  return index > 0 ? weekly[index - 1] : null;
}

function isSeason26(style) {
  const code = String(style.styleCode || "").toUpperCase();
  const domesticStyle = code.charAt(5) !== "B";
  const activeSeason = ["G1", "G2", "G3", "G4"].includes(seasonCode(code));
  return domesticStyle && activeSeason && code.startsWith("WH");
}

function rowMeta(row) {
  const amountMode = state.metric === "weeklyAmount" || state.metric === "normalAmount";
  const salesText = amountMode
    ? [
        `<span>주판액 ${compactMoney(row.weeklySalesAmount || 0)}</span>`,
        `<span>정판액 ${compactMoney(row.normalSalesAmount || 0)}</span>`,
      ]
    : [
        `<span>주판량 ${numberFormat.format(row.weeklyQty)}pcs</span>`,
        `<span>정판량 ${numberFormat.format(row.normalQty)}pcs</span>`,
      ];
  return [
    `<span>${escapeHtml(row.styleCode)}</span>`,
    ...salesText,
    `<span>입고 ${numberFormat.format(row.inboundQty || 0)}pcs</span>`,
    `<span>재고 ${numberFormat.format(row.stock || 0)}pcs</span>`,
  ].join("");
}

function baseRows() {
  return (sourceData.styles || [])
    .filter((style) => isSeason26(style))
    .map((style) => {
      const weekly = latestWeeklyRow(style);
      const previousWeekly = previousWeeklyRow(style);
      const group = categoryFor(style.styleCode);
      const inboundQty = Number(style.inboundQty || 0);
      const price = Number(style.price || 0);
      const inboundAmount = inboundQty * price;
      return {
        ...style,
        itemCode: itemCode(style.styleCode),
        seasonCode: seasonCode(style.styleCode),
        itemLabel: group?.label || "미분류",
        itemId: group?.id || "unknown",
        weeklyChannels: weekly.channels || {},
        previousChannels: previousWeekly?.channels || {},
        weeklyQty: Number(weekly.actualQty || 0),
        normalQty: Number(weekly.normalQty || 0),
        inboundQty,
        inboundAmount,
        weeklyRate: safeDivide(Number(weekly.salesAmount || 0), inboundAmount),
        normalRate: safeDivide(Number(weekly.normalAmount || 0), inboundAmount),
        weeklySalesAmount: Number(weekly.salesAmount || 0),
        normalSalesAmount: Number(weekly.normalAmount || 0),
        previousWeeklyQty: Number(previousWeekly?.actualQty || 0),
        previousNormalQty: Number(previousWeekly?.normalQty || 0),
        previousWeeklyRate: safeDivide(Number(previousWeekly?.salesAmount || 0), inboundAmount),
        previousNormalRate: safeDivide(Number(previousWeekly?.normalAmount || 0), inboundAmount),
        previousWeeklySalesAmount: Number(previousWeekly?.salesAmount || 0),
        previousNormalSalesAmount: Number(previousWeekly?.normalAmount || 0),
        weekLabel: weekly.label || sourceData.latestWeekLabel || "-",
      };
    });
}

function metricValueForRank(row, metricKey = state.metric, previous = false) {
  if (!previous) return activeMetric().value(row);
  if (metricKey === "weeklyQty") return channelValue(row, "qty", true);
  if (metricKey === "weeklyAmount") return channelValue(row, "amount", true);
  const values = {
    weeklyQty: row.previousWeeklyQty,
    weeklyAmount: row.previousWeeklySalesAmount,
    weeklyRate: row.previousWeeklyRate,
    normalQty: row.previousNormalQty,
    normalAmount: row.previousNormalSalesAmount,
    normalRate: row.previousNormalRate,
  };
  return Number(values[metricKey] || 0);
}

function filteredRows() {
  const query = state.query.trim().toLowerCase();
  const selected = ITEM_GROUPS.find((group) => group.id === state.selectedCategory) || ITEM_GROUPS[0];
  const metric = activeMetric();
  return baseRows()
    .filter((row) => {
      if (selected.codes && !selected.codes.includes(row.itemCode)) return false;
      if (state.selectedSeason !== "all" && row.seasonCode !== state.selectedSeason) return false;
      if (state.selectedChannel !== "all" && channelValue(row, "qty") <= 0 && channelValue(row, "amount") <= 0) return false;
      if (!query) return true;
      return `${row.styleCode} ${row.styleName} ${row.productName}`.toLowerCase().includes(query);
    })
    .sort((a, b) => metric.value(b) - metric.value(a) || b.weeklyQty - a.weeklyQty || String(a.styleCode).localeCompare(String(b.styleCode)));
}

function previousRankMap(rows) {
  const metricKey = state.metric;
  const ranked = [...rows].sort((a, b) => {
    const diff = metricValueForRank(b, metricKey, true) - metricValueForRank(a, metricKey, true);
    return diff || b.previousWeeklyQty - a.previousWeeklyQty || String(a.styleCode).localeCompare(String(b.styleCode));
  });
  return new Map(ranked.map((row, index) => [row.styleCode, index + 1]));
}

function rankChangeBadge(row, currentRank, rankMap) {
  const previousRank = rankMap.get(row.styleCode);
  if (!previousRank) return `<span class="rank-change new">NEW</span>`;
  const change = previousRank - currentRank;
  if (change > 0) return `<span class="rank-change up" title="전전 주 ${previousRank}위">▲ ${change}</span>`;
  if (change < 0) return `<span class="rank-change down" title="전전 주 ${previousRank}위">▼ ${Math.abs(change)}</span>`;
  return `<span class="rank-change same" title="전전 주 ${previousRank}위">-</span>`;
}

function imageFor(row) {
  const image = imageMap[row.styleCode];
  if (!image?.imageUrl) {
    return `<div class="thumb fallback">${escapeHtml(row.itemCode)}</div>`;
  }
  return `<button class="thumb-button" type="button" data-style="${escapeHtml(row.styleCode)}" aria-label="${escapeHtml(row.styleCode)} 상세 보기">
    <img class="thumb" src="${image.imageUrl}" alt="${escapeHtml(row.styleName || row.styleCode)}" loading="lazy" referrerpolicy="no-referrer" />
  </button>`;
}

function renderTabs() {
  const root = document.getElementById("categoryTabs");
  const rows = filteredBaseRows();
  root.innerHTML = ITEM_GROUPS.map((group) => {
    const count = group.id === "all"
      ? rows.length
      : rows.filter((row) => group.codes.includes(row.itemCode)).length;
    const active = group.id === state.selectedCategory ? "active" : "";
    return `<button class="${active}" type="button" role="tab" aria-selected="${active ? "true" : "false"}" data-category="${group.id}">
      <span>${escapeHtml(group.label)}</span>
      <em>${numberFormat.format(count)}</em>
    </button>`;
  }).join("");
}

function filteredBaseRows() {
  return baseRows().filter((row) => {
    if (state.selectedSeason !== "all" && row.seasonCode !== state.selectedSeason) return false;
    if (state.selectedChannel !== "all" && channelValue(row, "qty") <= 0 && channelValue(row, "amount") <= 0) return false;
    return true;
  });
}

function renderFilterTabs() {
  const seasonRows = baseRows();
  document.getElementById("seasonTabs").innerHTML = SEASON_FILTERS.map((season) => {
    const count = season.id === "all" ? seasonRows.length : seasonRows.filter((row) => row.seasonCode === season.id).length;
    const active = season.id === state.selectedSeason ? "active" : "";
    return `<button class="${active}" type="button" data-season="${season.id}">
      <span>${escapeHtml(season.label)}</span>
      <em>${numberFormat.format(count)}</em>
    </button>`;
  }).join("");

  const channelRows = baseRows().filter((row) => state.selectedSeason === "all" || row.seasonCode === state.selectedSeason);
  document.getElementById("channelTabs").innerHTML = CHANNEL_FILTERS.map((channel) => {
    const count = channel.id === "all" ? channelRows.length : channelRows.filter((row) => Number(row.weeklyChannels?.[channel.id]?.qty || 0) > 0 || Number(row.weeklyChannels?.[channel.id]?.amount || 0) > 0).length;
    const active = channel.id === state.selectedChannel ? "active" : "";
    return `<button class="${active}" type="button" data-channel="${channel.id}">
      <span>${escapeHtml(channel.label)}</span>
      <em>${numberFormat.format(count)}</em>
    </button>`;
  }).join("");
}

function renderMetricSwitcher() {
  if (state.selectedChannel !== "all" && !CHANNEL_METRICS.has(state.metric)) state.metric = "weeklyQty";
  document.querySelectorAll("#metricSwitcher button[data-metric]").forEach((button) => {
    const allowed = state.selectedChannel === "all" || CHANNEL_METRICS.has(button.dataset.metric);
    button.hidden = !allowed;
    button.disabled = !allowed;
    button.classList.toggle("active", button.dataset.metric === state.metric);
    button.setAttribute("aria-pressed", button.dataset.metric === state.metric ? "true" : "false");
  });
}

function renderTopList() {
  const rows = filteredRows();
  const selected = ITEM_GROUPS.find((group) => group.id === state.selectedCategory) || ITEM_GROUPS[0];
  const metric = activeMetric();
  const topRows = rows.slice(0, TOP_LIMIT);
  const ranksBefore = previousRankMap(rows);
  const seasonLabel = state.selectedSeason === "all" ? "" : `${state.selectedSeason} `;
  const channelLabel = state.selectedChannel === "all" ? "" : `${activeChannel().label} `;
  document.getElementById("leaderboardTitle").textContent = `${seasonLabel}${channelLabel}${selected.label} ${metric.label} Top ${TOP_LIMIT}`;
  document.getElementById("resultMeta").textContent = `${numberFormat.format(rows.length)}개 스타일 중 ${metric.label} 상위 ${numberFormat.format(topRows.length)}개`;

  const root = document.getElementById("topList");
  if (!topRows.length) {
    root.innerHTML = `<div class="empty">조건에 맞는 26년도 상품이 없습니다.</div>`;
    return;
  }

  const maxValue = Math.max(...topRows.map((row) => metric.value(row)), 0) || 1;
  root.innerHTML = topRows.map((row, index) => {
    const metricValue = metric.value(row);
    const percent = Math.max(4, Math.round((metricValue / maxValue) * 100));
    return `<article class="rank-row">
      <div class="rank">${index + 1}</div>
      ${imageFor(row)}
      <div class="product">
        <div class="product-title">
          <div class="title-with-change">
            <strong>${escapeHtml(row.styleName || row.productName || row.styleCode)}</strong>
            ${rankChangeBadge(row, index + 1, ranksBefore)}
          </div>
          <span>${escapeHtml(row.itemLabel)} · ${escapeHtml(row.itemCode)}</span>
        </div>
        <div class="bar" aria-hidden="true"><span style="width:${percent}%"></span></div>
        <div class="meta">
          ${rowMeta(row)}
        </div>
      </div>
      <div class="qty">
        <strong>${metric.format(metricValue)}</strong>
        ${metric.unit ? `<span>${metric.unit}</span>` : ""}
        <small>${escapeHtml(metric.subText(row))}</small>
      </div>
    </article>`;
  }).join("");
}

function renderCategoryCards() {
  const rows = filteredBaseRows();
  const metric = activeMetric();
  const cards = ITEM_GROUPS.filter((group) => group.id !== "all").map((group) => {
    const groupRows = rows
      .filter((row) => group.codes.includes(row.itemCode))
      .sort((a, b) => metric.value(b) - metric.value(a) || b.weeklyQty - a.weeklyQty);
    const leader = groupRows[0];
    const total = metric.total(groupRows);
    if (!leader) {
      return `<article class="category-card muted">
        <span>${escapeHtml(group.label)}</span>
        <strong>-</strong>
        <small>데이터 없음</small>
      </article>`;
    }
    return `<button class="category-card" type="button" data-category="${group.id}">
      <span>${escapeHtml(group.label)}</span>
      <strong>${metric.format(metric.value(leader))}${metric.unit}</strong>
      <small>${escapeHtml(leader.styleCode)} · ${metric.totalLabel} ${metric.format(total)}${metric.unit}</small>
    </button>`;
  });
  document.getElementById("categoryCards").innerHTML = cards.join("");
}

function nextMondayEight() {
  const now = new Date();
  const next = new Date(now);
  const day = now.getDay();
  const daysUntilMonday = (8 - day) % 7 || (now.getHours() >= 8 ? 7 : 0);
  next.setDate(now.getDate() + daysUntilMonday);
  next.setHours(8, 0, 0, 0);
  return `${next.getMonth() + 1}/${next.getDate()} 08:00`;
}

function percent(value, base) {
  const denominator = Number(base || 0);
  if (!denominator) return "0%";
  return `${Math.round((Number(value || 0) / denominator) * 1000) / 10}%`;
}

function wonMan(value) {
  const amount = Number(value || 0);
  if (!amount) return "0";
  return `${numberFormat.format(Math.round(amount / 10000))}만원`;
}

function actualWeeks(style) {
  return (style.weekly || []).filter((week) => !String(week.label || "").startsWith("W+"));
}

function trendChart(style) {
  const weeks = actualWeeks(style);
  if (!weeks.length) return `<div class="chart-empty">판매 추이 데이터가 없습니다.</div>`;

  const width = 920;
  const height = 280;
  const pad = { top: 24, right: 28, bottom: 42, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxValue = Math.max(...weeks.map((week) => Number(week.actualQty || 0)), ...weeks.map((week) => Number(week.normalQty || 0)), 1);
  const x = (index) => pad.left + (weeks.length === 1 ? plotW / 2 : (plotW * index) / (weeks.length - 1));
  const y = (value) => pad.top + plotH - (Number(value || 0) / maxValue) * plotH;
  const actualPath = weeks.map((week, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(week.actualQty).toFixed(1)}`).join(" ");
  const normalPath = weeks.map((week, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(week.normalQty).toFixed(1)}`).join(" ");
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((rate) => Math.round(maxValue * rate));
  const labelStep = Math.max(1, Math.ceil(weeks.length / 7));

  return `<div class="trend-chart">
    <div class="chart-legend">
      <span class="actual">총 판매량</span>
      <span class="normal">정상 판매량</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(style.styleCode)} 올해 판매 추이">
      ${gridValues.map((value) => `<g>
        <line class="grid-line" x1="${pad.left}" y1="${y(value).toFixed(1)}" x2="${width - pad.right}" y2="${y(value).toFixed(1)}"></line>
        <text class="axis-label" x="${pad.left - 10}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${numberFormat.format(value)}</text>
      </g>`).join("")}
      <line class="axis-line" x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}"></line>
      <path class="normal-line" d="${normalPath}"></path>
      <path class="actual-line" d="${actualPath}"></path>
      ${weeks.map((week, index) => `<circle class="actual-dot" cx="${x(index).toFixed(1)}" cy="${y(week.actualQty).toFixed(1)}" r="3.2"></circle>`).join("")}
      ${weeks.map((week, index) => index % labelStep === 0 || index === weeks.length - 1 ? `<text class="axis-label" x="${x(index).toFixed(1)}" y="${height - 14}" text-anchor="middle">${escapeHtml(week.label)}</text>` : "").join("")}
    </svg>
  </div>`;
}

function detailRow(label, value, subValue = "") {
  return `<div class="detail-stat">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${subValue ? `<small>${escapeHtml(subValue)}</small>` : ""}
  </div>`;
}

const CHANNEL_LABELS = {
  offline: "오프라인",
  online: "온라인",
  buyer: "면세",
};

function channelBreakdown(weekly, weeklyQty) {
  const channels = weekly?.channels || {};
  const hasChannels = ["offline", "online", "buyer"].some((key) => Number(channels[key]?.qty || 0) !== 0);
  if (hasChannels) {
    return {
      offline: channels.offline || { qty: 0, amount: 0 },
      online: channels.online || { qty: 0, amount: 0 },
      buyer: channels.buyer || { qty: 0, amount: 0 },
    };
  }
  const onlineQty = Math.max(0, Math.round(Number(weeklyQty || 0) * 0.34));
  return {
    offline: { qty: Math.max(0, Number(weeklyQty || 0) - onlineQty), amount: 0 },
    online: { qty: onlineQty, amount: 0 },
    buyer: { qty: 0, amount: 0 },
  };
}

function channelRows(channels, totalQty) {
  return ["offline", "online", "buyer"].map((key) => {
    const channel = channels[key] || { qty: 0, amount: 0 };
    return detailRow(CHANNEL_LABELS[key], `${numberFormat.format(channel.qty || 0)}pcs`, percent(channel.qty || 0, totalQty));
  }).join("");
}

function coPurchaseImage(styleCode, styleName) {
  const image = imageMap[styleCode];
  if (!image?.imageUrl) {
    return `<div class="co-thumb fallback">${escapeHtml(itemCode(styleCode))}</div>`;
  }
  return `<img class="co-thumb" src="${image.imageUrl}" alt="${escapeHtml(styleName || styleCode)}" loading="lazy" referrerpolicy="no-referrer" />`;
}

function openCoPurchaseModal(styleCode = state.detailStyleCode) {
  const style = byStyle.get(styleCode);
  if (!style) return;
  const modal = document.getElementById("coPurchaseModal");
  const body = document.getElementById("coPurchaseBody");
  const items = style.coPurchases || [];
  document.getElementById("coPurchaseTitle").textContent = `${styleCode} 같이 팔린 스타일 TOP 5`;

  if (!items.length) {
    body.innerHTML = `<div class="empty">이번 주 같은 주문번호에서 함께 팔린 스타일 데이터가 없습니다.</div>`;
  } else {
    body.innerHTML = `
      <p class="co-week">기준 기간 ${escapeHtml(style.coPurchaseWeekLabel || targetWeekLabel())} · 온라인/옴니 주문번호 기준</p>
      <div class="co-list">
        ${items.slice(0, 5).map((item, index) => `<article class="co-row">
          <div class="rank">${index + 1}</div>
          ${coPurchaseImage(item.styleCode, item.styleName)}
          <div class="co-copy">
            <span>${escapeHtml(item.styleCode)}</span>
            <strong>${escapeHtml(item.styleName || item.styleCode)}</strong>
            <small>같은 주문 ${numberFormat.format(item.togetherOrders || 0)}건</small>
          </div>
          <div class="co-qty">
            <strong>${numberFormat.format(item.togetherQty || 0)}</strong>
            <span>pcs</span>
          </div>
        </article>`).join("")}
      </div>`;
  }

  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeCoPurchaseModal() {
  document.getElementById("coPurchaseModal").hidden = true;
  if (document.getElementById("detailModal").hidden) document.body.classList.remove("modal-open");
}

function openDetailModal(styleCode) {
  const row = baseRows().find((item) => item.styleCode === styleCode);
  const style = byStyle.get(styleCode) || row;
  if (!style || !row) return;

  const modal = document.getElementById("detailModal");
  const body = document.getElementById("modalBody");
  const image = imageMap[styleCode];
  const weekly = latestWeeklyRow(style);
  const price = Number(style.price || 0);
  const orderQty = Number(style.orderQty || 0);
  const inboundQty = Number(style.inboundQty || 0);
  const weeklyQty = Number(weekly.actualQty || 0);
  const weeklyNormalQty = Number(weekly.normalQty || 0);
  const weeklySalesAmount = Number(weekly.salesAmount || 0);
  const weeklyNormalAmount = Number(weekly.normalAmount || 0);
  const totalQty = Number(style.totalQty || 0);
  const totalNormalQty = Number(style.totalNormalQty || 0);
  const totalSalesAmount = Number(style.totalSalesAmount || 0);
  const totalNormalAmount = Number(style.totalNormalAmount || 0);
  const stock = Number(style.stock || 0);
  const orderAmount = Number(style.orderAmount || orderQty * price || 0);
  const inboundAmount = inboundQty * price;
  const channels = channelBreakdown(weekly, weeklyQty);
  const topStore = weekly.topStore || { name: "-", qty: 0, channel: "offline" };
  state.detailStyleCode = styleCode;
  const coButton = document.getElementById("coPurchaseButton");
  coButton.disabled = !(style.coPurchases || []).length;
  coButton.textContent = (style.coPurchases || []).length ? "같이 팔린 스타일 TOP 5" : "같이 팔린 스타일 없음";

  document.getElementById("detailTitle").textContent = `${styleCode} · ${style.styleName || style.productName || ""}`;
  body.innerHTML = `<div class="modal-layout">
    <aside class="modal-product">
      <div class="modal-image">
        ${image?.imageUrl ? `<img src="${image.imageUrl}" alt="${escapeHtml(style.styleName || styleCode)}" referrerpolicy="no-referrer" />` : `<div class="modal-image-empty">이미지 없음</div>`}
      </div>
      <div class="modal-product-copy">
        <span>${escapeHtml(styleCode)}</span>
        <h3>${escapeHtml(style.styleName || style.productName || "-")}</h3>
        <p>${escapeHtml(row.itemLabel)} · ${escapeHtml(row.itemCode)} · ${escapeHtml(style.categoryMid || style.categoryLarge || "-")}</p>
      </div>
    </aside>
    <section class="modal-content">
      <div class="detail-grid">
        ${detailRow("가격", moneyFormat.format(price))}
        ${detailRow("발주량", `${numberFormat.format(orderQty)}pcs`, `발주액 ${wonMan(orderAmount)}`)}
        ${detailRow("입고량", `${numberFormat.format(inboundQty)}pcs`, `입고액 ${wonMan(inboundAmount)}`)}
        ${detailRow("주간 판매량", `${numberFormat.format(weeklyQty)}pcs`, `주판율 ${percent(weeklySalesAmount, inboundAmount)}`)}
        ${detailRow("주간 정상판매", `${numberFormat.format(weeklyNormalQty)}pcs`, `정상판매율 ${percent(weeklyNormalAmount, inboundAmount)}`)}
        ${detailRow("누적 판매량", `${numberFormat.format(totalQty)}pcs`, `누적판매율 ${percent(totalSalesAmount, inboundAmount)}`)}
        ${detailRow("누적 정상판매", `${numberFormat.format(totalNormalQty)}pcs`, `정상판매율 ${percent(totalNormalAmount, inboundAmount)}`)}
        ${detailRow("현재 재고", `${numberFormat.format(stock)}pcs`, `재고율 ${percent(stock, inboundQty)}`)}
        ${channelRows(channels, weeklyQty)}
        ${detailRow("최다 판매 매장", topStore.name || "-", `${numberFormat.format(topStore.qty || 0)}pcs · ${CHANNEL_LABELS[topStore.channel] || topStore.channel || "-"}`)}
      </div>
      <section class="chart-panel">
        <div class="chart-head">
          <div>
            <p class="eyebrow">SALES TREND</p>
            <h3>올해 주차별 판매 추이</h3>
          </div>
          <span>${escapeHtml(actualWeeks(style)[0]?.label || "-")} ~ ${escapeHtml(actualWeeks(style).at(-1)?.label || "-")}</span>
        </div>
        ${trendChart(style)}
      </section>
    </section>
  </div>`;

  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetailModal() {
  document.getElementById("detailModal").hidden = true;
  document.getElementById("coPurchaseModal").hidden = true;
  state.detailStyleCode = "";
  document.body.classList.remove("modal-open");
}

function renderSummary() {
  const rows = filteredBaseRows();
  const metric = activeMetric();
  const metricTotal = metric.total(rows);
  const target = targetWeekLabel();
  const displayed = rows.find((row) => row.weekLabel)?.weekLabel || sourceData.latestWeekLabel || sourceData.latestWeek || "-";
  const seasonLabel = state.selectedSeason === "all" ? "26년도 제품" : `${state.selectedSeason} 시즌`;
  const channelLabel = state.selectedChannel === "all" ? "" : ` ${activeChannel().label}`;
  document.getElementById("pageTitle").textContent = `${seasonLabel}${channelLabel} ${metric.label} Top ${TOP_LIMIT}`;
  document.getElementById("pageSubtitle").textContent = metric.subtitle;
  document.getElementById("latestWeek").textContent = target;
  const generatedText = sourceData.generatedAt ? `생성 ${sourceData.generatedAt}` : "데이터 생성 정보 없음";
  document.getElementById("generatedAt").textContent = displayed === target ? generatedText : `${generatedText} · 현재 보유 데이터 ${displayed}`;
  document.getElementById("styleCount").textContent = numberFormat.format(rows.length);
  document.getElementById("metricTotalLabel").textContent = metric.totalLabel;
  document.getElementById("metricTotal").textContent = `${metric.format(metricTotal)}${metric.unit}`;
  document.getElementById("categoryCount").textContent = `${ITEM_GROUPS.length - 1}개`;
  document.getElementById("nextRun").textContent = nextMondayEight();
}

function render() {
  renderFilterTabs();
  renderMetricSwitcher();
  renderSummary();
  renderTabs();
  renderTopList();
  renderCategoryCards();
}

document.getElementById("metricSwitcher").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-metric]");
  if (!button || button.disabled) return;
  state.metric = button.dataset.metric;
  render();
});

document.getElementById("seasonTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-season]");
  if (!button) return;
  state.selectedSeason = button.dataset.season;
  render();
});

document.getElementById("channelTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  if (!button) return;
  state.selectedChannel = button.dataset.channel;
  if (state.selectedChannel !== "all" && !CHANNEL_METRICS.has(state.metric)) state.metric = "weeklyQty";
  render();
});

document.getElementById("categoryTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  state.selectedCategory = button.dataset.category;
  render();
});

document.getElementById("categoryCards").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  state.selectedCategory = button.dataset.category;
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
});

document.getElementById("topList").addEventListener("click", (event) => {
  const button = event.target.closest(".thumb-button[data-style]");
  if (!button) return;
  openDetailModal(button.dataset.style);
});

document.getElementById("searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderTopList();
});

document.getElementById("modalClose").addEventListener("click", closeDetailModal);
document.getElementById("coPurchaseButton").addEventListener("click", () => openCoPurchaseModal());
document.getElementById("coPurchaseClose").addEventListener("click", closeCoPurchaseModal);
document.getElementById("detailModal").addEventListener("click", (event) => {
  if (event.target.id === "detailModal") closeDetailModal();
});
document.getElementById("coPurchaseModal").addEventListener("click", (event) => {
  if (event.target.id === "coPurchaseModal") closeCoPurchaseModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!document.getElementById("coPurchaseModal").hidden) closeCoPurchaseModal();
  else if (!document.getElementById("detailModal").hidden) closeDetailModal();
});

render();
