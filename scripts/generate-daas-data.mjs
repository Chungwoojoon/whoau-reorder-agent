import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
const outPath = path.join(projectRoot, "data", "app-data.js");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function ymd(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function labelFromDates(start, end) {
  return `${pad(start.getMonth() + 1)}/${pad(start.getDate())}~${pad(end.getMonth() + 1)}/${pad(end.getDate())}`;
}

function previousCompleteWeek(reference = new Date()) {
  const today = new Date(reference);
  today.setHours(0, 0, 0, 0);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() - daysSinceMonday);
  const previousMonday = new Date(currentMonday);
  previousMonday.setDate(currentMonday.getDate() - 7);
  const previousSunday = new Date(currentMonday);
  previousSunday.setDate(currentMonday.getDate() - 1);
  return {
    start: previousMonday,
    end: previousSunday,
    startYmd: ymd(previousMonday),
    endYmd: ymd(previousSunday),
    label: labelFromDates(previousMonday, previousSunday),
  };
}

function weekStart(date) {
  const day = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(date.getDate() - day);
  return start;
}

function parseYmd(value) {
  const text = String(value || "");
  return new Date(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)));
}

function salesWeeksBetween(firstSaleDate, endDate) {
  if (!firstSaleDate) return 0;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((endDate.getTime() - firstSaleDate.getTime() + dayMs) / (7 * dayMs)));
}

function toNumber(value) {
  return Number(value || 0);
}

function normalizePrice(value) {
  const price = toNumber(value);
  return price > 0 && price < 10000 ? price * 100 : price;
}

function cleanStyleName(value, fallback = "") {
  return String(value || fallback || "")
    .split(",")[0]
    .trim();
}

function bestStyleName(value, fallback = "") {
  const names = String(value || "")
    .split("|||")
    .map((name) => cleanStyleName(name))
    .filter(Boolean);
  if (!names.length) return cleanStyleName(fallback, fallback);
  return [...new Set(names)]
    .sort((a, b) => {
      const aPenalty = /[(\s]$/.test(a) ? 100 : 0;
      const bPenalty = /[(\s]$/.test(b) ? 100 : 0;
      return (b.length - bPenalty) - (a.length - aPenalty) || b.length - a.length || a.localeCompare(b);
    })[0];
}

function itemCode(styleCode) {
  return String(styleCode || "").slice(2, 4).toUpperCase();
}

function classifyCategory(code) {
  const item = itemCode(code);
  if (["JD", "JE", "JJ", "JK", "JL", "JP", "JT", "JW", "VW"].includes(item)) return "아우터";
  if (["HA", "HS", "HW", "LA", "LS", "LW", "MA", "MH", "MW", "MZ", "RA", "RN", "RP", "RS", "RW"].includes(item)) return "다이마루 상의";
  if (["CK", "KA", "KV", "KW"].includes(item)) return "스웨터";
  if (["BL", "YA", "YC", "YJ", "YS", "YW"].includes(item)) return "셔츠";
  if (["TA", "TC", "TH", "TJ", "TM"].includes(item)) return "하의";
  if (["OJ", "OM", "ON", "OW", "WH", "WJ", "WK", "WM"].includes(item)) return "스커트";
  if (["AB", "AC", "AG", "AK", "AM", "AP", "AQ", "AR", "AW", "AY", "BG", "BM", "HM", "PG", "PP"].includes(item)) return "잡화";
  return "기타";
}

function emptyChannels() {
  return {
    offline: { qty: 0, amount: 0 },
    online: { qty: 0, amount: 0 },
    buyer: { qty: 0, amount: 0 },
  };
}

function addChannel(target, channel, qty, amount) {
  if (!target[channel]) target[channel] = { qty: 0, amount: 0 };
  target[channel].qty += qty;
  target[channel].amount += amount;
}

function classifySalesChannel(plant, plantName) {
  const code = String(plant || "").trim().toUpperCase();
  const name = String(plantName || "").trim();
  const onlineCodes = new Set(["ADGT", "ADHD", "AE2W", "AALB", "AACA", "AEAC"]);
  const buyerCodes = new Set(["ADTM", "ADE2", "AD58", "AEF4", "AE9E", "AEER", "AEK4"]);
  if (buyerCodes.has(code) || /면세|SHOPEE|쇼피|바이어/i.test(name)) return "buyer";
  if (onlineCodes.has(code) || /공식몰|무신사|지그재그|이랜드몰|온라인|29CM|네이버|카카오|W컨셉|브랜디/i.test(name)) return "online";
  return "offline";
}

function topStoreFromMap(storeMap) {
  let best = null;
  for (const store of storeMap.values()) {
    if (!best || store.qty > best.qty) best = store;
  }
  if (!best) return { plant: "", name: "-", qty: 0, amount: 0, channel: "offline" };
  return {
    plant: best.plant,
    name: best.name || best.plant || "-",
    qty: Math.round(best.qty),
    amount: Math.round(best.amount),
    channel: best.channel,
  };
}

function getClient() {
  const required = ["DAAS_DB_HOST", "DAAS_DB_PORT", "DAAS_DB_NAME", "DAAS_DB_USER", "DAAS_DB_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  return new Client({
    host: process.env.DAAS_DB_HOST,
    port: Number(process.env.DAAS_DB_PORT),
    database: process.env.DAAS_DB_NAME,
    user: process.env.DAAS_DB_USER,
    password: process.env.DAAS_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
}

loadEnv(envPath);

const targetWeek = previousCompleteWeek();
const yearStart = `${targetWeek.end.getFullYear()}0101`;
const cumulativeStart = `${targetWeek.end.getFullYear() - 1}1101`;
const coPurchaseStart = new Date(targetWeek.end);
coPurchaseStart.setDate(targetWeek.end.getDate() - 27);
const coPurchaseLabel = labelFromDates(coPurchaseStart, targetWeek.end);

const sql = `
WITH plant_daily AS (
  SELECT
    LEFT(t.material, 10) AS material,
    t.calday,
    t.plant,
    SUM(COALESCE(t.sale, 0)) AS sale_qty,
    SUM(COALESCE(t.saleamt, 0)) AS sale_amt,
    SUM(COALESCE(t.salejung, 0)) AS normal_qty,
    SUM(COALESCE(t.salejungamt, 0)) AS normal_amt,
    SUM(COALESCE(t.ipgo_qty, 0)) AS inbound_qty,
    SUM(COALESCE(t.ordqty, 0)) AS order_qty,
    SUM(COALESCE(t.ordamt, 0)) AS order_amt,
    SUM(COALESCE(t.hstoc_qty, 0) + COALESCE(t.sstoc_tmp_qty, 0)) AS stock_delta
  FROM fpw.total_mart t
  WHERE t.calday BETWEEN $1 AND $2
    AND LENGTH(t.calday) = 8
    AND t.calday ~ '^[0-9]{8}$'
    AND t.material LIKE 'WH%'
    AND SUBSTRING(LEFT(t.material, 10) FROM 6 FOR 1) <> 'B'
    AND SUBSTRING(LEFT(t.material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
    AND COALESCE(t.plant, '') <> '1118'
  GROUP BY LEFT(t.material, 10), t.calday, t.plant
),
tmaterial AS (
  SELECT
    LEFT(material, 10) AS material,
    MAX(material_nm) AS material_nm,
    MAX(brand_nm) AS brand_nm,
    MAX(zzitem_h2_nm) AS zzitem_h2_nm,
    MAX(zzitem_h1_nm) AS zzitem_h1_nm,
    MAX(aprl_type_nm) AS aprl_type_nm
  FROM ods.fpw_tmaterial
  WHERE material LIKE 'WH%'
    AND SUBSTRING(LEFT(material, 10) FROM 6 FOR 1) <> 'B'
    AND SUBSTRING(LEFT(material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
  GROUP BY LEFT(material, 10)
),
pmaterial AS (
  SELECT LEFT(material, 10) AS material, MAX("/bic/znopric_a") AS price
  FROM ods.fpw_pmaterial
  WHERE material LIKE 'WH%'
    AND SUBSTRING(LEFT(material, 10) FROM 6 FOR 1) <> 'B'
    AND SUBSTRING(LEFT(material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
  GROUP BY LEFT(material, 10)
),
tplant AS (
  SELECT plant, MAX(plant_nm) AS plant_nm
  FROM ods.fpw_tplant
  WHERE brand = 'WH' OR brand = '' OR brand IS NULL
  GROUP BY plant
)
SELECT
  d.material,
  COALESCE(tm.material_nm, d.material) AS material_nm,
  COALESCE(tm.zzitem_h2_nm, tm.zzitem_h1_nm, tm.aprl_type_nm, '') AS category_nm,
  COALESCE(pm.price, 0) AS price,
  d.calday,
  d.plant,
  COALESCE(tp.plant_nm, d.plant, '') AS plant_nm,
  d.sale_qty,
  d.sale_amt,
  d.normal_qty,
  d.normal_amt,
  d.inbound_qty,
  d.order_qty,
  d.order_amt,
  d.stock_delta
FROM plant_daily d
LEFT JOIN tmaterial tm ON d.material = tm.material
LEFT JOIN pmaterial pm ON d.material = pm.material
LEFT JOIN tplant tp ON d.plant = tp.plant
ORDER BY d.material, d.calday
`;

const client = getClient();
await client.connect();
let rows;
let styleNameRows = [];
let inventoryRows = [];
let coPurchaseRows = [];
try {
  const result = await client.query(sql, [yearStart, targetWeek.endYmd]);
  rows = result.rows;
  const materials = [...new Set(rows.map((row) => row.material).filter(Boolean))];
  if (materials.length) {
    const namesResult = await client.query(`
      SELECT
        LEFT(material, 10) AS material,
        STRING_AGG(DISTINCT material_nm, '|||') AS material_names
      FROM ods.fpw_tmaterial
      WHERE LEFT(material, 10) = ANY($1)
      GROUP BY LEFT(material, 10)
    `, [materials]);
    styleNameRows = namesResult.rows;
    const inventoryResult = await client.query(`
      WITH cumulative_filtered AS (
        SELECT
          LEFT(material, 10) AS material,
          COALESCE(ipgo_qty, 0) AS inbound_qty,
          COALESCE(sale, 0) AS sale_qty,
          COALESCE(saleamt, 0) AS sale_amt,
          COALESCE(salejung, 0) AS normal_qty,
          COALESCE(salejungamt, 0) AS normal_amt
        FROM fpw.total_mart
        WHERE calday BETWEEN $1 AND $2
          AND LENGTH(calday) = 8
          AND calday ~ '^[0-9]{8}$'
          AND material LIKE 'WH%'
          AND LEFT(material, 10) = ANY($3)
          AND SUBSTRING(LEFT(material, 10) FROM 6 FOR 1) <> 'B'
          AND SUBSTRING(LEFT(material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
      ),
      order_filtered AS (
        SELECT DISTINCT
          LEFT(material, 10) AS material,
          material AS sku_material,
          calday,
          plant,
          COALESCE(ordqty, 0) AS order_qty,
          COALESCE(ordamt, 0) AS order_amt
        FROM fpw.total_mart
        WHERE LENGTH(calday) = 8
          AND calday ~ '^[0-9]{8}$'
          AND material LIKE 'WH%'
          AND LEFT(material, 10) = ANY($3)
          AND SUBSTRING(LEFT(material, 10) FROM 6 FOR 1) <> 'B'
          AND SUBSTRING(LEFT(material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
      ),
      cumulative AS (
        SELECT
          material,
          COALESCE(SUM(inbound_qty), 0) AS inbound_qty,
          COALESCE(SUM(sale_qty), 0) AS total_qty,
          COALESCE(SUM(sale_amt), 0) AS total_sales_amount,
          COALESCE(SUM(normal_qty), 0) AS total_normal_qty,
          COALESCE(SUM(normal_amt), 0) AS total_normal_amount,
          COALESCE(SUM(inbound_qty) - SUM(sale_qty), 0) AS stock_qty
        FROM cumulative_filtered
        GROUP BY material
      ),
      orders AS (
        SELECT
          material,
          COALESCE(SUM(order_qty), 0) AS order_qty,
          COALESCE(SUM(order_amt), 0) AS order_amt
        FROM order_filtered
        GROUP BY material
      )
      SELECT
        c.material,
        c.inbound_qty,
        COALESCE(o.order_qty, 0) AS order_qty,
        COALESCE(o.order_amt, 0) AS order_amt,
        c.total_qty,
        c.total_sales_amount,
        c.total_normal_qty,
        c.total_normal_amount,
        c.stock_qty
      FROM cumulative c
      LEFT JOIN orders o ON c.material = o.material
    `, [cumulativeStart, targetWeek.endYmd, materials]);
    inventoryRows = inventoryResult.rows;
    const coPurchaseResult = await client.query(`
      SELECT weborderno, stylecode AS material, SUM(COALESCE(qty, 0)) AS qty
      FROM ods.omni_spprd_mart
      WHERE calday BETWEEN $1 AND $2
        AND weborderno IS NOT NULL
        AND weborderno <> ''
        AND stylecode LIKE 'WH%'
        AND SUBSTRING(stylecode FROM 6 FOR 1) <> 'B'
        AND SUBSTRING(stylecode FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
      GROUP BY weborderno, stylecode
    `, [ymd(coPurchaseStart), targetWeek.endYmd]);
    coPurchaseRows = coPurchaseResult.rows;
  }
} finally {
  await client.end();
}

const styleNameMap = new Map(styleNameRows.map((row) => [row.material, row.material_names]));
const inventoryMap = new Map(inventoryRows.map((row) => [row.material, row]));
const materialSet = new Set((rows || []).map((row) => row.material));
const coPurchaseMap = new Map();
const linesByOrder = new Map();
for (const row of coPurchaseRows) {
  if (!linesByOrder.has(row.weborderno)) linesByOrder.set(row.weborderno, []);
  linesByOrder.get(row.weborderno).push({
    material: row.material,
    qty: toNumber(row.qty),
  });
}

for (const lines of linesByOrder.values()) {
  const positiveLines = lines
    .map((line) => ({ ...line, qty: Math.max(0, line.qty) }))
    .filter((line) => line.qty > 0);
  const uniqueLines = positiveLines.filter((line, index, array) => array.findIndex((item) => item.material === line.material) === index);
  if (uniqueLines.length < 2 || uniqueLines.length > 20) continue;
  for (const base of uniqueLines) {
    if (!materialSet.has(base.material)) continue;
    if (!coPurchaseMap.has(base.material)) coPurchaseMap.set(base.material, new Map());
    const relatedMap = coPurchaseMap.get(base.material);
    for (const related of uniqueLines) {
      if (base.material === related.material) continue;
      const current = relatedMap.get(related.material) || { orders: 0, qty: 0 };
      current.orders += 1;
      current.qty += related.qty;
      relatedMap.set(related.material, current);
    }
  }
}

for (const [material, relatedMap] of coPurchaseMap.entries()) {
  coPurchaseMap.set(material, [...relatedMap.entries()]
    .map(([relatedMaterial, value]) => ({
      styleCode: relatedMaterial,
      styleName: bestStyleName(styleNameMap.get(relatedMaterial), relatedMaterial),
      togetherQty: Math.round(value.qty),
      togetherOrders: Math.round(value.orders),
    }))
    .sort((a, b) => b.togetherOrders - a.togetherOrders || b.togetherQty - a.togetherQty || a.styleCode.localeCompare(b.styleCode))
    .slice(0, 5)
    .map((item, index) => ({ rank: index + 1, ...item })));
}
const grouped = new Map();
for (const row of rows) {
  const material = row.material;
  if (!grouped.has(material)) {
    grouped.set(material, {
      styleCode: material,
      styleName: bestStyleName(styleNameMap.get(material) || row.material_nm, material),
      category: row.category_nm || classifyCategory(material),
      price: normalizePrice(row.price),
      days: [],
    });
  }
  grouped.get(material).days.push(row);
}

const styles = [];
let latestAvailableDate = "";
for (const style of grouped.values()) {
  const weeklyMap = new Map();
  const totalChannels = emptyChannels();
  let firstSaleDate = null;

  for (const day of style.days) {
    if (day.calday > latestAvailableDate) latestAvailableDate = day.calday;
    const date = parseYmd(day.calday);
    if (toNumber(day.sale_qty) > 0 && (!firstSaleDate || date < firstSaleDate)) {
      firstSaleDate = date;
    }
    const start = weekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const label = labelFromDates(start, end);
    if (!weeklyMap.has(label)) {
      weeklyMap.set(label, {
        index: weeklyMap.size,
        label,
        actualQty: 0,
        normalQty: 0,
        salesAmount: 0,
        normalAmount: 0,
        channels: emptyChannels(),
        stores: new Map(),
      });
    }
    const week = weeklyMap.get(label);
    const saleQty = toNumber(day.sale_qty);
    const saleAmount = toNumber(day.sale_amt);
    const channel = classifySalesChannel(day.plant, day.plant_nm);
    week.actualQty += saleQty;
    week.normalQty += toNumber(day.normal_qty);
    week.salesAmount += saleAmount;
    week.normalAmount += toNumber(day.normal_amt);
    addChannel(week.channels, channel, saleQty, saleAmount);
    addChannel(totalChannels, channel, saleQty, saleAmount);

    const plant = String(day.plant || "");
    if (plant) {
      if (!week.stores.has(plant)) {
        week.stores.set(plant, {
          plant,
          name: day.plant_nm || plant,
          channel,
          qty: 0,
          amount: 0,
        });
      }
      const store = week.stores.get(plant);
      store.qty += saleQty;
      store.amount += saleAmount;
    }
  }

  const inventory = inventoryMap.get(style.styleCode) || {};
  const inboundQty = toNumber(inventory.inbound_qty);
  const orderQty = toNumber(inventory.order_qty);
  const orderAmount = toNumber(inventory.order_amt);
  const cumulativeQty = toNumber(inventory.total_qty);
  const cumulativeNormalQty = toNumber(inventory.total_normal_qty);
  const cumulativeSalesAmount = toNumber(inventory.total_sales_amount);
  const cumulativeNormalAmount = toNumber(inventory.total_normal_amount);
  const stock = toNumber(inventory.stock_qty);
  const inboundAmount = inboundQty * style.price;

  const weekly = [...weeklyMap.values()].map((week, index) => ({
    index,
    label: week.label,
    actualQty: Math.round(week.actualQty),
    normalQty: Math.round(week.normalQty),
    salesAmount: Math.round(week.salesAmount),
    normalAmount: Math.round(week.normalAmount),
    channels: Object.fromEntries(Object.entries(week.channels).map(([key, value]) => [key, {
      qty: Math.round(value.qty),
      amount: Math.round(value.amount),
    }])),
    topStore: topStoreFromMap(week.stores),
  }));

  styles.push({
    styleCode: style.styleCode,
    styleName: style.styleName,
    productName: style.styleName,
    season: "26",
    categoryLarge: style.category || classifyCategory(style.styleCode),
    categoryMid: style.category || classifyCategory(style.styleCode),
    categorySmall: style.category || classifyCategory(style.styleCode),
    price: Math.round(style.price),
    inboundQty: Math.round(inboundQty),
    orderQty: Math.round(orderQty),
    orderAmount: Math.round(orderAmount),
    totalQty: Math.round(cumulativeQty),
    totalNormalQty: Math.round(cumulativeNormalQty),
    totalSalesAmount: Math.round(cumulativeSalesAmount),
    totalNormalAmount: Math.round(cumulativeNormalAmount),
    firstSaleDate: firstSaleDate ? ymd(firstSaleDate) : "",
    salesWeeks: salesWeeksBetween(firstSaleDate, targetWeek.end),
    channelSales: Object.fromEntries(Object.entries(totalChannels).map(([key, value]) => [key, {
      qty: Math.round(value.qty),
      amount: Math.round(value.amount),
    }])),
    normalRate: inboundAmount > 0 ? Math.round((cumulativeNormalAmount / inboundAmount) * 10000) / 10000 : 0,
    costRate: 0,
    stock: Math.round(stock),
    reorderTotal: 0,
    weekly,
    trend: weekly.map((week, index) => ({
      index,
      label: week.label,
      actualQty: week.actualQty,
      targetQty: week.normalQty,
      predictedQty: 0,
    })),
    forecast: [],
    priorSeries: [],
    similarStyle: null,
    coPurchaseWeekLabel: coPurchaseLabel,
    coPurchases: coPurchaseMap.get(style.styleCode) || [],
    colors: [],
    skuPlan: [],
  });
}

const latestDate = latestAvailableDate ? parseYmd(latestAvailableDate) : targetWeek.end;
const latestStart = weekStart(latestDate);
const latestEnd = new Date(latestStart);
latestEnd.setDate(latestStart.getDate() + 6);
const latestLabel = labelFromDates(latestStart, latestEnd);
const hasTarget = styles.some((style) => style.weekly.some((week) => week.label === targetWeek.label));
const dataWeekLabel = hasTarget ? targetWeek.label : latestLabel;

const summary = styles.map((style) => {
  const week = style.weekly.find((item) => item.label === dataWeekLabel) || style.weekly.at(-1) || {};
  return {
    season: style.season,
    category: style.categoryMid,
    styleCode: style.styleCode,
    styleName: style.styleName,
    orderAmount: style.orderAmount,
    inboundAmount: style.inboundQty * style.price,
    weekSalesAmount: Math.round(toNumber(week.salesAmount)),
    cumulativeSalesAmount: style.totalSalesAmount,
    regularSalesAmount: style.totalNormalAmount,
    reorderTotal: 0,
    normalRate: style.normalRate,
  };
});

const payload = {
  generatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace("T", " "),
  targetWeekLabel: targetWeek.label,
  dataWeekLabel,
  latestWeek: dataWeekLabel,
  latestWeekLabel: dataWeekLabel,
  source: "DaaS fpw.total_mart + ods.fpw_tmaterial",
  materialPrefix: "WH",
  stats: {
    productionStyles: styles.length,
    joinedStyles: styles.length,
    priorStyles: 0,
    progressMappedStyles: 0,
    skuStyles: 0,
    costStyles: 0,
    recommendedStyles: 0,
    recommendationRows: 0,
  },
  recommendations: [],
  summary,
  styles,
};

fs.writeFileSync(outPath, `window.REORDER_DATA = ${JSON.stringify(payload)};`, "utf8");
console.log(`Generated ${outPath}`);
console.log(`styles=${styles.length} target=${targetWeek.label} dataWeek=${dataWeekLabel} materialPrefix=WH`);
