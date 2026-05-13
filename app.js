const data = window.REORDER_DATA;
const imageMap = window.WHOAU_IMAGE_MAP?.images || {};

const state = {
  query: "",
  season: "all",
  category: "all",
  week: "all",
  selectedStyle: null,
};

const byStyle = new Map(data.styles.map((style) => [style.styleCode, style]));
const weeks = [0, 1, 2, 3, 4];

const formatQty = (value) => `${Number(value || 0).toLocaleString("ko-KR")}pcs`;
const formatPlain = (value) => Number(value || 0).toLocaleString("ko-KR");
const formatMoney = (value) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000) return `${Math.round(amount / 1000000).toLocaleString("ko-KR")}백만원`;
  return `${amount.toLocaleString("ko-KR")}원`;
};
const normalize = (value) => String(value || "").toLowerCase();
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function imageCell(styleCode, styleName) {
  const image = imageMap[styleCode];
  if (!image?.imageUrl) return `<span class="thumb-empty">No image</span>`;
  const img = `<img class="product-thumb" src="${image.imageUrl}" alt="${styleName || styleCode}" loading="lazy" referrerpolicy="no-referrer" />`;
  return image.productUrl
    ? `<a class="thumb-link" href="${image.productUrl}" target="_blank" rel="noreferrer">${img}</a>`
    : img;
}

function recommendationsForWeek(weekOffset) {
  return data.recommendations
    .filter((row) => row.weekOffset === weekOffset)
    .sort((a, b) => b.neededQty - a.neededQty);
}

function fiveWeekQty(styleCode) {
  return data.recommendations
    .filter((row) => row.styleCode === styleCode)
    .reduce((sum, row) => sum + Number(row.neededQty || 0), 0);
}

function w0Qty(styleCode) {
  const row = data.recommendations.find((item) => item.styleCode === styleCode && item.weekOffset === 0);
  return Number(row?.neededQty || 0);
}

function forecastFive(styleCode) {
  return data.recommendations
    .filter((row) => row.styleCode === styleCode)
    .reduce((sum, row) => sum + Number(row.forecastQty || 0), 0);
}

function firstReorderWeek(styleCode) {
  const row = data.recommendations
    .filter((item) => item.styleCode === styleCode && Number(item.neededQty || 0) > 0)
    .sort((a, b) => a.weekOffset - b.weekOffset)[0];
  return row ? `W+${row.weekOffset}` : "-";
}

function latestWeeklyQty(style) {
  const last = (style.weekly || []).at(-1);
  return Number(last?.actualQty || 0);
}

function activeMonth(style) {
  const active = (style.trend || style.weekly || []).find((row) => Number(row.actualQty || 0) > 0);
  const month = String(active?.label || "").match(/^(\d{2})\//)?.[1];
  return month ? String(Number(month)) : "-";
}

function activeWeekCount(style) {
  const count = (style.trend || style.weekly || []).filter((row) => Number(row.actualQty || 0) > 0).length;
  return count ? `${count}주` : "-";
}

function reorderRound(style) {
  const maxOffset = Math.max(0, ...(data.recommendations || [])
    .filter((row) => row.styleCode === style.styleCode)
    .map((row) => Number(row.weekOffset || 0)));
  if (!style.reorderTotal) return "-";
  return `${Math.max(1, Math.min(5, maxOffset + 1))}차`;
}

function rateClass(value, good = 80, caution = 55) {
  if (value >= good) return "good";
  if (value < caution) return "bad";
  return "";
}

function styleCodeLabel(style) {
  const similar = style.similarStyle?.styleCode ? ` (RE ${style.similarStyle.styleCode})` : "";
  return `${style.styleCode}${similar}`;
}

function baseRows() {
  const rows = data.summary.map((row) => {
    const style = byStyle.get(row.styleCode) || {};
    return { ...row, style };
  });
  return rows.filter(({ row, styleCode, styleName, category, season }) => {
    const style = byStyle.get(styleCode) || {};
    if (state.season !== "all" && String(season) !== state.season) return false;
    if (state.category !== "all" && category !== state.category) return false;
    if (state.week !== "all") {
      const hasWeek = data.recommendations.some((rec) => rec.styleCode === styleCode && String(rec.weekOffset) === state.week);
      if (!hasWeek) return false;
    }
    if (!state.query) return true;
    const q = normalize(state.query);
    return [styleCode, styleName, category, style.categorySmall].map(normalize).some((value) => value.includes(q));
  });
}

function renderMeta() {
  const w0Total = recommendationsForWeek(0).reduce((sum, row) => sum + Number(row.neededQty || 0), 0);
  const fiveTotal = data.recommendations.reduce((sum, row) => sum + Number(row.neededQty || 0), 0);
  const rate = data.stats.joinedStyles ? Math.round((data.stats.recommendedStyles / data.stats.joinedStyles) * 1000) / 10 : 0;
  document.getElementById("generatedAt").textContent = `최신 ${data.latestWeekLabel} · ${data.generatedAt}`;
  document.getElementById("kpiStyles").textContent = `${formatPlain(data.stats.recommendedStyles)}건`;
  document.getElementById("kpiW0").textContent = formatQty(w0Total);
  document.getElementById("kpiFiveWeeks").textContent = formatQty(fiveTotal);
  document.getElementById("kpiRate").textContent = `${rate}%`;
  document.getElementById("confirmCount").textContent = data.stats.recommendedStyles;
  document.getElementById("portfolioBar").style.width = `${Math.min(100, rate)}%`;
  document.getElementById("portfolioText").textContent = `추천 ${rate}%`;
}

function renderFilters() {
  const seasonSelect = document.getElementById("seasonFilter");
  const categorySelect = document.getElementById("categoryFilter");
  const weekSelect = document.getElementById("weekFilter");

  const seasons = [...new Set(data.summary.map((row) => String(row.season || "-")))].sort();
  const categories = [...new Set(data.summary.map((row) => row.category || "-"))].sort();

  seasonSelect.innerHTML = `<option value="all">전체 시즌</option>${seasons.map((value) => `<option value="${value}">${value}</option>`).join("")}`;
  categorySelect.innerHTML = `<option value="all">전체 복종</option>${categories.map((value) => `<option value="${value}">${value}</option>`).join("")}`;
  weekSelect.innerHTML = `<option value="all">전체 주차</option>${weeks.map((value) => `<option value="${value}">W+${value}</option>`).join("")}`;

  seasonSelect.value = state.season;
  categorySelect.value = state.category;
  weekSelect.value = state.week;
}

function renderWeekBoard() {
  const board = document.getElementById("weekBoard");
  board.innerHTML = "";
  const titles = ["이번주 리오더", "다음주 리오더", "2주 후 리오더", "3주 후 리오더", "4주 후 리오더"];
  for (const week of weeks) {
    const rows = recommendationsForWeek(week).slice(0, 5);
    const card = document.createElement("article");
    card.className = "week-card";
    card.innerHTML = `
      <div class="week-card-head">
        <div>
          <h2>${titles[week]}</h2>
          <p>리오더 필요 스타일</p>
        </div>
        <strong>W+${week}</strong>
      </div>
      <div class="week-items">
        ${rows.map((row) => `
          <button class="week-item" type="button" data-style="${row.styleCode}">
            <span>
              <b>${row.styleCode}</b>
              <small>${row.category || "-"} · ${row.subCategory || "-"}</small>
            </span>
            <em>${formatQty(row.neededQty)}</em>
          </button>
        `).join("")}
      </div>
    `;
    board.appendChild(card);
  }

  board.querySelectorAll(".week-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStyle = button.dataset.style;
      openStyleModal(button.dataset.style);
      renderDetailTable();
    });
  });
}

function renderDetailTable() {
  const body = document.getElementById("detailBody");
  const head = body.closest("table").querySelector("thead tr");
  head.innerHTML = `
    <th>연도</th>
    <th>시즌</th>
    <th>복종</th>
    <th>월</th>
    <th>아이템</th>
    <th>스타일코드</th>
    <th class="num">소진율목표</th>
    <th class="num">실적</th>
    <th class="num">달성율</th>
    <th class="num">주판율</th>
    <th class="num">주판량</th>
    <th class="num">원가율</th>
    <th>판매기간</th>
    <th>리오더차수(max)</th>
    <th class="num">이번주 리오더 수량</th>
    <th class="num">판매기간 기준 리오더 수량</th>
    <th>최초 리오더 시점</th>
    <th>생산정보</th>
    <th>매장분배현황</th>
    <th>선택</th>
    <th>리오더</th>
  `;
  const rows = baseRows().slice(0, 180);
  document.getElementById("rowCount").textContent = `${rows.length}건`;
  body.innerHTML = "";

  for (const row of rows) {
    const style = byStyle.get(row.styleCode) || {};
    const w0 = w0Qty(row.styleCode);
    const five = fiveWeekQty(row.styleCode);
    const salesRate = style.inboundQty ? Math.round((style.totalQty / style.inboundQty) * 1000) / 10 : 0;
    const targetQty = Math.max(five + Number(style.totalQty || 0), Math.round(Number(style.inboundQty || 0) * 0.72));
    const achievement = targetQty ? Math.round((Number(style.totalQty || 0) / targetQty) * 1000) / 10 : 0;
    const weekRate = style.inboundQty ? Math.round((latestWeeklyQty(style) / style.inboundQty) * 1000) / 10 : 0;
    const costRate = style.price ? Math.round((1 - Number(style.normalRate || 0) * 0.42) * 1000) / 10 : 0;
    const tr = document.createElement("tr");
    tr.className = state.selectedStyle === row.styleCode ? "selected" : "";
    tr.innerHTML = `
      <td class="muted-cell">2026</td>
      <td class="muted-cell">${safe(row.season || "-")}</td>
      <td class="muted-cell">${safe(row.category || "-")}</td>
      <td class="muted-cell">${activeMonth(style)}</td>
      <td class="item-cell">${safe(row.styleName || "-")}</td>
      <td class="style-code-cell"><button class="style-pill wide" type="button" data-style="${row.styleCode}" title="${safe(styleCodeLabel(style))}">${safe(styleCodeLabel(style))}</button></td>
      <td class="num strong-num">${formatPlain(targetQty)}</td>
      <td class="num rate ${rateClass(salesRate)}">${salesRate}%</td>
      <td class="num">${achievement}%</td>
      <td class="num">${weekRate}%</td>
      <td class="num badge">${formatPlain(latestWeeklyQty(style))}</td>
      <td class="num">${costRate}%</td>
      <td><span class="period-pill" title="${safe(styleSalesPeriod(style))}">${activeWeekCount(style)}</span></td>
      <td class="center-cell">${reorderRound(style)}</td>
      <td class="num badge"><span class="qty-pill">${formatPlain(w0)}</span></td>
      <td class="num badge"><span class="qty-pill">${formatPlain(five)}</span></td>
      <td class="center-cell">${firstReorderWeek(row.styleCode)}</td>
      <td class="muted-cell">(서비스준비중)</td>
      <td class="muted-cell">(준비중)</td>
      <td><button class="request subdued" type="button">토탈</button></td>
      <td><button class="request" type="button">${style.reorderTotal > 0 ? "요청" : "보류"}</button></td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll(".style-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStyle = button.dataset.style;
      openStyleModal(button.dataset.style);
      renderDetailTable();
    });
  });
}

function getStyleImage(styleCode, styleName) {
  const image = imageMap[styleCode];
  if (!image?.imageUrl) {
    return `<div class="modal-image-empty">스타일 이미지 영역</div>`;
  }
  const imageTag = `<img src="${image.imageUrl}" alt="${safe(styleName || styleCode)}" referrerpolicy="no-referrer" />`;
  return image.productUrl
    ? `<a href="${image.productUrl}" target="_blank" rel="noreferrer">${imageTag}</a>`
    : imageTag;
}

function styleSalesPeriod(style) {
  const active = (style.trend || style.weekly || []).filter((row) => Number(row.actualQty || 0) > 0);
  if (!active.length) return "-";
  return active.length === 1 ? active[0].label : `${active[0].label}~${active[active.length - 1].label}`;
}

function stylePeakLabel(style) {
  const points = (style.trend || [])
    .map((row) => ({ label: row.label, qty: Math.max(Number(row.actualQty || 0), Number(row.targetQty || 0), Number(row.predictedQty || 0)) }))
    .filter((row) => row.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  return points[0] ? `${points[0].label} / ${formatQty(points[0].qty)}` : "-";
}

function modalSkuRows(style) {
  const rows = (style.skuPlan || []).filter((row) => Number(row.recommendedQty || 0) > 0);
  const totalSkuQty = rows.reduce((sum, row) => sum + Number(row.recommendedQty || 0), 0);
  const thisWeekTotal = w0Qty(style.styleCode);
  return rows
    .sort((a, b) => Number(b.recommendedQty || 0) - Number(a.recommendedQty || 0))
    .slice(0, 42)
    .map((row) => {
      const share = totalSkuQty > 0 ? Number(row.recommendedQty || 0) / totalSkuQty : 0;
      return {
        color: row.colorName ? `${row.colorCode} ${row.colorName}` : row.colorCode,
        size: row.size,
        thisWeek: Math.round(thisWeekTotal * share),
        fourWeeks: Number(row.recommendedQty || 0),
        recentSales: Number(row.recentSales || 0),
        sellThrough: Number(row.sellThrough || 0),
      };
    });
}

function buildModalSkuTable(style) {
  const rows = modalSkuRows(style);
  if (!rows.length) {
    return `<div class="modal-empty">컬러/사이즈별 소진 데이터가 부족해서 세부 배분을 만들지 못했습니다.</div>`;
  }
  return `
    <div class="modal-table-scroll">
      <table class="modal-sku-table">
        <thead>
          <tr><th>컬러</th><th>사이즈</th><th class="num">이번주</th><th class="num">4주 누계</th></tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td>${safe(row.color)}</td>
              <td>${safe(row.size)}</td>
              <td class="num"><button class="sku-reorder-button" type="button" data-sku-index="${index}">${formatPlain(row.thisWeek)}</button></td>
              <td class="num">${formatPlain(row.fourWeeks)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function estimatedSkuOrderQty(sku) {
  const sellThrough = Number(sku.sellThrough || 0);
  if (sellThrough > 0) return Math.round(Number(sku.recentSales || 0) / (sellThrough / 100));
  return Number(sku.recentSales || 0) + Number(sku.fourWeeks || sku.recommendedQty || 0);
}

function styleTargetQty(style) {
  const five = fiveWeekQty(style.styleCode);
  return Math.max(five + Number(style.totalQty || 0), Math.round(Number(style.inboundQty || 0) * 0.72));
}

function buildSkuTrend(style, sku) {
  const trend = (style.trend || []).filter((row) => Number(row.actualQty || 0) > 0 || Number(row.targetQty || 0) > 0);
  const actualTotal = Math.max(1, (style.trend || []).reduce((sum, row) => sum + Number(row.actualQty || 0), 0));
  const skuSales = Number(sku.recentSales || 0);
  const skuOrderQty = estimatedSkuOrderQty(sku);
  const totalOrderQty = Number(style.orderQty || style.inboundQty || 0) || (style.skuPlan || []).reduce((sum, row) => sum + estimatedSkuOrderQty(row), 0) || 1;
  const orderShare = skuOrderQty / totalOrderQty;
  const targetTotal = Math.round(styleTargetQty(style) * orderShare);
  const trendTargetTotal = Math.max(1, trend.reduce((sum, row) => sum + Number(row.targetQty || 0), 0));
  let actualCum = 0;
  let targetCum = 0;
  return trend.map((row) => {
    actualCum += (Number(row.actualQty || 0) / actualTotal) * skuSales;
    targetCum += Number(row.targetQty || 0);
    return {
      label: row.label,
      actualQty: Math.round(actualCum),
      targetQty: Math.round(targetTotal * (targetCum / trendTargetTotal)),
    };
  });
}

function buildSkuChartSvg(points, title) {
  const width = 760;
  const height = 300;
  const pad = { top: 18, right: 26, bottom: 42, left: 58 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...points.flatMap((row) => [row.actualQty || 0, row.targetQty || 0]));
  const xStep = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const y = (value) => pad.top + innerH - (Number(value || 0) / maxValue) * innerH;
  const toPoints = (key) => points.map((row, index) => ({
    x: pad.left + index * xStep,
    y: y(row[key]),
    value: row[key],
    label: row.label,
  }));
  const actual = toPoints("actualQty");
  const target = toPoints("targetQty");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + innerH - ratio * innerH;
    return `<line class="grid-line" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"></line><text class="chart-label" x="8" y="${gy + 4}">${formatPlain(Math.round(maxValue * ratio))}</text>`;
  }).join("");
  const labelStep = Math.ceil(Math.max(1, points.length / 7));
  const labels = points.map((row, index) => {
    const isLast = index === points.length - 1;
    const tooCloseToLast = index > points.length - 1 - labelStep;
    if (!isLast && (index % labelStep !== 0 || tooCloseToLast)) return "";
    return `<text class="chart-label" x="${pad.left + index * xStep}" y="${height - 13}" text-anchor="middle">${safe(row.label)}</text>`;
  }).join("");
  return `
    <div class="sku-detail-chart">
      <div class="modal-chart-head">
        <strong>${safe(title)}</strong>
        <div class="legend modal-legend"><span>현재까지 판매량</span><span class="target">목표 판매량</span></div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${safe(title)} 그래프">
        ${grid}
        <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
        <path class="actual-line" d="${seriesPath(actual)}"></path>
        <path class="target-line" d="${seriesPath(target)}"></path>
        ${actual.map((point) => `<circle class="dot-actual" cx="${point.x}" cy="${point.y}" r="4"><title>${safe(point.label)} ${formatPlain(point.value)}</title></circle>`).join("")}
        ${target.map((point) => `<circle class="dot-target" cx="${point.x}" cy="${point.y}" r="4"><title>${safe(point.label)} ${formatPlain(point.value)}</title></circle>`).join("")}
        ${labels}
      </svg>
    </div>
  `;
}

function openSkuDetail(styleCode, skuIndex) {
  const style = byStyle.get(styleCode);
  const sku = modalSkuRows(style || {})[Number(skuIndex)];
  if (!style || !sku) return;
  const points = buildSkuTrend(style, sku);
  const skuOrderQty = estimatedSkuOrderQty(sku);
  const totalOrderQty = Number(style.orderQty || style.inboundQty || 0) || 1;
  const targetTotal = Math.round(styleTargetQty(style) * (skuOrderQty / totalOrderQty));
  const modal = document.createElement("div");
  modal.className = "sku-detail-backdrop";
  modal.innerHTML = `
    <section class="sku-detail-modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2>${safe(style.styleCode)} / ${safe(sku.color)} / ${safe(sku.size)}</h2>
        <button class="modal-close sku-detail-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="sku-detail-body">
        <div class="modal-stats sku-detail-stats">
          <div><span>현재까지 판매량</span><strong>${formatQty(sku.recentSales)}</strong></div>
          <div><span>목표 판매량</span><strong>${formatQty(targetTotal)}</strong></div>
          <div><span>SKU 발주 비중</span><strong>${Math.round((skuOrderQty / totalOrderQty) * 1000) / 10}%</strong></div>
        </div>
        ${buildSkuChartSvg(points, "컬러/사이즈 누적 판매량")}
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector(".sku-detail-close").addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
}

function seriesPath(points) {
  return points.length ? points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") : "";
}

function buildModalTrendChart(style) {
  const trend = (style.trend?.length ? style.trend : [
    ...(style.weekly || []).map((row) => ({ label: row.label, actualQty: row.actualQty, targetQty: 0, predictedQty: 0 })),
    ...(style.forecast || []).map((row) => ({ label: row.label, actualQty: 0, targetQty: row.targetQty, predictedQty: row.priorSimilarQty || 0 })),
  ]).filter((row) => Math.max(Number(row.actualQty || 0), Number(row.targetQty || 0), Number(row.predictedQty || 0)) > 0 || row.label === "현재");

  const width = 820;
  const height = 280;
  const pad = { top: 18, right: 28, bottom: 42, left: 54 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...trend.flatMap((row) => [row.actualQty || 0, row.targetQty || 0, row.predictedQty || 0]));
  const xStep = trend.length > 1 ? innerW / (trend.length - 1) : innerW;
  const y = (value) => pad.top + innerH - (Number(value || 0) / maxValue) * innerH;
  const pointFor = (key) => trend.map((row, index) => Number(row[key] || 0) > 0 ? {
    x: pad.left + index * xStep,
    y: y(row[key]),
    value: row[key],
    label: row.label,
  } : null).filter(Boolean);
  const actual = pointFor("actualQty");
  const target = pointFor("targetQty");
  const predicted = pointFor("predictedQty");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + innerH - ratio * innerH;
    return `<line class="grid-line" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"></line><text class="chart-label" x="8" y="${gy + 4}">${formatPlain(Math.round(maxValue * ratio))}</text>`;
  }).join("");
  const labels = trend.map((row, index) => {
    if (index % Math.ceil(Math.max(1, trend.length / 8)) !== 0 && index !== trend.length - 1) return "";
    return `<text class="chart-label" x="${pad.left + index * xStep}" y="${height - 13}" text-anchor="middle">${safe(row.label)}</text>`;
  }).join("");

  return `
    <div class="modal-chart">
      <div class="modal-chart-head">
        <strong>판매 추이</strong>
        <div class="legend modal-legend"><span>실판매량</span><span class="target">목표판매량</span><span class="predicted">예측판매량</span></div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${safe(style.styleCode)} 판매 추이">
        ${grid}
        <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
        <path class="actual-line" d="${seriesPath(actual)}"></path>
        <path class="target-line" d="${seriesPath(target)}"></path>
        <path class="predicted-line" d="${seriesPath(predicted)}"></path>
        ${actual.map((point) => `<circle class="dot-actual" cx="${point.x}" cy="${point.y}" r="4"><title>${safe(point.label)} ${formatPlain(point.value)}</title></circle>`).join("")}
        ${target.map((point) => `<circle class="dot-target" cx="${point.x}" cy="${point.y}" r="4"><title>${safe(point.label)} ${formatPlain(point.value)}</title></circle>`).join("")}
        ${predicted.map((point) => `<circle class="dot-predicted" cx="${point.x}" cy="${point.y}" r="4"><title>${safe(point.label)} ${formatPlain(point.value)}</title></circle>`).join("")}
        ${labels}
      </svg>
    </div>
  `;
}

function openStyleModal(styleCode) {
  const style = byStyle.get(styleCode);
  if (!style) return;
  const modal = document.getElementById("styleModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const totalOrderQty = Number(style.orderQty || style.inboundQty || 0);
  const unreceived = Math.max(0, totalOrderQty - Number(style.inboundQty || 0));
  const sellThrough = style.inboundQty ? Math.round((style.totalQty / style.inboundQty) * 1000) / 10 : 0;
  const averagePrice = style.totalQty ? Math.round(Number(style.totalSalesAmount || 0) / Math.max(1, Number(style.totalQty || 1))) : Number(style.price || 0);
  const similar = style.similarStyle ? ` (RE ${safe(style.similarStyle.styleCode)})` : "";
  title.textContent = `${style.styleCode}${similar} — ${style.styleName || style.productName || ""}`;
  body.innerHTML = `
    <div class="modal-layout">
      <div class="modal-left">
        <div class="modal-image">${getStyleImage(style.styleCode, style.styleName)}</div>
        <div class="modal-info-grid">
          <div>
            <h3>가격 정보</h3>
            <dl>
              <dt>정가</dt><dd>${formatMoney(style.price)}</dd>
              <dt>평균판매가</dt><dd>${formatMoney(averagePrice)}</dd>
              <dt>정판율</dt><dd>${Math.round(Number(style.normalRate || 0) * 1000) / 10}%</dd>
            </dl>
          </div>
          <div>
            <h3>판매 정보</h3>
            <dl>
              <dt>판매시기</dt><dd>${safe(styleSalesPeriod(style))}</dd>
              <dt>예상피크</dt><dd>${safe(stylePeakLabel(style))}</dd>
              <dt>기판매량</dt><dd>${formatQty(style.totalQty)}</dd>
              <dt>달성률</dt><dd>${sellThrough}%</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="modal-right">
        <div class="modal-stat-block">
          <h3>발주 정보</h3>
          <div class="modal-stats">
            <div><span>누적 발주량</span><strong>${formatQty(totalOrderQty)}</strong></div>
            <div><span>기입고량</span><strong>${formatQty(style.inboundQty)}</strong></div>
            <div><span>미입고량</span><strong>${formatQty(unreceived)}</strong></div>
          </div>
        </div>
        <div class="modal-stat-block">
          <h3>컬러별 / 사이즈별 리오더 수량</h3>
          ${buildModalSkuTable(style)}
        </div>
        ${buildModalTrendChart(style)}
      </div>
    </div>
  `;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  body.querySelectorAll(".sku-reorder-button").forEach((button) => {
    button.addEventListener("click", () => openSkuDetail(style.styleCode, button.dataset.skuIndex));
  });
}

function closeStyleModal() {
  document.getElementById("styleModal").hidden = true;
  document.body.classList.remove("modal-open");
}

function pointsToPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function createChartRow(style) {
  const tr = document.createElement("tr");
  tr.className = "chart-row";
  tr.innerHTML = `
    <td colspan="17">
      <div class="inline-chart">
        <div class="chart-title">
          <strong>${style.styleCode} · ${style.styleName || ""}</strong>
          <span>이번주까지 판매량 + 다음주부터 목표 판매량 · 전년 유사 정상판매 흐름 반영</span>
        </div>
        ${buildChartSvg(style)}
        ${buildSkuPlan(style)}
      </div>
    </td>
  `;
  return tr;
}

function buildSkuPlan(style) {
  const rows = (style.skuPlan || []).filter((row) => row.recommendedQty > 0).slice(0, 24);
  if (!rows.length) {
    return `<div class="sku-empty">컬러/사이즈별 배분 데이터가 없습니다.</div>`;
  }
  return `
    <div class="sku-panel">
      <div class="sku-title">
        <strong>컬러·사이즈 리오더 배분</strong>
        <span>최근 판매, 소진율, 입고대비 정판율 기준</span>
      </div>
      <div class="sku-grid">
        ${rows.map((row) => `
          <div class="sku-card">
            <div>
              <b>${row.colorCode} ${row.colorName || ""}</b>
              <small>SIZE ${row.size}</small>
            </div>
            <strong>${formatPlain(row.recommendedQty)}pcs</strong>
            <p>최근 ${formatPlain(row.recentSales)} · 소진 ${row.sellThrough}% · 정판 ${row.normalRate}%</p>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function buildChartSvg(style) {
  const actual = (style.weekly || []).map((row) => ({ label: row.label, actualQty: row.actualQty, targetQty: null }));
  const forecast = (style.forecast || []).slice(0, 12).map((row) => ({ label: row.label, actualQty: null, targetQty: row.targetQty }));
  const priorSeries = (style.priorSeries || []).slice(0, 12).map((row) => ({ label: row.label, priorQty: row.actualQty }));
  const actualWindow = actual.slice(-10);
  const series = [...actualWindow, ...forecast];
  const maxValue = Math.max(1, ...series.flatMap((row) => [row.actualQty || 0, row.targetQty || 0]), ...priorSeries.map((row) => row.priorQty || 0));
  const width = 980;
  const height = 300;
  const pad = { top: 20, right: 28, bottom: 42, left: 66 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xStep = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const y = (value) => pad.top + innerH - (value / maxValue) * innerH;
  const actualPoints = series.map((row, index) => row.actualQty === null ? null : { x: pad.left + index * xStep, y: y(row.actualQty), value: row.actualQty }).filter(Boolean);
  const forecastPoints = series.map((row, index) => row.targetQty === null ? null : { x: pad.left + index * xStep, y: y(row.targetQty), value: row.targetQty }).filter(Boolean);
  const targetPoints = actualPoints.length ? [actualPoints[actualPoints.length - 1], ...forecastPoints] : forecastPoints;
  const priorStartIndex = actualWindow.length;
  const priorPoints = priorSeries.map((row, index) => ({ x: pad.left + (priorStartIndex + index) * xStep, y: y(row.priorQty || 0), value: row.priorQty || 0 }));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + innerH - ratio * innerH;
    return `<line class="grid-line" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"></line><text class="chart-label" x="10" y="${gy + 4}">${Math.round(maxValue * ratio).toLocaleString("ko-KR")}</text>`;
  }).join("");
  const labels = series.map((row, index) => {
    if (index % 2 !== 0 && index !== series.length - 1) return "";
    return `<text class="chart-label" x="${pad.left + index * xStep}" y="${height - 12}" text-anchor="middle">${row.label}</text>`;
  }).join("");
  return `
    <div class="legend"><span>판매량</span><span class="target">목표 판매량</span><span class="prior">전년 유사</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${style.styleCode} 판매 그래프">
      ${grid}
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
      <path class="actual-line" d="${pointsToPath(actualPoints)}"></path>
      <path class="target-line" d="${pointsToPath(targetPoints)}"></path>
      <path class="prior-line" d="${pointsToPath(priorPoints)}"></path>
      ${actualPoints.map((point) => `<circle class="dot-actual" cx="${point.x}" cy="${point.y}" r="4"><title>${formatPlain(point.value)}</title></circle>`).join("")}
      ${forecastPoints.map((point) => `<circle class="dot-target" cx="${point.x}" cy="${point.y}" r="4"><title>${formatPlain(point.value)}</title></circle>`).join("")}
      ${priorPoints.map((point) => `<circle class="dot-prior" cx="${point.x}" cy="${point.y}" r="3"><title>${formatPlain(point.value)}</title></circle>`).join("")}
      ${labels}
    </svg>
  `;
}

function resetFilters() {
  state.query = "";
  state.season = "all";
  state.category = "all";
  state.week = "all";
  state.selectedStyle = null;
  document.getElementById("searchInput").value = "";
  renderFilters();
  renderWeekBoard();
  renderDetailTable();
}

function bindEvents() {
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderDetailTable();
  });
  document.getElementById("seasonFilter").addEventListener("change", (event) => {
    state.season = event.target.value;
    renderDetailTable();
  });
  document.getElementById("categoryFilter").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderDetailTable();
  });
  document.getElementById("weekFilter").addEventListener("change", (event) => {
    state.week = event.target.value;
    renderDetailTable();
  });
  document.getElementById("resetFilters").addEventListener("click", resetFilters);
  document.getElementById("downloadCsv").addEventListener("click", () => alert("다음 단계에서 CSV 다운로드를 연결할 수 있습니다."));
  document.getElementById("addStyle").addEventListener("click", () => alert("다음 단계에서 수동 스타일 추가를 연결할 수 있습니다."));
}

document.getElementById("modalClose").addEventListener("click", closeStyleModal);
document.getElementById("styleModal").addEventListener("click", (event) => {
  if (event.target.id === "styleModal") closeStyleModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("styleModal").hidden) closeStyleModal();
});

renderMeta();
renderFilters();
renderWeekBoard();
renderDetailTable();
bindEvents();
