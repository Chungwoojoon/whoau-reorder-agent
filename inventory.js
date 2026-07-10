const rawData = window.REORDER_DATA || { styles: [] };

const stores = [
  { id: "A001", name: "강남 플래그십", type: "로드", weight: 1.25 },
  { id: "A014", name: "홍대 와우산", type: "로드", weight: 1.1 },
  { id: "B023", name: "스타필드 고양", type: "몰", weight: 0.95 },
  { id: "B041", name: "롯데 잠실", type: "백화점", weight: 1.15 },
  { id: "C018", name: "부산 센텀", type: "백화점", weight: 0.9 },
  { id: "C027", name: "대구 동성로", type: "로드", weight: 0.85 },
  { id: "D009", name: "제주 노형", type: "몰", weight: 0.7 },
  { id: "E032", name: "온라인 물류", type: "온라인", weight: 1.4 },
];

const colors = ["BLACK", "NAVY", "OATMEAL", "CREAM", "GREEN", "DENIM"];
const sizes = ["S", "M", "L", "XL"];
const state = {
  query: "",
  storeId: "all",
  severity: "all",
  shortOnly: true,
  selectedStoreId: "",
};

const numberFormat = new Intl.NumberFormat("ko-KR");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function hashText(value) {
  return String(value).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function recentQty(style) {
  const weekly = style.weekly || [];
  return weekly.slice(-4).reduce((sum, week) => sum + Math.max(0, Number(week.actualQty || 0)), 0);
}

function categoryName(style) {
  return style.categorySmall || style.categoryMid || style.categoryLarge || "기타";
}

function severityFor(stockQty, minQty) {
  if (stockQty <= 0 && minQty > 0) return "critical";
  if (stockQty < minQty) return "warning";
  return "healthy";
}

function severityLabel(severity) {
  return { critical: "심각", warning: "주의", healthy: "정상" }[severity] || "정상";
}

function buildFallbackRows() {
  const styles = (rawData.styles || [])
    .filter((style) => Number(style.inboundQty || 0) > 0 || Number(style.totalQty || 0) > 0)
    .sort((a, b) => recentQty(b) - recentQty(a))
    .slice(0, 64);

  return styles.flatMap((style, styleIndex) => {
    const styleDemand = Math.max(1, Math.ceil(recentQty(style) / 8));
    const variantColors = colors.slice(hashText(style.styleCode) % 3, (hashText(style.styleCode) % 3) + 3);
    const styleSizes = categoryName(style).includes("ACC") || style.styleCode?.includes("AC") ? ["FREE"] : sizes;

    return stores.flatMap((store, storeIndex) => variantColors.flatMap((color, colorIndex) => styleSizes.map((size, sizeIndex) => {
      const seed = hashText(`${style.styleCode}-${store.id}-${color}-${size}`);
      const demandQty = Math.max(1, Math.round(styleDemand * store.weight * (0.65 + (seed % 7) / 10)));
      const minQty = Math.max(1, Math.ceil(demandQty * 0.55));
      const shortagePattern = (styleIndex * 3 + storeIndex * 5 + colorIndex * 7 + sizeIndex * 11 + seed) % 17;
      const stockQty = shortagePattern < 3 ? 0 : Math.max(0, Math.round(minQty + (shortagePattern - 8)));
      const needQty = Math.max(0, minQty - stockQty);
      const severity = severityFor(stockQty, minQty);

      return {
        storeId: store.id,
        storeName: store.name,
        storeType: store.type,
        styleCode: style.styleCode,
        styleName: style.styleName || style.productName || style.styleCode,
        category: categoryName(style),
        color,
        size,
        stockQty,
        minQty,
        needQty,
        demandQty,
        severity,
      };
    })));
  });
}

function loadInventoryRows() {
  if (Array.isArray(window.STORE_SKU_INVENTORY?.rows)) return window.STORE_SKU_INVENTORY.rows;
  return buildFallbackRows();
}

let rows = loadInventoryRows();

function filteredRows() {
  const query = state.query.trim().toLowerCase();
  return rows.filter((row) => {
    const text = `${row.storeName} ${row.storeId} ${row.styleName} ${row.styleCode} ${row.color} ${row.size}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (state.storeId !== "all" && row.storeId !== state.storeId) return false;
    if (state.severity !== "all" && row.severity !== state.severity) return false;
    if (state.shortOnly && row.needQty <= 0) return false;
    return true;
  });
}

function summarizeStores(sourceRows = rows) {
  const map = new Map();
  sourceRows.forEach((row) => {
    const current = map.get(row.storeId) || {
      storeId: row.storeId,
      storeName: row.storeName,
      storeType: row.storeType,
      skuCount: 0,
      shortSkuCount: 0,
      criticalCount: 0,
      needQty: 0,
      score: 0,
    };
    current.skuCount += 1;
    if (row.needQty > 0) current.shortSkuCount += 1;
    if (row.severity === "critical") current.criticalCount += 1;
    current.needQty += row.needQty;
    current.score += row.needQty * (row.severity === "critical" ? 2 : 1);
    map.set(row.storeId, current);
  });
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function selectedStoreSummary() {
  const summaries = summarizeStores(rows);
  return summaries.find((store) => store.storeId === state.selectedStoreId) || summaries[0];
}

function renderStoreSelect() {
  const summaries = summarizeStores(rows);
  const options = [`<option value="all">전체 매장</option>`].concat(
    summaries.map((store) => `<option value="${escapeHtml(store.storeId)}">${escapeHtml(store.storeName)}</option>`),
  );
  document.querySelector("#storeSelect").innerHTML = options.join("");
  document.querySelector("#storeSelect").value = state.storeId;
}

function renderKpis() {
  const shortRows = rows.filter((row) => row.needQty > 0);
  document.querySelector("#dataWeek").textContent = rawData.dataWeekLabel || rawData.latestWeekLabel || "-";
  document.querySelector("#generatedAt").textContent = rawData.generatedAt || "샘플 데이터";
  document.querySelector("#skuCount").textContent = numberFormat.format(rows.length);
  document.querySelector("#shortStoreCount").textContent = numberFormat.format(new Set(shortRows.map((row) => row.storeId)).size);
  document.querySelector("#shortSkuCount").textContent = numberFormat.format(shortRows.length);
  document.querySelector("#needQty").textContent = `${numberFormat.format(shortRows.reduce((sum, row) => sum + row.needQty, 0))} pcs`;
}

function renderStoreList() {
  const summaries = summarizeStores(rows);
  const maxScore = Math.max(1, ...summaries.map((store) => store.score));
  const active = selectedStoreSummary();
  state.selectedStoreId = active?.storeId || "";

  document.querySelector("#storeList").innerHTML = summaries.map((store) => `
    <button class="store-button ${store.storeId === state.selectedStoreId ? "active" : ""}" type="button" data-store-id="${escapeHtml(store.storeId)}">
      <strong>${escapeHtml(store.storeName)}</strong>
      <span>${escapeHtml(store.storeType)} · 결품 ${numberFormat.format(store.shortSkuCount)} SKU · 필요 ${numberFormat.format(store.needQty)} pcs</span>
      <div class="store-bar"><i style="width: ${Math.round((store.score / maxScore) * 100)}%"></i></div>
    </button>
  `).join("");
}

function renderTable() {
  const current = filteredRows().sort((a, b) => b.needQty - a.needQty || a.storeName.localeCompare(b.storeName, "ko")).slice(0, 300);
  document.querySelector("#resultMeta").textContent = `${numberFormat.format(current.length)}건 표시`;
  document.querySelector("#skuTableBody").innerHTML = current.length ? current.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.storeName)}</strong><br><span class="muted">${escapeHtml(row.storeType)}</span></td>
      <td><div class="style-cell"><strong>${escapeHtml(row.styleName)}</strong><span>${escapeHtml(row.styleCode)} · ${escapeHtml(row.category)}</span></div></td>
      <td>${escapeHtml(row.color)}</td>
      <td>${escapeHtml(row.size)}</td>
      <td class="qty">${numberFormat.format(row.stockQty)}</td>
      <td>${numberFormat.format(row.minQty)}</td>
      <td class="qty">${numberFormat.format(row.needQty)}</td>
      <td><span class="badge ${row.severity}">${severityLabel(row.severity)}</span></td>
    </tr>
  `).join("") : `<tr><td class="empty-state" colspan="8">조건에 맞는 SKU가 없습니다.</td></tr>`;
}

function renderDetail() {
  const store = selectedStoreSummary();
  if (!store) {
    document.querySelector("#storeDetail").innerHTML = `<div class="empty-state">매장 데이터가 없습니다.</div>`;
    return;
  }

  const storeRows = rows
    .filter((row) => row.storeId === store.storeId && row.needQty > 0)
    .sort((a, b) => b.needQty - a.needQty || b.demandQty - a.demandQty)
    .slice(0, 12);

  document.querySelector("#detailTitle").textContent = store.storeName;
  document.querySelector("#storeDetail").innerHTML = `
    <div class="detail-summary">
      <div><span>결품 SKU</span><strong>${numberFormat.format(store.shortSkuCount)}</strong></div>
      <div><span>심각</span><strong>${numberFormat.format(store.criticalCount)}</strong></div>
      <div><span>필요</span><strong>${numberFormat.format(store.needQty)}</strong></div>
    </div>
    <div class="short-list">
      ${storeRows.map((row) => `
        <article class="short-item">
          <header>
            <div>
              <strong>${escapeHtml(row.styleName)}</strong><br>
              <small>${escapeHtml(row.styleCode)} · ${escapeHtml(row.color)} · ${escapeHtml(row.size)}</small>
            </div>
            <span class="badge ${row.severity}">${severityLabel(row.severity)}</span>
          </header>
          <div class="need-line"><span>현재 ${numberFormat.format(row.stockQty)} / 기준 ${numberFormat.format(row.minQty)}</span><strong>+${numberFormat.format(row.needQty)} pcs</strong></div>
        </article>
      `).join("") || `<div class="empty-state">이 매장은 현재 결품 SKU가 없습니다.</div>`}
    </div>
  `;
}

function render() {
  renderKpis();
  renderStoreSelect();
  renderStoreList();
  renderTable();
  renderDetail();
}

document.querySelector("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderTable();
});

document.querySelector("#storeSelect").addEventListener("change", (event) => {
  state.storeId = event.target.value;
  if (state.storeId !== "all") state.selectedStoreId = state.storeId;
  renderStoreList();
  renderTable();
  renderDetail();
});

document.querySelector("#severitySelect").addEventListener("change", (event) => {
  state.severity = event.target.value;
  renderTable();
});

document.querySelector("#shortOnlyInput").addEventListener("change", (event) => {
  state.shortOnly = event.target.checked;
  renderTable();
});

document.querySelector("#storeList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-store-id]");
  if (!button) return;
  state.selectedStoreId = button.dataset.storeId;
  state.storeId = button.dataset.storeId;
  render();
});

render();
