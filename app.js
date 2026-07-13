const sourceData = window.REORDER_DATA || { styles: [] };
const imageMap = window.WHOAU_IMAGE_MAP?.images || {};
const reviewPayload = window.WHOAU_REVIEW_INSIGHTS || {};
const reviewInsights = reviewPayload.insights || {};

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
const GENDER_FILTERS = [
  { id: "all", label: "전체" },
  { id: "unisex", label: "유니" },
  { id: "women", label: "여성" },
];
const TOP_LIMIT = 20;

const state = {
  selectedCategory: "all",
  selectedSeason: "all",
  selectedChannel: "all",
  selectedGender: "all",
  metric: "weeklyQty",
  query: "",
  detailStyleCode: "",
};

const reviewDashboardState = {
  query: "",
  channel: "지그재그",
  category: "all",
  season: "all",
  rating: "all",
  reaction: "all",
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

function genderCode(styleCode) {
  const suffix = String(styleCode || "").slice(-1).toUpperCase();
  if (suffix === "U" || suffix === "M") return "unisex";
  if (suffix === "F") return "women";
  return "";
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
        genderCode: genderCode(style.styleCode),
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
      if (state.selectedGender !== "all" && row.genderCode !== state.selectedGender) return false;
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
    return `<button class="thumb-button" type="button" data-style="${escapeHtml(row.styleCode)}" aria-label="${escapeHtml(row.styleCode)} 상세 보기">
      <div class="thumb fallback">${escapeHtml(row.itemCode)}</div>
    </button>`;
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
    if (state.selectedGender !== "all" && row.genderCode !== state.selectedGender) return false;
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

  const genderRows = channelRows.filter((row) => state.selectedChannel === "all" || Number(row.weeklyChannels?.[state.selectedChannel]?.qty || 0) > 0 || Number(row.weeklyChannels?.[state.selectedChannel]?.amount || 0) > 0);
  document.getElementById("genderTabs").innerHTML = GENDER_FILTERS.map((gender) => {
    const count = gender.id === "all" ? genderRows.length : genderRows.filter((row) => row.genderCode === gender.id).length;
    const active = gender.id === state.selectedGender ? "active" : "";
    return `<button class="${active}" type="button" data-gender="${gender.id}">
      <span>${escapeHtml(gender.label)}</span>
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
  const genderLabel = state.selectedGender === "all" ? "" : `${GENDER_FILTERS.find((gender) => gender.id === state.selectedGender)?.label || ""} `;
  document.getElementById("leaderboardTitle").textContent = `${seasonLabel}${channelLabel}${genderLabel}${selected.label} ${metric.label} Top ${TOP_LIMIT}`;
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
    return `<article class="rank-row" data-style="${escapeHtml(row.styleCode)}">
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

function currentDataYear() {
  return Number(String(sourceData.generatedAt || "").slice(0, 4)) || new Date().getFullYear();
}

function parseWeekLabelDate(label, part = "start", referenceLabel = "") {
  const match = String(label || "").match(/^(\d{2})\/(\d{2})~(\d{2})\/(\d{2})$/);
  if (!match) return null;
  let year = currentDataYear();
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[3]);
  const endDay = Number(match[4]);
  const referenceMatch = String(referenceLabel || "").match(/^(\d{2})\/(\d{2})~(\d{2})\/(\d{2})$/);
  const referenceEndMonth = referenceMatch ? Number(referenceMatch[3]) : 0;
  if (referenceEndMonth && startMonth > referenceEndMonth) year -= 1;
  if (part === "end") {
    return new Date(endMonth < startMonth ? year + 1 : year, endMonth - 1, endDay);
  }
  return new Date(year, startMonth - 1, startDay);
}

function formatYmdLabel(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

function firstSalesWeek(style) {
  return actualWeeks(style).find((week) => Number(week.actualQty || 0) > 0) || null;
}

function salesWeekCount(style) {
  if (Number(style.salesWeeks || 0) > 0) return Number(style.salesWeeks);
  const first = firstSalesWeek(style);
  if (!first) return 0;
  const last = latestWeeklyRow(style) || actualWeeks(style).at(-1);
  const start = parseWeekLabelDate(first.label, "start", last?.label);
  const end = parseWeekLabelDate(last?.label, "end", last?.label);
  if (!start || !end) return 0;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((end.getTime() - start.getTime() + dayMs) / (7 * dayMs)));
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

function productUrlFor(styleCode) {
  return imageMap[styleCode]?.productUrl || "";
}

function productNoFromUrl(url) {
  const match = String(url || "").match(/\/(\d+)\/category\//);
  return match ? match[1] : "";
}

function insightPercent(value, total) {
  const denominator = Number(total || 0);
  if (!denominator) return "0%";
  return `${Math.round((Number(value || 0) / denominator) * 100)}%`;
}

function insightKeywordChips(items, emptyText) {
  if (!items?.length) return `<span class="review-empty-chip">${escapeHtml(emptyText)}</span>`;
  return items.map((item) => `<span class="review-chip">${escapeHtml(item.label)} <b>${numberFormat.format(item.count)}</b></span>`).join("");
}

function insightReviewCards(items, emptyText) {
  if (!items?.length) return `<div class="empty compact">${escapeHtml(emptyText)}</div>`;
  return items.map((review) => `<article class="review-card">
    <div class="review-card-meta">
      <span>${escapeHtml(review.sourceLabel || review.source || "-")}</span>
      <span>${escapeHtml(review.date || "-")}</span>
      ${review.score ? `<span>${"★".repeat(Math.max(1, Math.min(5, Number(review.score))))}</span>` : ""}
      ${review.reaction ? `<span>${escapeHtml(review.reaction)}</span>` : ""}
    </div>
    <p>${escapeHtml(review.message || "")}</p>
    ${(review.issueTags?.length || review.sizeJudgement || review.note) ? `<div class="review-card-tags">
      ${(review.issueTags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      ${review.sizeJudgement ? `<span>${escapeHtml(review.sizeJudgement)}</span>` : ""}
      ${review.note ? `<span>${escapeHtml(review.note)}</span>` : ""}
    </div>` : ""}
  </article>`).join("");
}

function insightStat(label, value, subValue = "") {
  return `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${subValue ? `<small>${escapeHtml(subValue)}</small>` : ""}
  </article>`;
}

function sourceStatusClass(status) {
  if (status === "collected") return "collected";
  if (status === "error") return "error";
  return "pending";
}

function sourceCards(sources = []) {
  return sources.map((source) => `<article class="source-card ${sourceStatusClass(source.status)}">
    <span>${escapeHtml(source.label)}</span>
    <strong>${numberFormat.format(source.count || 0)}건</strong>
    <small>${source.count ? "시트 집계" : "데이터 없음"}</small>
  </article>`).join("");
}

function topReviewStyleRows(items = []) {
  if (!items.length) return `<div class="empty compact">리뷰가 집계된 스타일이 없습니다.</div>`;
  return `<div class="review-style-list">${items.map((item, index) => `<button type="button" data-review-style="${escapeHtml(item.styleCode)}">
    <b>${index + 1}</b>
    <span>
      <strong>${escapeHtml(item.styleName || item.styleCode)}</strong>
      <small>${escapeHtml(item.styleCode)} · 리뷰 ${numberFormat.format(item.totalReviews || 0)}건 · 평균 ${item.averageScore ? Number(item.averageScore).toFixed(1) : "-"}</small>
    </span>
    <em>긍정 ${insightPercent(item.positiveCount || 0, item.totalReviews || 0)}</em>
  </button>`).join("")}</div>`;
}

function reviewFilterButton(group, value, label, count = null) {
  const active = reviewDashboardState[group] === value;
  return `<button class="${active ? "active" : ""}" type="button" data-review-filter="${group}" data-value="${escapeHtml(value)}">
    ${escapeHtml(label)}${count === null ? "" : ` <b>${numberFormat.format(count)}</b>`}
  </button>`;
}

function reviewSeasonOptions(reviews) {
  const preferred = ["D1", "D4", "E1", "E2", "E3", "E4", "F1", "F2", "F3", "F4", "G1", "G2", "G3", "G4"];
  const found = new Set(reviews.map((review) => seasonCode(review.styleCode)).filter(Boolean));
  return preferred.filter((season) => found.has(season));
}

function reviewMatchesDashboard(review) {
  const query = reviewDashboardState.query.trim().toUpperCase();
  const styleCategory = categoryFor(review.styleCode)?.id || "";
  const styleSeason = seasonCode(review.styleCode);
  const noteOnly = reviewDashboardState.channel === "issuesOnly";
  const channelOk = reviewDashboardState.channel === "all" || noteOnly || review.channel === reviewDashboardState.channel;
  const noteOk = !noteOnly || Boolean(review.note);
  const categoryOk = reviewDashboardState.category === "all" || styleCategory === reviewDashboardState.category;
  const seasonOk = reviewDashboardState.season === "all" || styleSeason === reviewDashboardState.season;
  const ratingOk = reviewDashboardState.rating === "all" || Number(review.rating) === Number(reviewDashboardState.rating);
  const reactionOk = reviewDashboardState.reaction === "all" || review.reaction === reviewDashboardState.reaction;
  const queryOk = !query || [review.productName, review.styleCode, review.message].some((value) => String(value || "").toUpperCase().includes(query));
  return channelOk && noteOk && categoryOk && seasonOk && ratingOk && reactionOk && queryOk;
}

function reviewAverage(rows) {
  const rated = rows.filter((review) => Number(review.rating) > 0);
  if (!rated.length) return 0;
  return rated.reduce((sum, review) => sum + Number(review.rating), 0) / rated.length;
}

function reviewCountMap(rows, getter) {
  const map = new Map();
  for (const row of rows) {
    const key = getter(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function reviewTagRows(rows) {
  const counts = new Map();
  for (const row of rows) for (const tag of row.issueTags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 10);
  if (!items.length) return `<div class="empty compact">표시할 이슈 태그가 없습니다.</div>`;
  return `<div class="review-insight-bars">${items.map(([label, count]) => {
    const width = Math.max(8, Math.round((count / items[0][1]) * 100));
    return `<div><span>${escapeHtml(label)}</span><b>${numberFormat.format(count)}</b><i style="width:${width}%"></i></div>`;
  }).join("")}</div>`;
}

function reviewStars(rating) {
  const score = Math.max(0, Math.min(5, Number(rating || 0)));
  return `${"★".repeat(score)}${"☆".repeat(5 - score)}`;
}

function reviewBar(width, colorClass = "") {
  return `<span class="review-bar"><i class="${colorClass}" style="width:${Math.max(1, Math.min(100, width))}%"></i></span>`;
}

function normalizedSizeLabel(value) {
  const text = String(value || "");
  if (/작|작음|작다/.test(text)) return "작다";
  if (/크|큼|크다/.test(text)) return "크다";
  if (/정/.test(text)) return "정사이즈";
  return "";
}

function reviewProductCategoryName(productName = "") {
  const name = String(productName);
  const rules = [
    ["패딩점퍼", /패딩.*점퍼|롱패딩|숏패딩/],
    ["일반점퍼", /점퍼|윈드브레이커|파카|자켓|재킷/],
    ["집업", /집업|후드집업/],
    ["가디건", /가디건/],
    ["풀오버스웨터", /스웨터|풀오버|니트/],
    ["변형반팔티", /헨리넥|링거|슬림핏|레이어드.*반팔|반팔.*티/],
    ["일반티셔츠", /티셔츠|T-shirt|티\b/],
    ["셔츠", /셔츠|블라우스/],
    ["팬츠", /팬츠|데님|쇼츠|바지|슬랙스/],
    ["스커트/원피스", /스커트|원피스/],
    ["잡화", /모자|볼캡|슬리퍼|부츠|양말|백|가방/],
  ];
  return rules.find(([, pattern]) => pattern.test(name))?.[0] || "기타";
}

function reviewStatsTable(rows, groupGetter, firstLabel, countSuffix = "") {
  const grouped = new Map();
  for (const row of rows) {
    const key = groupGetter(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, { label: key, count: 0, ratingSum: 0, ratingCount: 0, negative: 0 });
    const item = grouped.get(key);
    item.count += 1;
    if (Number(row.rating) > 0) {
      item.ratingSum += Number(row.rating);
      item.ratingCount += 1;
    }
    if (row.reaction === "부정") item.negative += 1;
  }
  const items = [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  return `<div class="review-table-wrap">
    <table class="review-mini-table">
      <thead><tr><th>${escapeHtml(firstLabel)}</th><th>리뷰</th><th>평균</th><th>부정</th></tr></thead>
      <tbody>${items.map((item) => `<tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${numberFormat.format(item.count)}${countSuffix}</td>
        <td class="green">${item.ratingCount ? (item.ratingSum / item.ratingCount).toFixed(1) : "-"}</td>
        <td class="red">${numberFormat.format(item.negative)}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function ratingDistributionPanel(rows) {
  const counts = new Map([5, 4, 3, 2, 1].map((rating) => [rating, 0]));
  for (const row of rows) counts.set(Number(row.rating), (counts.get(Number(row.rating)) || 0) + 1);
  const max = Math.max(...counts.values(), 1);
  return `<section class="review-analysis-card">
    <h4>별점 분포 <small>${numberFormat.format(rows.length)}건</small></h4>
    <div class="rating-bars">${[5, 4, 3, 2, 1].map((rating) => {
      const count = counts.get(rating) || 0;
      const color = rating >= 4 ? "green" : rating === 3 ? "gold" : "red";
      return `<div>
        <span>${reviewStars(rating)}</span>
        ${reviewBar((count / max) * 100, color)}
        <b>${numberFormat.format(count)}</b>
      </div>`;
    }).join("")}</div>
  </section>`;
}

function reactionSizePanel(rows) {
  const positive = rows.filter((row) => row.reaction === "긍정").length;
  const negative = rows.filter((row) => row.reaction === "부정").length;
  const neutral = rows.length - positive - negative;
  const posWidth = rows.length ? (positive / rows.length) * 100 : 0;
  const neuWidth = rows.length ? (neutral / rows.length) * 100 : 0;
  const negWidth = rows.length ? (negative / rows.length) * 100 : 0;
  const sizeCounts = new Map([["작다", 0], ["크다", 0], ["정사이즈", 0]]);
  for (const row of rows) {
    const label = normalizedSizeLabel(row.sizeJudgement);
    if (label) sizeCounts.set(label, (sizeCounts.get(label) || 0) + 1);
  }
  const maxSize = Math.max(...sizeCounts.values(), 1);
  return `<section class="review-analysis-card">
    <h4>반응 비율</h4>
    <div class="reaction-stack">
      <i class="green" style="width:${posWidth}%"></i>
      <i class="gold" style="width:${neuWidth}%"></i>
      <i class="red" style="width:${negWidth}%"></i>
    </div>
    <div class="reaction-legend">
      <span class="green">긍정 ${numberFormat.format(positive)}</span>
      <span class="gold">중립 ${numberFormat.format(neutral)}</span>
      <span class="red">부정 ${numberFormat.format(negative)}</span>
    </div>
    <h4 class="sub">사이즈 피드백</h4>
    <div class="size-bars">${["작다", "크다", "정사이즈"].map((label) => {
      const count = sizeCounts.get(label) || 0;
      const color = label === "정사이즈" ? "green" : label === "크다" ? "gold" : "red";
      return `<div><span>${label}</span>${reviewBar((count / maxSize) * 100, color)}<b>${numberFormat.format(count)}</b></div>`;
    }).join("")}</div>
  </section>`;
}

function issuePanel(rows) {
  const totalCounts = new Map();
  const negativeCounts = new Map();
  for (const row of rows) {
    for (const tag of row.issueTags || []) {
      totalCounts.set(tag, (totalCounts.get(tag) || 0) + 1);
      if (row.reaction === "부정" || row.note) negativeCounts.set(tag, (negativeCounts.get(tag) || 0) + 1);
    }
  }
  const items = [...totalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 8);
  const max = Math.max(...items.map(([, count]) => count), 1);
  return `<section class="review-analysis-card">
    <h4>자주 언급된 이슈</h4>
    <div class="issue-bars">${items.map(([label, count]) => `<div>
      <span>${escapeHtml(label)}</span>
      <small>부정 ${numberFormat.format(negativeCounts.get(label) || 0)}</small>
      ${reviewBar((count / max) * 100, "blue")}
      <b>${numberFormat.format(count)}</b>
    </div>`).join("")}</div>
  </section>`;
}

function reviewCardList(rows, kind) {
  const isNegative = kind === "negative";
  const title = isNegative ? "부정·지적 리뷰 우선 대응" : "긍정 리뷰";
  const filtered = rows.filter((row) => isNegative ? isNegativeDisplayReview(row) : row.reaction === "긍정");
  const sample = (isNegative ? sortNegativeReviews(filtered) : sortPositiveReviews(filtered)).slice(0, 100);
  return `<section class="review-long-list-panel ${isNegative ? "negative" : "positive"}">
    <h4>${title} <small>${numberFormat.format(filtered.length)}건</small></h4>
    <div class="review-long-list">${sample.map((review) => `<article>
      <header>
        <span>${reviewStars(Number(review.rating || 0))}</span>
        <strong>${escapeHtml(review.productName || "-")}</strong>
        <em>· ${escapeHtml(review.styleCode || "스타일코드 없음")} · ${escapeHtml(review.channel || "-")} · ${escapeHtml(reviewProductCategoryName(review.productName))} · ${escapeHtml(seasonCode(review.styleCode) || "-")} · ${escapeHtml(review.reviewDate || "-")}</em>
        ${review.note ? `<b>지적</b>` : ""}
      </header>
      <p>${escapeHtml(review.message || "")}</p>
      <footer>
        ${(review.issueTags || []).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}
        ${review.sizeJudgement ? `<i>${escapeHtml(review.sizeJudgement)}</i>` : ""}
      </footer>
    </article>`).join("")}</div>
    <p class="review-list-note">위 ${numberFormat.format(filtered.length)}건은 분석결과 탭에서 확인하세요.</p>
  </section>`;
}

function reviewStyleSummaryRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.styleCode || "스타일코드 없음";
    if (!grouped.has(key)) grouped.set(key, { styleCode: key, styleName: row.productName || key, totalReviews: 0, positiveCount: 0, negativeCount: 0, ratingSum: 0, ratingCount: 0 });
    const item = grouped.get(key);
    item.totalReviews += 1;
    if (row.reaction === "긍정") item.positiveCount += 1;
    if (row.reaction === "부정") item.negativeCount += 1;
    if (Number(row.rating) > 0) {
      item.ratingSum += Number(row.rating);
      item.ratingCount += 1;
    }
  }
  const items = [...grouped.values()].sort((a, b) => b.totalReviews - a.totalReviews).slice(0, 10).map((item) => ({
    ...item,
    averageScore: item.ratingCount ? item.ratingSum / item.ratingCount : 0,
  }));
  return topReviewStyleRows(items.filter((item) => item.styleCode !== "스타일코드 없음"));
}

function styleReviewRows(styleCode) {
  return (reviewPayload.reviews || []).filter((review) => review.styleCode === styleCode);
}

function reviewDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/-\s+/g, " ");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
}

function reviewRatingValue(review, fallback) {
  const rating = Number(review?.rating ?? review?.score);
  return Number.isFinite(rating) && rating > 0 ? rating : fallback;
}

function isNegativeDisplayReview(review) {
  const rating = reviewRatingValue(review, 0);
  return rating >= 1 && rating <= 4 && (review.reaction === "부정" || review.note);
}

function sortPositiveReviews(rows) {
  return [...rows].sort((a, b) => {
    const issueCountA = (a.issueTags || []).length + (a.note ? 1 : 0);
    const issueCountB = (b.issueTags || []).length + (b.note ? 1 : 0);
    const ratingA = reviewRatingValue(a, -1);
    const ratingB = reviewRatingValue(b, -1);
    return ratingB - ratingA || issueCountB - issueCountA || reviewDateValue(b.reviewDate || b.date) - reviewDateValue(a.reviewDate || a.date);
  });
}

function sortNegativeReviews(rows) {
  return [...rows].sort((a, b) => {
    const issueCountA = (a.issueTags || []).length + (a.note ? 1 : 0);
    const issueCountB = (b.issueTags || []).length + (b.note ? 1 : 0);
    const ratingA = reviewRatingValue(a, 99);
    const ratingB = reviewRatingValue(b, 99);
    return ratingA - ratingB || issueCountB - issueCountA || reviewDateValue(b.reviewDate || b.date) - reviewDateValue(a.reviewDate || a.date);
  });
}

function reviewAvgText(rows) {
  const rated = rows.filter((review) => Number(review.rating) > 0);
  if (!rated.length) return "0.0점";
  const avg = rated.reduce((sum, review) => sum + Number(review.rating), 0) / rated.length;
  return `${avg.toFixed(1)}점`;
}

function inlineChannelScores(rows) {
  const channels = ["전체", "지그재그", "무신사", "공홈", "네이버", "이랜드몰"];
  return channels.map((channel) => {
    const channelRows = channel === "전체" ? rows : rows.filter((review) => review.channel === channel);
    return `<article>
      <span>${escapeHtml(channel)}</span>
      <strong>${reviewAvgText(channelRows)}</strong>
      <small>리뷰 ${numberFormat.format(channelRows.length)}개</small>
    </article>`;
  }).join("");
}

function inlineReviewList(rows, emptyText) {
  if (!rows.length) return `<div class="empty compact">${escapeHtml(emptyText)}</div>`;
  return `<div class="inline-review-list">${rows.map((review) => `<article>
    <header>
      <span>${reviewStars(Number(review.rating || 0))}</span>
      <strong>${escapeHtml(review.channel || "-")}</strong>
      <em>${escapeHtml(review.reviewDate || "-")}</em>
    </header>
    <p>${escapeHtml(review.message || "")}</p>
    <footer>
      ${(review.issueTags || []).slice(0, 5).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}
      ${review.sizeJudgement ? `<i>${escapeHtml(review.sizeJudgement)}</i>` : ""}
      ${review.note ? `<i>지적사항</i>` : ""}
    </footer>
  </article>`).join("")}</div>`;
}

function inlineStyleReviews(styleCode) {
  const rows = styleReviewRows(styleCode);
  const positiveRows = sortPositiveReviews(rows.filter((review) => review.reaction === "긍정"));
  const negativeRows = sortNegativeReviews(rows.filter(isNegativeDisplayReview));
  const now = Date.now();
  const recentWeekCount = rows.filter((review) => {
    const time = reviewDateValue(review.reviewDate);
    return time && now - time <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const latestRows = [...rows].sort((a, b) => reviewDateValue(b.reviewDate) - reviewDateValue(a.reviewDate)).slice(0, 10);

  return `<section class="inline-style-reviews">
    <div class="inline-review-head">
      <div>
        <p class="eyebrow">REVIEW INSIGHT</p>
        <h3>스타일 리뷰</h3>
      </div>
      <span>총 ${numberFormat.format(rows.length)}개 리뷰</span>
    </div>
    <div class="inline-score-grid">${inlineChannelScores(rows)}</div>
    <div class="inline-review-columns">
      <section>
        <h4>긍정 대표 리뷰 <small>${numberFormat.format(positiveRows.length)}건</small></h4>
        ${inlineReviewList(positiveRows.slice(0, 10), "긍정 리뷰가 없습니다.")}
      </section>
      <section>
        <h4>부정·지적 대표 리뷰 <small>${numberFormat.format(negativeRows.length)}건</small></h4>
        ${inlineReviewList(negativeRows.slice(0, 10), "부정 또는 지적 리뷰가 없습니다.")}
      </section>
    </div>
    <section class="inline-latest-reviews">
      <h4>최신 리뷰 <small>최근 일주일 추가 ${numberFormat.format(recentWeekCount)}건</small></h4>
      ${inlineReviewList(latestRows, "최신 리뷰가 없습니다.")}
    </section>
  </section>`;
}

function renderReviewOverview() {
  const overview = reviewPayload.overview || {};
  const allReviews = reviewPayload.reviews || [];
  const rows = allReviews.filter(reviewMatchesDashboard);
  const total = Number(overview.totalReviews || allReviews.length || 0);
  const positive = rows.filter((review) => review.reaction === "긍정").length;
  const negative = rows.filter((review) => review.reaction === "부정").length;
  const noteCount = rows.filter((review) => review.note).length;
  const channelCounts = reviewCountMap(allReviews, (review) => review.channel);
  const categoryCounts = reviewCountMap(allReviews, (review) => categoryFor(review.styleCode)?.id || "");
  const seasonOptions = reviewSeasonOptions(allReviews);

  document.getElementById("reviewInsightTitle").textContent = "리뷰 인사이트";

  return `
    <section class="review-app-shell">
      <header class="review-app-head">
        <div>
          <p>WHO.A.U · ONLINE TEAM</p>
          <h3>리뷰 인사이트</h3>
          <span>총 ${numberFormat.format(total)}건 · 현재 보기 ${numberFormat.format(rows.length)}건</span>
        </div>
        <button type="button" data-review-refresh>새로고침</button>
      </header>

      <div class="review-app-search">
        <input id="reviewSearchInput" type="search" value="${escapeHtml(reviewDashboardState.query)}" placeholder="상품명 또는 스타일코드 검색 (예: 헨리넥 / WHRAG)" />
      </div>

      <div class="review-app-stats">
        <article><span>총 리뷰</span><strong>${numberFormat.format(rows.length)}<small>건</small></strong></article>
        <article><span>평균 별점</span><strong>${reviewAverage(rows).toFixed(2)}<small>/ 5</small></strong></article>
        <article><span>긍정 비율</span><strong class="green">${insightPercent(positive, rows.length).replace("%", "")}<small>%</small></strong></article>
        <article><span>지적 포함</span><strong class="red">${insightPercent(noteCount, rows.length).replace("%", "")}<small>%</small></strong></article>
      </div>

      <div class="review-app-filters">
        <div>
          <span>채널</span>
          <div class="review-filter-pills">
            ${reviewFilterButton("channel", "all", "전체", allReviews.length)}
            ${["지그재그", "네이버", "무신사", "이랜드몰", "공홈"].map((channel) => reviewFilterButton("channel", channel, channel, channelCounts.get(channel) || 0)).join("")}
            ${reviewFilterButton("channel", "issuesOnly", "지적사항만")}
          </div>
        </div>
        <div>
          <span>카테고리</span>
          <select id="reviewCategorySelect">
            ${ITEM_GROUPS.map((group) => `<option value="${group.id}" ${reviewDashboardState.category === group.id ? "selected" : ""}>${escapeHtml(group.label)}${group.id === "all" ? "" : ` (${numberFormat.format(categoryCounts.get(group.id) || 0)})`}</option>`).join("")}
          </select>
        </div>
        <div>
          <span>시즌</span>
          <div class="review-filter-pills">
            ${reviewFilterButton("season", "all", "전체")}
            ${seasonOptions.map((season) => reviewFilterButton("season", season, season)).join("")}
          </div>
        </div>
        <div>
          <span>별점</span>
          <div class="review-filter-pills">
            ${reviewFilterButton("rating", "all", "전체")}
            ${[5, 4, 3, 2, 1].map((rating) => reviewFilterButton("rating", String(rating), `${rating}점`)).join("")}
          </div>
        </div>
        <div>
          <span>반응</span>
          <div class="review-filter-pills">
            ${reviewFilterButton("reaction", "all", "전체")}
            ${reviewFilterButton("reaction", "긍정", "긍정")}
            ${reviewFilterButton("reaction", "부정", "부정")}
            ${reviewFilterButton("reaction", "중립", "중립")}
          </div>
        </div>
      </div>

      <div class="review-analysis-grid first">
        ${ratingDistributionPanel(rows)}
        ${reactionSizePanel(rows)}
        ${issuePanel(rows)}
        <section class="review-analysis-card">
          <h4>채널별 현황</h4>
          ${reviewStatsTable(rows, (review) => review.channel, "채널")}
        </section>
      </div>

      <div class="review-analysis-grid second">
        <section class="review-analysis-card">
          <h4>시즌별 현황</h4>
          ${reviewStatsTable(rows, (review) => seasonCode(review.styleCode), "시즌")}
        </section>
        <section class="review-analysis-card">
          <h4>카테고리별 현황 <small>${numberFormat.format(new Set(rows.map((review) => reviewProductCategoryName(review.productName))).size)}종</small></h4>
          ${reviewStatsTable(rows, (review) => reviewProductCategoryName(review.productName), "카테고리")}
        </section>
      </div>

      ${reviewCardList(rows, "negative")}
      ${reviewCardList(rows, "positive")}
    </section>`;
}

function renderStyleReviewInsight(styleCode) {
  const row = baseRows().find((item) => item.styleCode === styleCode);
  const style = byStyle.get(styleCode) || row || {};

  const insight = reviewInsights[styleCode];
  const styleName = style.styleName || style.productName || insight?.styleName || styleCode;
  const analyzed = Number(insight?.analyzedReviews || 0);
  const total = Number(insight?.totalReviews || 0);
  const positive = Number(insight?.positiveCount || 0);
  const negative = Number(insight?.negativeCount || 0);
  const neutral = Number(insight?.neutralCount || 0);

  document.getElementById("reviewInsightTitle").textContent = `${styleCode} 리뷰 인사이트`;

  if (!insight) {
    return `<div class="empty">아직 이 스타일의 리뷰 인사이트 데이터가 없습니다. 구글시트에 해당 스타일코드 리뷰가 있으면 다음 업데이트 때 표시됩니다.</div>`;
  }

  return `
      <section class="review-hero">
        <div>
          <p class="eyebrow">STYLE REVIEW</p>
          <h3>${escapeHtml(styleName)}</h3>
          <span>${escapeHtml(styleCode)} · ${escapeHtml(insight.generatedAt || window.WHOAU_REVIEW_INSIGHTS?.generatedAt || "-")} 수집</span>
        </div>
        <div class="review-score">
          <strong>${insight.averageScore ? Number(insight.averageScore).toFixed(1) : "-"}</strong>
          <span>평균 평점</span>
        </div>
      </section>
      <div class="review-source-grid">${sourceCards(insight.sources || [])}</div>
      <div class="review-stat-grid">
        ${insightStat("통합 리뷰", `${numberFormat.format(total)}건`, `${numberFormat.format(analyzed)}건 분석`)}
        ${insightStat("긍정", `${numberFormat.format(positive)}건`, insightPercent(positive, analyzed))}
        ${insightStat("부정", `${numberFormat.format(negative)}건`, insightPercent(negative, analyzed))}
        ${insightStat("중립", `${numberFormat.format(neutral)}건`, insightPercent(neutral, analyzed))}
      </div>
      <section class="review-summary-panel">
        <h3>많이 나온 리뷰 흐름</h3>
        ${(insight.summary || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        <small>${escapeHtml(reviewPayload.sourceNote || "")}</small>
      </section>
      <div class="review-keyword-grid">
        <section>
          <h3>이슈 태그</h3>
          <div class="review-chip-list">${insightKeywordChips(insight.issueTags || insight.positiveKeywords || [], "이슈 태그 없음")}</div>
        </section>
        <section>
          <h3>사이즈 반응</h3>
          <div class="review-chip-list">${insightKeywordChips(insight.sizeTags || [], "사이즈 반응 없음")}</div>
        </section>
      </div>
      <div class="review-columns">
        <section>
          <h3>긍정 대표 리뷰</h3>
          ${insightReviewCards(sortPositiveReviews(insight.positiveReviews || []), "긍정 대표 리뷰가 없습니다.")}
        </section>
        <section>
          <h3>부정 대표 리뷰</h3>
          ${insightReviewCards(sortNegativeReviews((insight.negativeReviews || []).filter(isNegativeDisplayReview)), "부정 대표 리뷰가 없습니다.")}
        </section>
      </div>`;
}

function openReviewInsightModal(styleCode = "") {
  const modal = document.getElementById("reviewInsightModal");
  const body = document.getElementById("reviewInsightBody");
  body.innerHTML = styleCode ? renderStyleReviewInsight(styleCode) : renderReviewOverview();

  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeReviewInsightModal() {
  document.getElementById("reviewInsightModal").hidden = true;
  document.getElementById("reviewInsightBody").innerHTML = "";
  if (document.getElementById("detailModal").hidden && document.getElementById("coPurchaseModal").hidden) document.body.classList.remove("modal-open");
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
  const firstSale = firstSalesWeek(style);
  const firstSaleText = formatYmdLabel(style.firstSaleDate) || firstSale?.label || "";
  const salesWeeks = salesWeekCount(style);
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
        ${detailRow("판매 주수", salesWeeks ? `${numberFormat.format(salesWeeks)}주` : "-", firstSaleText ? `첫 판매 ${firstSaleText}` : "")}
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
      ${inlineStyleReviews(styleCode)}
    </section>
  </div>`;

  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetailModal() {
  document.getElementById("detailModal").hidden = true;
  document.getElementById("coPurchaseModal").hidden = true;
  document.getElementById("reviewInsightModal").hidden = true;
  document.getElementById("reviewInsightBody").innerHTML = "";
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
  const genderLabel = state.selectedGender === "all" ? "" : ` ${GENDER_FILTERS.find((gender) => gender.id === state.selectedGender)?.label || ""}`;
  document.getElementById("pageTitle").textContent = `${seasonLabel}${channelLabel}${genderLabel} ${metric.label} Top ${TOP_LIMIT}`;
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

document.getElementById("globalReviewInsightButton").addEventListener("click", () => openReviewInsightModal());

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

document.getElementById("genderTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-gender]");
  if (!button) return;
  state.selectedGender = button.dataset.gender;
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
  const target = event.target.closest(".thumb-button[data-style], .rank-row[data-style]");
  if (!target) return;
  openDetailModal(target.dataset.style);
});

document.getElementById("searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderTopList();
});

document.getElementById("modalClose").addEventListener("click", closeDetailModal);
document.getElementById("coPurchaseButton").addEventListener("click", () => openCoPurchaseModal());
document.getElementById("coPurchaseClose").addEventListener("click", closeCoPurchaseModal);
document.getElementById("reviewInsightClose").addEventListener("click", closeReviewInsightModal);
document.getElementById("modalBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-review-insight-style]");
  if (!button) return;
  openReviewInsightModal(button.dataset.reviewInsightStyle);
});
document.getElementById("detailModal").addEventListener("click", (event) => {
  if (event.target.id === "detailModal") closeDetailModal();
});
document.getElementById("coPurchaseModal").addEventListener("click", (event) => {
  if (event.target.id === "coPurchaseModal") closeCoPurchaseModal();
});
document.getElementById("reviewInsightModal").addEventListener("click", (event) => {
  const filterButton = event.target.closest("button[data-review-filter]");
  if (filterButton) {
    reviewDashboardState[filterButton.dataset.reviewFilter] = filterButton.dataset.value;
    document.getElementById("reviewInsightBody").innerHTML = renderReviewOverview();
    return;
  }
  if (event.target.closest("button[data-review-refresh]")) {
    window.location.reload();
    return;
  }
  const styleButton = event.target.closest("button[data-review-style]");
  if (styleButton) {
    openReviewInsightModal(styleButton.dataset.reviewStyle);
    return;
  }
  if (event.target.id === "reviewInsightModal") closeReviewInsightModal();
});
document.getElementById("reviewInsightModal").addEventListener("input", (event) => {
  if (event.target.id !== "reviewSearchInput") return;
  reviewDashboardState.query = event.target.value;
  document.getElementById("reviewInsightBody").innerHTML = renderReviewOverview();
  const input = document.getElementById("reviewSearchInput");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
});
document.getElementById("reviewInsightModal").addEventListener("change", (event) => {
  if (event.target.id !== "reviewCategorySelect") return;
  reviewDashboardState.category = event.target.value;
  document.getElementById("reviewInsightBody").innerHTML = renderReviewOverview();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!document.getElementById("reviewInsightModal").hidden) closeReviewInsightModal();
  else if (!document.getElementById("coPurchaseModal").hidden) closeCoPurchaseModal();
  else if (!document.getElementById("detailModal").hidden) closeDetailModal();
});

render();
