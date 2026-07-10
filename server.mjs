import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, ".env");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const salesCache = { payload: null, expiresAt: 0 };

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
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
  return { start: previousMonday, end: previousSunday, label: labelFromDates(previousMonday, previousSunday) };
}

function priorYearDate(date) {
  return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
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

function toNumber(value) {
  return Number(value || 0);
}

function normalizePrice(value) {
  const price = toNumber(value);
  return price > 0 && price < 10000 ? price * 100 : price;
}

function cleanStyleName(value, fallback = "") {
  return String(value || fallback || "").split(",")[0].trim();
}

function bestStyleName(value, fallback = "") {
  const names = String(value || "")
    .split("|||")
    .map((name) => cleanStyleName(name))
    .filter(Boolean);
  if (!names.length) return cleanStyleName(fallback, fallback);
  return [...new Set(names)].sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

function classifySalesChannel(plant, plantName) {
  const code = String(plant || "").trim().toUpperCase();
  const name = String(plantName || "").trim();
  const onlineCodes = new Set(["ADGT", "ADHD", "AE2W", "AALB", "AACA", "AEAC"]);
  const buyerCodes = new Set(["ADTM", "ADE2", "AD58", "AEF4", "AE9E", "AEER", "AEK4"]);
  if (buyerCodes.has(code) || /면세|SHOPEE|쇼피|바이어/i.test(name)) return "buyer";
  if (onlineCodes.has(code) || /공식몰|무신사|지그재그|이랜드몰|온라인|29CM|네이버|카카오/i.test(name)) return "online";
  return "offline";
}

function emptyChannels() {
  return { offline: { qty: 0, amount: 0 }, online: { qty: 0, amount: 0 }, buyer: { qty: 0, amount: 0 } };
}

function addChannel(target, channel, qty, amount) {
  if (!target[channel]) target[channel] = { qty: 0, amount: 0 };
  target[channel].qty += qty;
  target[channel].amount += amount;
}

function topStoreFromMap(storeMap) {
  let best = null;
  for (const store of storeMap.values()) {
    if (!best || store.qty > best.qty) best = store;
  }
  if (!best) return { plant: "", name: "-", qty: 0, amount: 0, channel: "offline" };
  return { plant: best.plant, name: best.name || best.plant || "-", qty: Math.round(best.qty), amount: Math.round(best.amount), channel: best.channel };
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

async function buildSalesAnalysisData() {
  const now = Date.now();
  if (salesCache.payload && salesCache.expiresAt > now) return salesCache.payload;

  const targetWeek = previousCompleteWeek();
  const priorEnd = priorYearDate(targetWeek.end);
  const currentStart = `${targetWeek.end.getFullYear()}0101`;
  const priorStart = `${targetWeek.end.getFullYear() - 1}0101`;
  const currentEnd = ymd(targetWeek.end);
  const priorEndYmd = ymd(priorEnd);
  const minStart = priorStart;
  const maxEnd = currentEnd;
  const styleFilter = ["WHCK", "WHKA", "WHKV", "WHTA", "WHTH", "WHTJ"];

  const sql = `
    WITH base AS (
      SELECT
        LEFT(t.material, 10) AS material,
        LEFT(t.material, 12) AS style_color,
        t.calday,
        COALESCE(t.sale, 0) AS sale_qty,
        COALESCE(t.saleamt, 0) AS sale_amt,
        COALESCE(t.salejung, 0) AS normal_qty,
        COALESCE(t.salejungamt, 0) AS normal_amt,
        COALESCE(t.ipgo_qty, 0) AS inbound_qty,
        COALESCE(t.ordqty, 0) AS order_qty,
        COALESCE(t.ordamt, 0) AS order_amt
      FROM fpw.total_mart t
      WHERE t.calday BETWEEN $1 AND $2
        AND LENGTH(t.calday) = 8
        AND t.calday ~ '^[0-9]{8}$'
        AND t.material LIKE 'WH%'
        AND SUBSTRING(LEFT(t.material, 10) FROM 5 FOR 1) IN ('G', 'F')
        AND SUBSTRING(LEFT(t.material, 10) FROM 6 FOR 1) <> 'B'
        AND COALESCE(t.plant, '') <> '1118'
        AND (
          (SUBSTRING(LEFT(t.material, 10) FROM 5 FOR 1) = 'G' AND t.calday BETWEEN $3 AND $4)
          OR
          (SUBSTRING(LEFT(t.material, 10) FROM 5 FOR 1) = 'F' AND t.calday BETWEEN $5 AND $6)
        )
    ),
    style_daily AS (
      SELECT material, calday, SUM(sale_qty) AS sale_qty, SUM(sale_amt) AS sale_amt,
        SUM(normal_qty) AS normal_qty, SUM(normal_amt) AS normal_amt
      FROM base
      GROUP BY material, calday
    ),
    inventory AS (
      SELECT material, SUM(inbound_qty) AS inbound_qty, SUM(order_qty) AS order_qty,
        SUM(order_amt) AS order_amt, SUM(sale_qty) AS total_qty, SUM(sale_amt) AS total_sales_amount,
        SUM(normal_qty) AS total_normal_qty, SUM(normal_amt) AS total_normal_amount
      FROM base
      GROUP BY material
    ),
    colors AS (
      SELECT material, style_color, SUM(inbound_qty) AS inbound_qty, SUM(order_qty) AS order_qty,
        SUM(CASE
          WHEN (SUBSTRING(material FROM 5 FOR 1) = 'G' AND calday BETWEEN $7 AND $4)
            OR (SUBSTRING(material FROM 5 FOR 1) = 'F' AND calday BETWEEN $8 AND $6)
          THEN sale_qty ELSE 0 END) AS weekly_qty,
        SUM(sale_qty) AS total_qty
      FROM base
      WHERE LEFT(material, 4) IN ('WHCK', 'WHKA', 'WHKV', 'WHTA', 'WHTH', 'WHTJ')
      GROUP BY material, style_color
    ),
    tmaterial AS (
      SELECT LEFT(material, 10) AS material, STRING_AGG(DISTINCT material_nm, '|||') AS material_names,
        MAX(zzitem_h2_nm) AS category_nm
      FROM ods.fpw_tmaterial
      WHERE material LIKE 'WH%'
      GROUP BY LEFT(material, 10)
    ),
    pmaterial AS (
      SELECT LEFT(material, 10) AS material, MAX("/bic/znopric_a") AS price
      FROM ods.fpw_pmaterial
      WHERE material LIKE 'WH%'
      GROUP BY LEFT(material, 10)
    ),
    tplant AS (
      SELECT plant, MAX(plant_nm) AS plant_nm
      FROM ods.fpw_tplant
      WHERE brand = 'WH' OR brand = '' OR brand IS NULL
      GROUP BY plant
    )
    SELECT
      'daily' AS row_type,
      d.material,
      NULL::text AS style_color,
      d.calday,
      NULL::text AS plant,
      NULL::text AS plant_nm,
      COALESCE(tm.material_names, d.material) AS material_names,
      COALESCE(tm.category_nm, '') AS category_nm,
      COALESCE(pm.price, 0) AS price,
      d.sale_qty,
      d.sale_amt,
      d.normal_qty,
      d.normal_amt,
      0::numeric AS inbound_qty,
      0::numeric AS order_qty,
      0::numeric AS order_amt,
      0::numeric AS total_qty,
      0::numeric AS total_sales_amount,
      0::numeric AS total_normal_qty,
      0::numeric AS total_normal_amount
    FROM style_daily d
    LEFT JOIN tmaterial tm ON d.material = tm.material
    LEFT JOIN pmaterial pm ON d.material = pm.material
    UNION ALL
    SELECT
      'inventory' AS row_type,
      i.material,
      NULL::text AS style_color,
      NULL::text AS calday,
      NULL::text AS plant,
      NULL::text AS plant_nm,
      COALESCE(tm.material_names, i.material) AS material_names,
      COALESCE(tm.category_nm, '') AS category_nm,
      COALESCE(pm.price, 0) AS price,
      0, 0, 0, 0,
      i.inbound_qty,
      i.order_qty,
      i.order_amt,
      i.total_qty,
      i.total_sales_amount,
      i.total_normal_qty,
      i.total_normal_amount
    FROM inventory i
    LEFT JOIN tmaterial tm ON i.material = tm.material
    LEFT JOIN pmaterial pm ON i.material = pm.material
    UNION ALL
    SELECT
      'color' AS row_type,
      c.material,
      c.style_color,
      NULL::text AS calday,
      NULL::text AS plant,
      NULL::text AS plant_nm,
      COALESCE(tm.material_names, c.material) AS material_names,
      COALESCE(tm.category_nm, '') AS category_nm,
      COALESCE(pm.price, 0) AS price,
      c.weekly_qty AS sale_qty,
      0 AS sale_amt,
      0 AS normal_qty,
      0 AS normal_amt,
      c.inbound_qty,
      c.order_qty,
      0 AS order_amt,
      c.total_qty,
      0 AS total_sales_amount,
      0 AS total_normal_qty,
      0 AS total_normal_amount
    FROM colors c
    LEFT JOIN tmaterial tm ON c.material = tm.material
    LEFT JOIN pmaterial pm ON c.material = pm.material
    ORDER BY material, row_type, calday
  `;

  const client = getClient();
  await client.connect();
  let rows;
  try {
    const result = await client.query(sql, [
      minStart,
      maxEnd,
      currentStart,
      currentEnd,
      priorStart,
      priorEndYmd,
      ymd(targetWeek.start),
      ymd(priorYearDate(targetWeek.start)),
    ]);
    rows = result.rows;
  } finally {
    await client.end();
  }

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.material)) {
      grouped.set(row.material, {
        styleCode: row.material,
        styleName: bestStyleName(row.material_names, row.material),
        category: row.category_nm || "",
        price: normalizePrice(row.price),
        daily: [],
        colors: [],
        inventory: null,
      });
    }
    const style = grouped.get(row.material);
    if (row.row_type === "daily") style.daily.push(row);
    if (row.row_type === "inventory") style.inventory = row;
    if (row.row_type === "color") style.colors.push(row);
  }

  const styles = [];
  for (const style of grouped.values()) {
    const weeklyMap = new Map();
    const totalChannels = emptyChannels();
    for (const day of style.daily) {
      const date = parseYmd(day.calday);
      const start = weekStart(date);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const label = labelFromDates(start, end);
      if (!weeklyMap.has(label)) {
        weeklyMap.set(label, { index: weeklyMap.size, label, actualQty: 0, normalQty: 0, salesAmount: 0, normalAmount: 0, channels: emptyChannels(), stores: new Map() });
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
        if (!week.stores.has(plant)) week.stores.set(plant, { plant, name: day.plant_nm || plant, channel, qty: 0, amount: 0 });
        const store = week.stores.get(plant);
        store.qty += saleQty;
        store.amount += saleAmount;
      }
    }

    const inventory = style.inventory || {};
    const inboundQty = toNumber(inventory.inbound_qty);
    const orderQty = toNumber(inventory.order_qty);
    const orderAmount = toNumber(inventory.order_amt);
    const totalQty = toNumber(inventory.total_qty);
    const totalSalesAmount = toNumber(inventory.total_sales_amount);
    const totalNormalQty = toNumber(inventory.total_normal_qty);
    const totalNormalAmount = toNumber(inventory.total_normal_amount);
    const inboundAmount = inboundQty * style.price;
    const weekly = [...weeklyMap.values()].map((week, index) => ({
      index,
      label: week.label,
      actualQty: Math.round(week.actualQty),
      normalQty: Math.round(week.normalQty),
      salesAmount: Math.round(week.salesAmount),
      normalAmount: Math.round(week.normalAmount),
      channels: Object.fromEntries(Object.entries(week.channels).map(([key, value]) => [key, { qty: Math.round(value.qty), amount: Math.round(value.amount) }])),
      topStore: topStoreFromMap(week.stores),
    }));
    const colorRows = style.colors
      .map((color) => ({
        colorCode: String(color.style_color || "").slice(10),
        colorName: String(color.style_color || "").slice(10) || "-",
        styleColorCode: color.style_color,
        inboundQty: Math.round(toNumber(color.inbound_qty)),
        orderQty: Math.round(toNumber(color.order_qty)),
        weeklyQty: Math.round(toNumber(color.sale_qty)),
        totalQty: Math.round(toNumber(color.total_qty)),
      }))
      .filter((color) => color.colorCode && color.colorCode.toUpperCase() !== "NA")
      .filter((color) => color.inboundQty || color.orderQty || color.weeklyQty || color.totalQty);

    styles.push({
      styleCode: style.styleCode,
      styleName: style.styleName,
      productName: style.styleName,
      season: style.styleCode[4] === "F" ? "25" : "26",
      categoryLarge: style.category,
      categoryMid: style.category,
      categorySmall: style.category,
      price: Math.round(style.price),
      inboundQty: Math.round(inboundQty),
      orderQty: Math.round(orderQty),
      orderAmount: Math.round(orderAmount),
      totalQty: Math.round(totalQty),
      totalNormalQty: Math.round(totalNormalQty),
      totalSalesAmount: Math.round(totalSalesAmount),
      totalNormalAmount: Math.round(totalNormalAmount),
      channelSales: Object.fromEntries(Object.entries(totalChannels).map(([key, value]) => [key, { qty: Math.round(value.qty), amount: Math.round(value.amount) }])),
      normalRate: inboundAmount > 0 ? Math.round((totalNormalAmount / inboundAmount) * 10000) / 10000 : 0,
      costRate: 0,
      stock: Math.round(inboundQty - totalQty),
      reorderTotal: 0,
      weekly,
      trend: weekly.map((week, index) => ({ index, label: week.label, actualQty: week.actualQty, targetQty: week.normalQty, predictedQty: 0 })),
      forecast: [],
      priorSeries: [],
      similarStyle: null,
      coPurchaseWeekLabel: targetWeek.label,
      coPurchases: [],
      colors: colorRows,
      skuPlan: [],
    });
  }

  const summary = styles.map((style) => {
    const week = style.weekly.find((item) => item.label === targetWeek.label) || style.weekly.at(-1) || {};
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
    dataWeekLabel: targetWeek.label,
    latestWeek: targetWeek.label,
    latestWeekLabel: targetWeek.label,
    source: "live DB: DaaS fpw.total_mart + ods.fpw_tmaterial",
    materialPrefix: "WH",
    stats: {
      productionStyles: styles.filter((style) => style.styleCode[4] === "G").length,
      joinedStyles: styles.length,
      priorStyles: styles.filter((style) => style.styleCode[4] === "F").length,
      managedStyles: styles.filter((style) => styleFilter.some((prefix) => style.styleCode.startsWith(prefix))).length,
    },
    recommendations: [],
    summary,
    styles,
  };
  salesCache.payload = payload;
  salesCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return payload;
}

loadEnv();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/sales-analysis") {
    try {
      const payload = await buildSalesAnalysisData();
      send(res, 200, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message || "Failed to load sales analysis data" }), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    return;
  }
  const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(root, `.${requestPath}`);

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const type = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, body, { "Content-Type": type, "Cache-Control": "no-store" });
  });
});

server.listen(port, host, () => {
  console.log(`WHO.A.U dashboard running at http://${host}:${port}`);
});
