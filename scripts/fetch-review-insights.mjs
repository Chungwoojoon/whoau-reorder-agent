import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const OUTPUT_PATH = path.join(ROOT, "data", "review-insights.js");
const SHEET_ID = "1cmm-n11SvbDKuqFHXookqCHKsqCoxC2qD1b3H7LkoUw";
const SHEET_GID = "2000350105";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const CHANNEL_ORDER = ["지그재그", "네이버", "무신사", "이랜드몰", "공홈"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "").trim();
}

function splitTags(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function countBy(items, getter) {
  const map = new Map();
  for (const item of items) {
    const keys = getter(item);
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([label, count]) => ({ label, count }));
}

function compactReview(row) {
  const message = row.reviewText || "";
  return {
    source: row.channel,
    sourceLabel: row.channel,
    author: "",
    date: row.reviewDate,
    score: row.rating,
    message: message.length > 220 ? `${message.slice(0, 220)}...` : message,
    reaction: row.reaction,
    issueTags: row.issueTags,
    sizeJudgement: row.sizeJudgement,
    note: row.note,
  };
}

function compactDatasetReview(row) {
  const message = row.reviewText || "";
  return {
    reviewId: row.reviewId,
    channel: row.channel,
    productName: row.productName,
    styleCode: row.styleCode,
    rating: row.rating,
    reviewDate: row.reviewDate,
    message: message.length > 260 ? `${message.slice(0, 260)}...` : message,
    reaction: row.reaction,
    issueTags: row.issueTags,
    sizeJudgement: row.sizeJudgement,
    note: row.note,
  };
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function averageRating(rows) {
  const rated = rows.filter((row) => Number(row.rating) > 0);
  if (!rated.length) return 0;
  return rated.reduce((sum, row) => sum + Number(row.rating), 0) / rated.length;
}

function sourceCounts(rows) {
  const counts = countBy(rows, (row) => row.channel);
  return CHANNEL_ORDER.map((channel) => {
    const found = counts.find((item) => item.label === channel);
    return { id: channel, label: channel, status: found ? "collected" : "empty", count: found?.count || 0 };
  }).filter((source) => source.count > 0 || CHANNEL_ORDER.includes(source.label));
}

function buildSummary(rows, topIssues, topSizes) {
  const total = rows.length;
  if (!total) return ["아직 이 스타일의 리뷰 데이터가 없습니다."];
  const positive = rows.filter((row) => row.reaction === "긍정").length;
  const negative = rows.filter((row) => row.reaction === "부정").length;
  const channels = countBy(rows, (row) => row.channel).slice(0, 2).map((item) => item.label).join(", ");
  const lines = [
    `총 ${total.toLocaleString("ko-KR")}건 중 긍정 ${pct(positive, total)}%, 부정 ${pct(negative, total)}%로 집계됐습니다.`,
  ];
  if (channels) lines.push(`리뷰가 많이 들어온 채널은 ${channels}입니다.`);
  if (topIssues.length) lines.push(`반복 이슈는 ${topIssues.slice(0, 3).map((item) => item.label).join(", ")} 순으로 많이 언급됐습니다.`);
  if (topSizes.length) lines.push(`사이즈 반응은 ${topSizes.slice(0, 2).map((item) => item.label).join(", ")} 의견이 눈에 띕니다.`);
  return lines;
}

function analyzeStyle(styleCode, rows) {
  const total = rows.length;
  const positiveRows = rows.filter((row) => row.reaction === "긍정");
  const negativeRows = rows.filter((row) => row.reaction === "부정");
  const neutralRows = rows.filter((row) => !["긍정", "부정"].includes(row.reaction));
  const issueTags = countBy(rows, (row) => row.issueTags).slice(0, 12);
  const sizeTags = countBy(rows, (row) => row.sizeJudgement).slice(0, 8);

  return {
    styleCode,
    styleName: rows[0]?.productName || styleCode,
    generatedAt: rows[0]?.analyzedAt || "",
    totalReviews: total,
    analyzedReviews: total,
    averageScore: averageRating(rows),
    positiveCount: positiveRows.length,
    negativeCount: negativeRows.length,
    neutralCount: neutralRows.length,
    sources: sourceCounts(rows),
    issueTags,
    sizeTags,
    positiveKeywords: issueTags,
    negativeKeywords: countBy(negativeRows, (row) => row.issueTags).slice(0, 8),
    summary: buildSummary(rows, issueTags, sizeTags),
    positiveReviews: positiveRows.slice(0, 6).map(compactReview),
    negativeReviews: negativeRows.slice(0, 6).map(compactReview),
    neutralReviews: neutralRows.slice(0, 4).map(compactReview),
    recentReviews: rows.slice(0, 8).map(compactReview),
  };
}

function buildOverview(rows, insights) {
  const total = rows.length;
  const positive = rows.filter((row) => row.reaction === "긍정").length;
  const negative = rows.filter((row) => row.reaction === "부정").length;
  const neutral = total - positive - negative;
  const issueTags = countBy(rows, (row) => row.issueTags).slice(0, 16);
  const sizeTags = countBy(rows, (row) => row.sizeJudgement).slice(0, 10);
  const channelCounts = countBy(rows, (row) => row.channel);
  const topStyles = Object.values(insights)
    .sort((a, b) => b.totalReviews - a.totalReviews || a.styleCode.localeCompare(b.styleCode))
    .slice(0, 12)
    .map((item) => ({
      styleCode: item.styleCode,
      styleName: item.styleName,
      totalReviews: item.totalReviews,
      averageScore: item.averageScore,
      positiveCount: item.positiveCount,
      negativeCount: item.negativeCount,
    }));

  return {
    totalReviews: total,
    styleCount: Object.keys(insights).length,
    mappedReviews: rows.filter((row) => row.styleCode).length,
    unmappedReviews: rows.filter((row) => !row.styleCode).length,
    averageScore: averageRating(rows),
    positiveCount: positive,
    negativeCount: negative,
    neutralCount: neutral,
    channels: channelCounts,
    issueTags,
    sizeTags,
    topStyles,
    recentReviews: rows.slice(0, 10).map(compactReview),
    summary: buildSummary(rows, issueTags, sizeTags),
  };
}

async function main() {
  const response = await fetch(SHEET_CSV_URL, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Failed to download review sheet: ${response.status} ${response.statusText}`);

  const csv = await response.text();
  const table = parseCsv(csv).filter((row) => row.some((cell) => String(cell).trim()));
  const headers = table.shift().map(normalizeHeader);
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));

  const rows = table.map((row) => ({
    reviewId: row[index["리뷰ID"]] || "",
    channel: row[index["채널"]] || "",
    productName: row[index["상품명"]] || "",
    styleCode: String(row[index["스타일코드"]] || "").trim().toUpperCase(),
    rating: Number(row[index["별점"]] || 0),
    reviewDate: row[index["작성일"]] || "",
    reviewText: row[index["리뷰내용"]] || "",
    reaction: row[index["반응"]] || "",
    issueTags: splitTags(row[index["이슈태그"]]),
    sizeJudgement: row[index["사이즈판정"]] || "",
    note: row[index["지적사항"]] || "",
    analyzedAt: row[index["분석일시"]] || "",
  })).filter((row) => row.reviewText);

  const grouped = new Map();
  for (const row of rows) {
    if (!row.styleCode) continue;
    if (!grouped.has(row.styleCode)) grouped.set(row.styleCode, []);
    grouped.get(row.styleCode).push(row);
  }

  const insights = {};
  for (const [styleCode, styleRows] of grouped.entries()) {
    insights[styleCode] = analyzeStyle(styleCode, styleRows);
  }

  const generatedAt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

  const payload = {
    generatedAt,
    sourceNote: "구글 스프레드시트 '2026 리뷰 모음' CSV 데이터를 기준으로 집계했습니다.",
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`,
    sources: CHANNEL_ORDER.map((label) => ({ id: label, label })),
    overview: buildOverview(rows, insights),
    reviews: rows.map(compactDatasetReview),
    insights,
  };

  fs.writeFileSync(OUTPUT_PATH, `window.WHOAU_REVIEW_INSIGHTS = ${JSON.stringify(payload)};\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}: ${rows.length} reviews, ${Object.keys(insights).length} styles`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
