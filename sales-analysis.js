let data = { styles: [], dataWeekLabel: "-", source: "loading" };
const images = window.WHOAU_IMAGE_MAP?.images || {};
const similarMap = window.PROGRESS_SIMILAR_MAP?.map || {};

const MANAGED_PREFIXES = ["WHCK", "WHKA", "WHKV", "WHTA", "WHTH", "WHTJ"];
const SEASONS = {
  "26SS": { current: ["G1", "G2"], prior: ["F1", "F2"] },
  "26FW": { current: ["G3", "G4"], prior: ["F3", "F4"] },
};
const ITEM_GROUPS = [
  { id: "all", label: "전체", prefixes: null },
  { id: "woven", label: "우븐 하의", prefixes: ["WHTA", "WHTH"] },
  { id: "denim", label: "데님", prefixes: ["WHTJ"] },
  { id: "cardigan", label: "가디건", prefixes: ["WHCK"] },
  { id: "pullover", label: "풀오버", prefixes: ["WHKA", "WHKV"] },
];

const state = {
  view: "style",
  season: "26SS",
  query: "",
};

const STYLE_GROUPS = [
  { id: "cardigan", label: "가디건", prefixes: ["WHCK"] },
  { id: "pullover", label: "풀오버", prefixes: ["WHKA", "WHKV"] },
  { id: "woven", label: "우븐 하의", prefixes: ["WHTA", "WHTH"] },
  { id: "denim", label: "데님", prefixes: ["WHTJ"] },
];
const COLOR_NAMES = {
  "10": "White", "11": "Camel", "15": "Grey", "16": "L/Grey", "17": "D/Grey", "18": "M/Grey", "19": "Black",
  "20": "Red", "21": "D/Red", "22": "D/BROWN", "25": "Pink", "26": "L/Pink", "27": "D/Pink", "29": "Burgundy",
  "30": "Yellow", "31": "L/Yellow", "33": "OATMEAL", "35": "Beige", "36": "L/Beige", "37": "D/Beige", "39": "Ivory",
  "40": "Green", "41": "L/Green", "45": "Yellow Green", "49": "Khaki", "50": "Blue", "51": "L/Blue", "52": "D/BLUE",
  "55": "Indigo", "56": "L/Indigo", "57": "D/Indigo", "58": "D/KHAKI", "59": "Navy", "60": "Charcoal", "61": "CORAL",
  "62": "Hunter", "63": "Royal", "64": "Cream", "70": "Violet", "75": "Purple", "76": "L/Purple", "77": "EMERALD",
  "79": "Olive Green", "80": "Orange", "84": "MINT", "85": "Brown", "86": "86", "91": "Silver", "99": "MIX",
  AA: "Light Melange Gray", AB: "Middle Melange Gray", AC: "Melange Gray", AD: "Dark Melange Gray", AF: "AF",
  BC: "BC", BD: "BD", BF: "BF", BI: "BI", BJ: "BJ", BL: "BL", BM: "BM", BN: "BN", BO: "BO",
  BS: "Dark Green", BT: "BT", BU: "Light Khaki", BV: "BV", CD: "CD", CH: "CH", CI: "CI",
};

const fmt = new Intl.NumberFormat("ko-KR");
const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
let styles = [];
let byCode = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function seasonCode(styleCode) {
  return String(styleCode || "").slice(4, 6);
}

function yearMarker(styleCode) {
  return String(styleCode || "").slice(4, 5).toUpperCase();
}

function inSeason(style, type = "current") {
  const marker = type === "prior" ? "F" : "G";
  return yearMarker(style.styleCode) === marker && SEASONS[state.season][type].includes(seasonCode(style.styleCode));
}

function isManaged(style) {
  return MANAGED_PREFIXES.some((prefix) => style.styleCode.startsWith(prefix));
}

function groupFor(style) {
  return ITEM_GROUPS.find((group) => group.id !== "all" && group.prefixes.some((prefix) => style.styleCode.startsWith(prefix)))?.label || "기타";
}

function rowsFor(prefixes, type = "current") {
  return styles.filter((style) => inSeason(style, type) && (!prefixes || prefixes.some((prefix) => style.styleCode.startsWith(prefix))));
}

function managedRows() {
  const query = state.query.trim().toUpperCase();
  return rowsFor(MANAGED_PREFIXES)
    .filter((style) => !query || style.styleCode.toUpperCase().includes(query) || String(style.styleName || "").toUpperCase().includes(query))
    .sort((a, b) => a.styleCode.localeCompare(b.styleCode));
}

function safeDivide(a, b) {
  const denominator = Number(b || 0);
  return denominator ? Number(a || 0) / denominator : 0;
}

function pct(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function ppGrowth(current, prior) {
  if (!prior) return "";
  return safeDivide(current - prior, Math.abs(prior));
}

function wonMan(value) {
  return `${money.format(Math.round(Number(value || 0) / 1000000))}백만`;
}

function qty(value) {
  return fmt.format(Math.round(Number(value || 0)));
}

function latestWeek(style) {
  const label = data.targetWeekLabel || data.latestWeekLabel || data.latestWeek;
  return style.weekly?.find((week) => week.label === label) || style.weekly?.at(-1) || {};
}

function priorWeek(style) {
  const weekly = style.weekly || [];
  const latest = latestWeek(style);
  const index = weekly.findIndex((week) => week === latest);
  return index > 0 ? weekly[index - 1] : {};
}

function metrics(style) {
  const week = latestWeek(style);
  const inboundQty = Number(style.inboundQty || 0);
  const orderQty = Number(style.orderQty || 0);
  const totalQty = Number(style.totalQty || 0);
  const totalNormalQty = Number(style.totalNormalQty || 0);
  const totalSalesAmount = Number(style.totalSalesAmount || 0);
  const totalNormalAmount = Number(style.totalNormalAmount || 0);
  const weeklyQty = Number(week.actualQty || 0);
  const weeklyAmount = Number(week.salesAmount || 0);
  const weeklyNormalQty = Number(week.normalQty || 0);
  const weeklyNormalAmount = Number(week.normalAmount || 0);
  return {
    orderQty,
    orderAmount: Number(style.orderAmount || orderQty * Number(style.price || 0)),
    inboundQty,
    inboundAmount: inboundQty * Number(style.price || 0),
    outboundQty: inboundQty,
    weeklyQty,
    weeklyAmount,
    weeklyNormalQty,
    weeklyNormalAmount,
    normalQty: totalNormalQty,
    normalAmount: totalNormalAmount,
    totalQty,
    totalSalesAmount,
    totalNormalQty,
    totalNormalAmount,
    price: Number(style.price || 0),
    currentPrice: safeDivide(totalSalesAmount, totalQty),
    inboundRate: safeDivide(inboundQty, orderQty),
    outboundRate: safeDivide(inboundQty, inboundQty),
    weeklyRate: safeDivide(weeklyQty, inboundQty),
    normalRate: safeDivide(totalNormalQty, inboundQty),
    totalRate: safeDivide(totalQty, inboundQty),
  };
}

function aggregate(rows) {
  const total = rows.reduce((sum, style) => {
    const m = metrics(style);
    sum.orderQty += m.orderQty;
    sum.orderAmount += m.orderAmount;
    sum.inboundQty += m.inboundQty;
    sum.inboundAmount += m.inboundAmount;
    sum.weeklyQty += m.weeklyQty;
    sum.weeklyAmount += m.weeklyAmount;
    sum.totalQty += m.totalQty;
    sum.totalSalesAmount += m.totalSalesAmount;
    sum.normalQty += m.totalNormalQty;
    sum.normalAmount += m.totalNormalAmount;
    return sum;
  }, { orderQty: 0, orderAmount: 0, inboundQty: 0, inboundAmount: 0, weeklyQty: 0, weeklyAmount: 0, totalQty: 0, totalSalesAmount: 0, normalQty: 0, normalAmount: 0 });
  return {
    ...total,
    orderRate: safeDivide(total.inboundQty, total.orderQty),
    weeklyRate: safeDivide(total.weeklyQty, total.inboundQty),
    totalRate: safeDivide(total.totalQty, total.inboundQty),
    normalRate: safeDivide(total.normalQty, total.inboundQty),
  };
}

function similarPrior(style) {
  const priorCode = similarMap[style.styleCode] || similarMap[`${style.styleCode}0`];
  return priorCode ? byCode.get(priorCode) : null;
}

function styleImage(style) {
  const image = images[style.styleCode]?.imageUrl;
  if (!image) return `<span class="no-image">이미지 없음</span>`;
  return `<img src="${escapeHtml(image)}" alt="${escapeHtml(style.styleName || style.styleCode)}" loading="lazy" />`;
}

function colorRows(style) {
  const colors = style.colors || style.skuPlan || [];
  if (!colors.length) return `<span class="empty-note">컬러 데이터 없음</span>`;
  return `<div class="color-lines">${colors.map((color) => {
    const inbound = Number(color.inboundQty || color.inQty || 0);
    const weekly = Number(color.weeklyQty || color.weekQty || 0);
    const total = Number(color.totalQty || color.salesQty || 0);
    return `<div class="color-line">
      <strong>${escapeHtml(color.colorName || color.color || color.name || "-")}</strong>
      <span>${qty(inbound)}</span><span>${pct(safeDivide(inbound, metrics(style).inboundQty))}</span>
      <span>${qty(weekly)}</span><span>${pct(safeDivide(weekly, inbound))}</span>
      <span>${qty(total)}</span><span>${pct(safeDivide(total, inbound))}</span>
    </div>`;
  }).join("")}</div>`;
}

function renderStyleTable() {
  const rows = managedRows();
  const table = document.getElementById("styleTable");
  table.style.minWidth = `${190 + Math.max(rows.length, 1) * 260}px`;
  const headers = rows.map((style) => `<th class="code-head">${escapeHtml(style.styleCode)}</th>`).join("");
  const tableRows = [
    ["스타일명", (style) => escapeHtml(style.styleName || "-")],
    ["이미지", (style) => `<div class="style-card"><div class="style-name">${escapeHtml(style.styleName || "-")}</div><div class="style-image-wrap">${styleImage(style)}</div><div class="buyer">${groupFor(style)}</div></div>`],
    ["결판가", (style) => money.format(metrics(style).price)],
    ["현판가", (style) => money.format(Math.round(metrics(style).currentPrice || metrics(style).price))],
    ["발주량/액", (style) => `${qty(metrics(style).orderQty)} / ${wonMan(metrics(style).orderAmount)}`],
    ["입고량/율", (style) => `${qty(metrics(style).inboundQty)} / ${pct(metrics(style).inboundRate)}`],
    ["출고량/율", (style) => `${qty(metrics(style).outboundQty)} / ${pct(metrics(style).outboundRate)}`],
    ["주판량/율", (style) => `${qty(metrics(style).weeklyQty)} / ${pct(metrics(style).weeklyRate, 1)}`],
    ["정판량/율", (style) => `${qty(metrics(style).normalQty)} / ${pct(metrics(style).normalRate, 1)}`],
    ["판매량/소진율", (style) => `<span class="danger-text">${qty(metrics(style).totalQty)} / ${pct(metrics(style).totalRate, 1)}</span>`],
    ["컬러별<br>입고 · 주판 · 누판", colorRows],
    ["원가율/CR", () => "-"],
    ["출고일", () => "-"],
    ["비고", (style) => similarPrior(style) ? `유사: ${escapeHtml(similarPrior(style).styleCode)}` : ""],
  ];

  table.innerHTML = `
    <colgroup>
      <col class="label-col" />
      ${rows.length ? rows.map(() => `<col class="style-col" />`).join("") : `<col class="style-col" />`}
    </colgroup>
    <thead>
      <tr><th class="group-head row-head">원</th><th class="group-head" colspan="${Math.max(rows.length, 1)}">담당 아이템</th></tr>
      <tr><th class="row-head">스타일코드</th>${headers || "<th>대상 스타일 없음</th>"}</tr>
    </thead>
    <tbody>
      ${tableRows.map(([label, getter], index) => `<tr class="${index === 9 ? "highlight" : "metric-row"}">
        <th class="row-head">${label}</th>
        ${rows.length ? rows.map((style) => `<td class="style-cell">${getter(style)}</td>`).join("") : "<td>-</td>"}
      </tr>`).join("")}
    </tbody>`;
}

function colorCodeOf(color) {
  return String(color.colorCode || color.styleColorCode || color.color || "")
    .slice(-2)
    .toUpperCase();
}

function colorNameOf(color) {
  const code = colorCodeOf(color);
  return COLOR_NAMES[code] || color.colorName || color.name || code || "-";
}

function colorRows(style) {
  const colors = (style.colors || style.skuPlan || [])
    .map((color) => ({ ...color, displayCode: colorCodeOf(color), displayName: colorNameOf(color) }))
    .filter((color) => color.displayCode && color.displayCode !== "NA" && color.displayName !== "NA")
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  if (!colors.length) return `<span class="empty-note">컬러 데이터 없음</span>`;
  const styleMetrics = metrics(style);
  return `<div class="color-lines">
    <div class="color-head"><span>Color</span><span>입고</span><span>주판</span><span>누판</span></div>
    ${colors.map((color) => {
      const inbound = Number(color.inboundQty || color.inQty || 0);
      const weekly = Number(color.weeklyQty || color.weekQty || 0);
      const total = Number(color.totalQty || color.salesQty || 0);
      return `<div class="color-line">
        <strong title="${escapeHtml(color.displayCode)}">${escapeHtml(color.displayName)}</strong>
        <span>${qty(inbound)} <em>${pct(safeDivide(inbound, styleMetrics.inboundQty))}</em></span>
        <span>${qty(weekly)} <em>${pct(safeDivide(weekly, inbound))}</em></span>
        <span>${qty(total)} <em>${pct(safeDivide(total, inbound))}</em></span>
      </div>`;
    }).join("")}
  </div>`;
}

function chunkRows(rows, size = 5) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function buildStyleTable(group, rows, chunkIndex) {
  const tableRows = [
    ["스타일명", (style) => escapeHtml(style.styleName || "-")],
    ["이미지", (style) => `<div class="style-card"><div class="style-name">${escapeHtml(style.styleName || "-")}</div><div class="style-image-wrap">${styleImage(style)}</div><div class="buyer">${escapeHtml(group.label)}</div></div>`],
    ["결판가", (style) => money.format(metrics(style).price)],
    ["현판가", (style) => money.format(Math.round(metrics(style).currentPrice || metrics(style).price))],
    ["발주량/액", (style) => `${qty(metrics(style).orderQty)} / ${wonMan(metrics(style).orderAmount)}`],
    ["입고량/율", (style) => `${qty(metrics(style).inboundQty)} / ${pct(metrics(style).inboundRate)}`],
    ["출고량/율", (style) => `${qty(metrics(style).outboundQty)} / ${pct(metrics(style).outboundRate)}`],
    ["주판량/율", (style) => `${qty(metrics(style).weeklyQty)} / ${pct(metrics(style).weeklyRate, 1)}`],
    ["정판량/율", (style) => `${qty(metrics(style).normalQty)} / ${pct(metrics(style).normalRate, 1)}`],
    ["판매량/소진율", (style) => `<span class="danger-text">${qty(metrics(style).totalQty)} / ${pct(metrics(style).totalRate, 1)}</span>`],
    ["컬러별", colorRows],
    ["원가율/CR", () => "-"],
    ["출고일", () => "-"],
    ["비고", (style) => similarPrior(style) ? `유사: ${escapeHtml(similarPrior(style).styleCode)}` : ""],
  ];
  const blanks = Math.max(0, 5 - rows.length);
  const displayRows = [...rows, ...Array.from({ length: blanks }, () => null)];
  return `<table class="style-analysis-table">
    <colgroup><col class="label-col" />${displayRows.map(() => `<col class="style-col" />`).join("")}</colgroup>
    <thead>
      <tr><th class="group-head row-head">${escapeHtml(group.label)}</th><th class="group-head" colspan="5">${escapeHtml(group.label)} ${chunkIndex + 1}</th></tr>
      <tr><th class="row-head">스타일코드</th>${displayRows.map((style) => `<th class="code-head">${style ? escapeHtml(style.styleCode) : ""}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${tableRows.map(([label, getter], index) => `<tr class="${index === 9 ? "highlight" : "metric-row"}">
        <th class="row-head">${label}</th>
        ${displayRows.map((style) => `<td class="style-cell">${style ? getter(style) : ""}</td>`).join("")}
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderStyleTable() {
  const container = document.getElementById("styleTable");
  const rows = managedRows();
  if (!rows.length) {
    container.innerHTML = `<div class="empty-panel">대상 스타일 없음</div>`;
    return;
  }
  container.innerHTML = STYLE_GROUPS.map((group) => {
    const groupRows = rows.filter((style) => group.prefixes.some((prefix) => style.styleCode.startsWith(prefix)));
    if (!groupRows.length) return "";
    return `<section class="style-group-section">
      <header><strong>${escapeHtml(group.label)}</strong><span>${qty(groupRows.length)} styles</span></header>
      <div class="style-table-stack">${chunkRows(groupRows, 5).map((chunk, index) => buildStyleTable(group, chunk, index)).join("")}</div>
    </section>`;
  }).join("");
}

function summaryRows() {
  return ITEM_GROUPS.map((group) => {
    const current = aggregate(rowsFor(group.prefixes));
    const prior = aggregate(rowsFor(group.prefixes, "prior"));
    return { group, current, prior };
  });
}

function renderSummaryCards(rows) {
  const managed = aggregate(rowsFor(MANAGED_PREFIXES));
  const all = aggregate(rowsFor(null));
  document.getElementById("summaryCards").innerHTML = [
    ["브랜드 전체 스타일", `${qty(rowsFor(null).length)}개`],
    ["담당 아이템 스타일", `${qty(rowsFor(MANAGED_PREFIXES).length)}개`],
    ["담당 주판액", wonMan(managed.weeklyAmount)],
    ["담당 누판율", pct(managed.totalRate, 1)],
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function growthClass(value) {
  if (value === "") return "";
  return Number(value) >= 0 ? "up" : "down";
}

function growthText(current, prior) {
  if (!prior) return "-";
  return pct(ppGrowth(current, prior), 0);
}

function renderSummaryTable() {
  const rows = summaryRows();
  renderSummaryCards(rows);
  const metricHeads = ["발주액", "입고액", "주판액", "누판액", "정판액"];
  document.getElementById("summaryTable").innerHTML = `
    <thead>
      <tr>
        <th rowspan="2" class="top">구분</th>
        ${metricHeads.map((head) => `<th class="top" colspan="3">${head}</th>`).join("")}
        <th class="top" colspan="2">주판율</th>
        <th class="top" colspan="2">누판율</th>
        <th class="top" colspan="2">정판율</th>
      </tr>
      <tr>
        ${metricHeads.map(() => `<th>26</th><th>25</th><th>성장률</th>`).join("")}
        <th>26</th><th>25</th><th>26</th><th>25</th><th>26</th><th>25</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(({ group, current, prior }) => {
        const pairs = [
          ["orderAmount", current.orderAmount, prior.orderAmount],
          ["inboundAmount", current.inboundAmount, prior.inboundAmount],
          ["weeklyAmount", current.weeklyAmount, prior.weeklyAmount],
          ["totalSalesAmount", current.totalSalesAmount, prior.totalSalesAmount],
          ["normalAmount", current.normalAmount, prior.normalAmount],
        ];
        return `<tr>
          <th class="name">${group.label}</th>
          ${pairs.map(([, currentValue, priorValue]) => {
            const growth = priorValue ? ppGrowth(currentValue, priorValue) : "";
            return `<td class="current">${wonMan(currentValue)}</td><td>${priorValue ? wonMan(priorValue) : "-"}</td><td class="growth ${growthClass(growth)}">${growth === "" ? "-" : pct(growth, 0)}</td>`;
          }).join("")}
          <td>${pct(current.weeklyRate, 0)}</td><td>${prior.inboundQty ? pct(prior.weeklyRate, 0) : "-"}</td>
          <td>${pct(current.totalRate, 0)}</td><td>${prior.inboundQty ? pct(prior.totalRate, 0) : "-"}</td>
          <td>${pct(current.normalRate, 0)}</td><td>${prior.inboundQty ? pct(prior.normalRate, 0) : "-"}</td>
        </tr>`;
      }).join("")}
    </tbody>`;
}

function rankRows(rows, sorter, valueGetter, formatter = (value) => money.format(Math.round(value))) {
  return [...rows].sort(sorter).slice(0, 10).map((style, index) => {
    const value = valueGetter(style);
    const valueText = formatter(value);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(style.styleCode)}</td><td>${escapeHtml(style.styleName || "-")}</td><td>${valueText}</td></tr>`;
  }).join("");
}

function emptyRank(message) {
  return `<tr class="empty"><td colspan="4">${message}</td></tr>`;
}

function renderRankTable(id, titleValue, body) {
  document.getElementById(id).innerHTML = `<thead><tr><th>순위</th><th>스타일코드</th><th>스타일명</th><th>${titleValue}</th></tr></thead><tbody>${body}</tbody>`;
}

function renderRanks() {
  const current = rowsFor(MANAGED_PREFIXES);
  const prior = rowsFor(MANAGED_PREFIXES, "prior");
  renderRankTable("weeklyAmountTop", "외형매출", rankRows(current, (a, b) => metrics(b).weeklyAmount - metrics(a).weeklyAmount, (style) => metrics(style).weeklyAmount));
  renderRankTable("weeklyRateTop", "주판율", rankRows(current, (a, b) => metrics(b).weeklyRate - metrics(a).weeklyRate, (style) => metrics(style).weeklyRate, (value) => pct(value, 1)));
  renderRankTable("priorAmountTop", "외형매출", prior.length ? rankRows(prior, (a, b) => metrics(b).weeklyAmount - metrics(a).weeklyAmount, (style) => metrics(style).weeklyAmount) : emptyRank("전년 원천 데이터가 들어오면 자동 표시됩니다."));
  renderRankTable("priorRateTop", "주판율", prior.length ? rankRows(prior, (a, b) => metrics(b).weeklyRate - metrics(a).weeklyRate, (style) => metrics(style).weeklyRate, (value) => pct(value, 1)) : emptyRank("전년 원천 데이터가 들어오면 자동 표시됩니다."));

  const growthRows = current.map((style) => {
    const priorStyle = similarPrior(style);
    if (!priorStyle) return null;
    const now = metrics(style);
    const before = metrics(priorStyle);
    return { ...style, weeklyGrowth: ppGrowth(now.weeklyQty, before.weeklyQty), totalGrowth: ppGrowth(now.totalQty, before.totalQty) };
  }).filter(Boolean);

  const growthBody = (key, desc) => {
    if (!growthRows.length) return emptyRank("유사 스타일 매칭/전년 데이터가 들어오면 자동 표시됩니다.");
    return rankRows(growthRows, (a, b) => desc ? b[key] - a[key] : a[key] - b[key], (style) => style[key], (value) => pct(value, 0));
  };
  renderRankTable("growthWeeklyBest", "성장률", growthBody("weeklyGrowth", true));
  renderRankTable("growthWeeklyWorst", "성장률", growthBody("weeklyGrowth", false));
  renderRankTable("growthTotalBest", "성장률", growthBody("totalGrowth", true));
  renderRankTable("growthTotalWorst", "성장률", growthBody("totalGrowth", false));
}

function render() {
  document.getElementById("dataWeek").textContent = data.dataWeekLabel || data.targetWeekLabel || "-";
  document.getElementById("seasonLabel").textContent = state.season;
  renderStyleTable();
  renderSummaryTable();
  renderRanks();
}

async function loadSalesData() {
  document.getElementById("dataWeek").textContent = "DB 조회중";
  try {
    const response = await fetch("/api/sales-analysis", { cache: "no-store" });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }
    data = await response.json();
    styles = data.styles || [];
    byCode = new Map(styles.map((row) => [row.styleCode, row]));
    render();
  } catch (error) {
    document.getElementById("dataWeek").textContent = "DB 오류";
    document.getElementById("styleTable").innerHTML = `<tbody><tr><th class="row-head">오류</th><td>DB 데이터를 불러오지 못했습니다: ${escapeHtml(error.message)}</td></tr></tbody>`;
    document.getElementById("summaryCards").innerHTML = `<article><span>오류</span><strong>DB 조회 실패</strong></article>`;
    document.getElementById("summaryTable").innerHTML = "";
  }
}

document.querySelectorAll(".top-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll(".top-tabs button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${state.view}View`));
  });
});

document.querySelectorAll(".season-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    state.season = button.dataset.season;
    document.querySelectorAll(".season-tabs button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

document.getElementById("styleSearch").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderStyleTable();
});

loadSalesData();
