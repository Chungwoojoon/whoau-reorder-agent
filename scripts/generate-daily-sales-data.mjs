import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
const outPath = path.join(projectRoot, "data", "daily-sales-data.js");

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

function displayDate(value) {
  return `${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

function previousDay(reference = new Date()) {
  const target = new Date(reference);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() - 1);
  return target;
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
    .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

function itemCode(styleCode) {
  return String(styleCode || "").slice(2, 4).toUpperCase();
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

const target = previousDay();
const targetYmd = ymd(target);

const sql = `
WITH daily AS (
  SELECT
    LEFT(t.material, 10) AS material,
    t.plant,
    SUM(COALESCE(t.sale, 0)) AS sale_qty,
    SUM(COALESCE(t.saleamt, 0)) AS sale_amt,
    SUM(COALESCE(t.salejung, 0)) AS normal_qty,
    SUM(COALESCE(t.salejungamt, 0)) AS normal_amt
  FROM fpw.total_mart t
  WHERE t.calday = $1
    AND t.material LIKE 'WH%'
    AND SUBSTRING(LEFT(t.material, 10) FROM 6 FOR 1) <> 'B'
    AND SUBSTRING(LEFT(t.material, 10) FROM 5 FOR 2) IN ('G1', 'G2', 'G3', 'G4')
    AND COALESCE(t.plant, '') <> '1118'
  GROUP BY LEFT(t.material, 10), t.plant
),
tmaterial AS (
  SELECT
    LEFT(material, 10) AS material,
    STRING_AGG(DISTINCT material_nm, '|||') AS material_names,
    MAX(COALESCE(zzitem_h2_nm, zzitem_h1_nm, aprl_type_nm, '')) AS category_nm
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
  COALESCE(tm.material_names, d.material) AS material_names,
  COALESCE(tm.category_nm, '') AS category_nm,
  COALESCE(pm.price, 0) AS price,
  d.plant,
  COALESCE(tp.plant_nm, d.plant, '') AS plant_nm,
  d.sale_qty,
  d.sale_amt,
  d.normal_qty,
  d.normal_amt
FROM daily d
LEFT JOIN tmaterial tm ON d.material = tm.material
LEFT JOIN pmaterial pm ON d.material = pm.material
LEFT JOIN tplant tp ON d.plant = tp.plant
ORDER BY d.material
`;

const client = getClient();
await client.connect();
let rows = [];
try {
  const result = await client.query(sql, [targetYmd]);
  rows = result.rows;
} finally {
  await client.end();
}

const grouped = new Map();
for (const row of rows) {
  const material = row.material;
  if (!grouped.has(material)) {
    grouped.set(material, {
      styleCode: material,
      styleName: bestStyleName(row.material_names, material),
      itemCode: itemCode(material),
      category: row.category_nm || "",
      price: normalizePrice(row.price),
      dailyQty: 0,
      normalQty: 0,
      dailyAmount: 0,
      normalAmount: 0,
      channels: emptyChannels(),
    });
  }
  const style = grouped.get(material);
  const qty = toNumber(row.sale_qty);
  const amount = toNumber(row.sale_amt);
  const channel = classifySalesChannel(row.plant, row.plant_nm);
  style.dailyQty += qty;
  style.normalQty += toNumber(row.normal_qty);
  style.dailyAmount += amount;
  style.normalAmount += toNumber(row.normal_amt);
  addChannel(style.channels, channel, qty, amount);
}

const styles = [...grouped.values()]
  .map((style) => ({
    ...style,
    price: Math.round(style.price),
    dailyQty: Math.round(style.dailyQty),
    normalQty: Math.round(style.normalQty),
    dailyAmount: Math.round(style.dailyAmount),
    normalAmount: Math.round(style.normalAmount),
    channels: Object.fromEntries(Object.entries(style.channels).map(([key, value]) => [key, {
      qty: Math.round(value.qty),
      amount: Math.round(value.amount),
    }])),
  }))
  .filter((style) => style.dailyQty !== 0 || style.dailyAmount !== 0)
  .sort((a, b) => b.dailyQty - a.dailyQty || b.dailyAmount - a.dailyAmount || a.styleCode.localeCompare(b.styleCode));

const payload = {
  generatedAt: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()),
  targetDate: targetYmd,
  targetDateLabel: displayDate(targetYmd),
  source: "DaaS fpw.total_mart",
  materialPrefix: "WH",
  styles,
};

fs.writeFileSync(outPath, `window.WHOAU_DAILY_SALES = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`Generated ${outPath}`);
console.log(`styles=${styles.length} targetDate=${targetYmd}`);
