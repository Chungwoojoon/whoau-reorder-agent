import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(process.cwd());
const IMAGE_MAP_PATH = path.join(ROOT, "data", "image-map.js");
const APP_DATA_PATH = path.join(ROOT, "data", "app-data.js");
const OUTPUT_PATH = path.join(ROOT, "data", "review-map.js");
const CREMA_BASE = "https://review2.cre.ma/api/whoau.com";
const WIDGET_ID = "49";
const MAX_REVIEWS_PER_STYLE = 60;

const positivePatterns = [
  ["핏", /핏|라인|실루엣|예쁘게 떨어|날씬/],
  ["디자인", /예쁘|이쁘|귀엽|깔끔|디자인|색감|컬러|무난|데일리|활용|코디/],
  ["착용감", /편하|편해|부드럽|촉감|가볍|시원|따뜻|포근|착용감|신축/],
  ["품질", /퀄리티|원단|재질|탄탄|마감|고급|좋아|만족|추천|최고/],
  ["사이즈", /사이즈.*좋|정사이즈|넉넉|잘 맞|여유|오버핏|기장.*좋/],
  ["배송", /배송.*빠르|빨리|포장|안전하게/],
];

const negativePatterns = [
  ["사이즈", /작아|작네요|커요|크네요|타이트|끼|짧|길어|기장.*아쉽|사이즈.*아쉽/],
  ["두께/비침", /비침|얇|두껍|두꺼|덥|춥|속이 보여/],
  ["착용감", /불편|까슬|무겁|뻣뻣|따가|답답|흘러|늘어/],
  ["품질", /아쉽|별로|실망|냄새|구김|보풀|마감.*아쉽|불량|오염|뜯어/],
  ["배송/CS", /배송.*늦|늦게|교환|반품|환불|누락/],
  ["색상", /색.*달라|화면.*달라|색상.*아쉽/],
];

function loadWindowData(filePath, key) {
  const source = fs.readFileSync(filePath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: filePath });
  return context.window[key];
}

function productNoFromUrl(url = "") {
  const match = String(url).match(/\/(\d+)\/category\//) || String(url).match(/[?&]product_no=(\d+)/);
  return match ? match[1] : "";
}

function cleanMessage(value = "") {
  return String(value)
    .replace(/\d{4}-\d{2}-\d{2}\s*에 등록된[\s\S]*?구매평/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+에 등록된 .*구매평/g, "")
    .trim();
}

function keywordHits(text, patterns) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function reviewText(review) {
  return cleanMessage(review.filtered_message || review.message || review.content || review.body || "");
}

function sentimentFor(review) {
  const text = reviewText(review);
  const positive = keywordHits(text, positivePatterns);
  const negative = keywordHits(text, negativePatterns);
  const score = Number(review.score || review.product_score || 0);
  const weighted = positive.length - negative.length + (score >= 5 ? 1 : score > 0 && score <= 3 ? -1 : 0);
  if (weighted > 0) return "positive";
  if (weighted < 0) return "negative";
  return "neutral";
}

function countKeywords(reviews, patterns) {
  const counts = new Map();
  for (const review of reviews) {
    const text = reviewText(review);
    for (const label of keywordHits(text, patterns)) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

function compactReview(review) {
  const message = reviewText(review);
  return {
    id: review.id || null,
    author: review.user_display_name || review.author || "",
    date: String(review.created_at || "").slice(0, 10),
    score: Number(review.score || 0),
    message: message.length > 220 ? `${message.slice(0, 220)}...` : message,
  };
}

function buildInsights(positiveKeywords, negativeKeywords, counts) {
  const result = [];
  if (positiveKeywords.length) {
    result.push(`긍정 리뷰는 ${positiveKeywords.slice(0, 3).map((item) => item.label).join(", ")} 이야기가 많이 나옵니다.`);
  }
  if (negativeKeywords.length) {
    result.push(`부정 리뷰는 ${negativeKeywords.slice(0, 3).map((item) => item.label).join(", ")} 관련 언급을 확인했습니다.`);
  }
  if (!result.length && counts.total > 0) result.push("리뷰 수는 있으나 뚜렷하게 반복되는 긍정/부정 키워드는 적습니다.");
  return result;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      referer: "https://review2.cre.ma/v2/whoau.com/product_reviews/list_v3",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchReviews(productNo) {
  const reviews = [];
  let page = 1;
  let total = 0;
  let averageScore = 0;

  while (reviews.length < MAX_REVIEWS_PER_STYLE) {
    const per = Math.min(30, MAX_REVIEWS_PER_STYLE - reviews.length);
    const url = `${CREMA_BASE}/reviews?product_code=${encodeURIComponent(productNo)}&widget_id=${WIDGET_ID}&page=${page}&per=${per}`;
    const data = await fetchJson(url);
    const pageReviews = Array.isArray(data.reviews) ? data.reviews : [];
    if (page === 1) {
      total = Number(pageReviews[0]?.product_meta_reviews_count || data.pagy?.items || pageReviews.length || 0);
      averageScore = Number(pageReviews[0]?.product_meta_score || 0);
    }
    reviews.push(...pageReviews);
    if (!data.pagy?.next || !pageReviews.length) break;
    page = Number(data.pagy.next);
  }
  return { total: Math.max(total, reviews.length), averageScore, reviews };
}

function analyze(styleCode, productNo, styleName, result) {
  const reviews = result.reviews.filter((review) => reviewText(review));
  const buckets = { positive: [], negative: [], neutral: [] };
  for (const review of reviews) buckets[sentimentFor(review)].push(review);

  const positiveKeywords = countKeywords(buckets.positive, positivePatterns);
  const negativeKeywords = countKeywords(buckets.negative, negativePatterns);
  const counts = {
    total: Number(result.total || reviews.length || 0),
    analyzed: reviews.length,
    positive: buckets.positive.length,
    negative: buckets.negative.length,
    neutral: buckets.neutral.length,
  };

  return {
    productNo,
    styleName,
    total: counts.total,
    analyzed: counts.analyzed,
    averageScore: Number(result.averageScore || 0),
    positiveCount: counts.positive,
    negativeCount: counts.negative,
    neutralCount: counts.neutral,
    positiveKeywords,
    negativeKeywords,
    insights: buildInsights(positiveKeywords, negativeKeywords, counts),
    positiveReviews: buckets.positive.slice(0, 4).map(compactReview),
    negativeReviews: buckets.negative.slice(0, 4).map(compactReview),
    neutralReviews: buckets.neutral.slice(0, 2).map(compactReview),
  };
}

function nowKst() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

const imageMap = loadWindowData(IMAGE_MAP_PATH, "WHOAU_IMAGE_MAP")?.images || {};
const appData = loadWindowData(APP_DATA_PATH, "REORDER_DATA") || { styles: [] };
const stylesByCode = new Map(appData.styles.map((style) => [style.styleCode, style]));
const output = {};

const entries = Object.entries(imageMap).filter(([, item]) => productNoFromUrl(item?.productUrl));
console.log(`Fetching reviews for ${entries.length} styles`);

for (let index = 0; index < entries.length; index += 1) {
  const [styleCode, image] = entries[index];
  const productNo = productNoFromUrl(image.productUrl);
  const styleName = stylesByCode.get(styleCode)?.styleName || styleCode;
  try {
    const result = await fetchReviews(productNo);
    output[styleCode] = analyze(styleCode, productNo, styleName, result);
    console.log(`${index + 1}/${entries.length} ${styleCode} reviews ${output[styleCode].total}`);
  } catch (error) {
    output[styleCode] = {
      productNo,
      styleName,
      total: 0,
      analyzed: 0,
      averageScore: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      positiveKeywords: [],
      negativeKeywords: [],
      insights: [`리뷰 수집 중 오류가 발생했습니다: ${error.message}`],
      positiveReviews: [],
      negativeReviews: [],
      neutralReviews: [],
    };
    console.warn(`${styleCode} failed: ${error.message}`);
  }
}

const payload = {
  generatedAt: nowKst(),
  source: "https://review2.cre.ma/api/whoau.com/reviews",
  maxReviewsPerStyle: MAX_REVIEWS_PER_STYLE,
  reviews: output,
};

fs.writeFileSync(OUTPUT_PATH, `window.WHOAU_REVIEW_MAP = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`Wrote ${OUTPUT_PATH}`);
