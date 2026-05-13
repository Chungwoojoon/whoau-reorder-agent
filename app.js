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
const normalize = (value) => String(value || "").toLowerCase();

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
      renderDetailTable();
    });
  });
}

function renderDetailTable() {
  const body = document.getElementById("detailBody");
  const rows = baseRows().slice(0, 180);
  document.getElementById("rowCount").textContent = `${rows.length}건`;
  body.innerHTML = "";

  for (const row of rows) {
    const style = byStyle.get(row.styleCode) || {};
    const w0 = w0Qty(row.styleCode);
    const five = fiveWeekQty(row.styleCode);
    const forecast = forecastFive(row.styleCode);
    const salesRate = style.inboundQty ? Math.round((style.totalQty / style.inboundQty) * 1000) / 10 : 0;
    const tr = document.createElement("tr");
    tr.className = state.selectedStyle === row.styleCode ? "selected" : "";
    tr.innerHTML = `
      <td><span class="mini-tag">2026</span></td>
      <td><span class="mini-tag season">SS${row.season || "-"}</span></td>
      <td>${row.category || "-"}</td>
      <td>${imageCell(row.styleCode, row.styleName)}</td>
      <td><button class="style-pill" type="button" data-style="${row.styleCode}">${row.styleCode}</button></td>
      <td class="style-name">${row.styleName || "-"}</td>
      <td class="num">${formatPlain(style.inboundQty)}</td>
      <td class="num">${formatPlain(style.totalQty)}</td>
      <td class="num badge">${Math.round((style.normalRate || 0) * 1000) / 10}%</td>
      <td class="num">${formatPlain(style.weekly?.at(-1)?.actualQty || 0)}</td>
      <td class="num">${salesRate}%</td>
      <td>${style.similarStyle ? `<span class="similar">${style.similarStyle.styleCode}<small>${Math.round((style.similarStyle.normalRate || 0) * 1000) / 10}% 정상</small></span>` : "-"}</td>
      <td class="num stock ${style.stock < 0 ? "negative" : ""}">${formatPlain(style.stock)}</td>
      <td class="num badge">${formatPlain(w0)}</td>
      <td class="num badge">${formatPlain(five)}</td>
      <td class="num">${formatPlain(forecast)}</td>
      <td><button class="request" type="button">${style.reorderTotal > 0 ? "검토" : "보류"}</button></td>
    `;
    body.appendChild(tr);
    if (state.selectedStyle === row.styleCode) {
      body.appendChild(createChartRow(style));
    }
  }

  body.querySelectorAll(".style-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStyle = state.selectedStyle === button.dataset.style ? null : button.dataset.style;
      renderDetailTable();
    });
  });
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

renderMeta();
renderFilters();
renderWeekBoard();
renderDetailTable();
bindEvents();
