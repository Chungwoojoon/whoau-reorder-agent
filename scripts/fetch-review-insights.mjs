import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(process.cwd());
const APP_DATA_PATH = path.join(ROOT, "data", "app-data.js");
const IMAGE_MAP_PATH = path.join(ROOT, "data", "image-map.js");
const OUTPUT_PATH = path.join(ROOT, "data", "review-insights.js");
const CREMA_BASE = "https://review2.cre.ma/api/whoau.com";
const CREMA_WIDGET_ID = "49";
const MAX_REVIEWS_PER_STYLE = 80;
const MAX_STYLES = Number(process.env.REVIEW_STYLE_LIMIT || 360);

const sources = [
  { id: "whoau", label: "공홈", searchUrl: (styleCode) => `https://whoau.com/product/search.html?banner_action=&keyword=${encodeURIComponent(styleCode)}` },
  { id: "zigzag", label: "지그재그", searchUrl: (styleCode) => `https://zigzag.kr/search?keyword=${encodeURIComponent(styleCode)}` },
  { id: "naver", label: "네이버", searchUrl: (styleCode) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(styleCode)}` },
  { id: "musinsa", label: "무신사", searchUrl: (styleCode) => `https://www.musinsa.com/search/goods?keyword=${encodeURIComponent(styleCode)}` },
  { id: "eland", label: "이랜드몰", searchUrl: (styleCode) => `https://www.elandmall.co.kr/search/search.action?kwd=${encodeURIComponent(styleCode)}` },
];

const positivePatterns = [
  ["핏", /핏|라인|실루엣|예쁘게 떨어|날씬|체형/],
  ["디자인", /예쁘|이쁘|귀엽|깔끔|디자인|색감|컬러|무난|데일리|활용|코디|고급/],
  ["착용감", /편하|편해|부드럽|촉감|가볍|시원|따뜻|포근|착용감|신축|쾌적/],
  ["품질", /퀄리티|원단|재질|탄탄|마감|좋아|만족|추천|최고/],
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
    .trim();
}

function reviewText(review) {
  return cleanMessage(review.filtered_message || review.message || review.content || review.body || "");
}

function keywordHits(text, patterns) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function sentimentFor(review) {
  const text = reviewText(review);
  const positive = keywordHits(text, positivePatterns);
  const negative = keywordHits(text, negativePatterns);
  const score = Number(review.score || review.rating || 0);
  const weighted = positive.length - negative.length + (score >= 5 ? 1 : score > 0 && score <= 3 ? -1 : 0);
  if (weighted > 0) return "positive";
  if (weighted < 0) return "negative";
  return "neutral";
}

function countKeywords(reviews, patterns) {
  const counts = new Map();
  for (const review of reviews) {
    const text = reviewText(review);
    for (const label of keywordHits(text, patterns)) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));
}

function compactReview(review) {
  const message = reviewText(review);
  return {
    source: review.source || "whoau",
    sourceLabel: review.sourceLabel || "공홈",
    author: review.user_display_name || review.author || "",
    date: String(review.created_at || review.date || "").slice(0, 10),
    score: Number(review.score || review.rating || 0),
    message: message.length > 180 ? `${message.slice(0, 180)}...` : message,
  };
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

async function fetchWhoauReviews(productNo) {
  const reviews = [];
  let page = 1;
  let total = 0;
  let averageScore = 0;

  while (reviews.length < MAX_REVIEWS_PER_STYLE) {
    const per = Math.min(30, MAX_REVIEWS_PER_STYLE - reviews.length);
    const url = `${CREMA_BASE}/reviews?product_code=${encodeURIComponent(productNo)}&widget_id=${CREMA_WIDGET_ID}&page=${page}&per=${per}`;
    const data = await fetchJson(url);
    const pageReviews = (Array.isArray(data.reviews) ? data.reviews : []).map((review) => ({
      ...review,
      source: "whoau",
      sourceLabel: "공홈",
    }));
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

function unavailableSource(source, styleCode, reason) {
  return {
    id: source.id,
    label: source.label,
    status: "pending",
    count: 0,
    url: source.searchUrl(styleCode),
    reason,
  };
}

function analyze(styleCode, styleName, sourceResults, reviews, averageScore) {
  const validReviews = reviews.filter((review) => reviewText(review));
  const buckets = { positive: [], negative: [], neutral: [] };
  for (const review of validReviews) buckets[sentimentFor(review)].push(review);

  const sourceCounts = sourceResults.map((source) => ({
    id: source.id,
    label: source.label,
    status: source.status,
    count: source.count || 0,
    url: source.url,
    reason: source.reason || "",
  }));

  const positiveKeywords = countKeywords(buckets.positive, positivePatterns);
  const negativeKeywords = countKeywords(buckets.negative, negativePatterns);
  const totalReviews = sourceCounts.reduce((sum, source) => sum + Number(source.count || 0), 0);

  return {
    styleCode,
    styleName,
    generatedAt: nowKst(),
    totalReviews,
    analyzedReviews: validReviews.length,
    averageScore: Number(averageScore || 0),
    positiveCount: buckets.positive.length,
    negativeCount: buckets.negative.length,
    neutralCount: buckets.neutral.length,
    sources: sourceCounts,
    positiveKeywords,
    negativeKeywords,
    summary: buildSummary(positiveKeywords, negativeKeywords, validReviews.length),
    positiveReviews: buckets.positive.slice(0, 5).map(compactReview),
    negativeReviews: buckets.negative.slice(0, 5).map(compactReview),
    neutralReviews: buckets.neutral.slice(0, 3).map(compactReview),
  };
}

function buildSummary(positiveKeywords, negativeKeywords, analyzedCount) {
  if (!analyzedCount) return ["아직 자동 수집된 리뷰가 없습니다. 채널별 검색 링크에서 리뷰 존재 여부를 확인할 수 있습니다."];
  const lines = [];
  if (positiveKeywords.length) lines.push(`긍정 반응은 ${positiveKeywords.slice(0, 3).map((item) => item.label).join(", ")} 언급이 많습니다.`);
  if (negativeKeywords.length) lines.push(`부정 반응은 ${negativeKeywords.slice(0, 3).map((item) => item.label).join(", ")} 쪽에서 확인됩니다.`);
  if (!lines.length) lines.push("리뷰는 있으나 반복적으로 강하게 잡히는 키워드는 아직 적습니다.");
  return lines;
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

function chooseStyles(appData, imageMap) {
  const ranked = [...(appData.styles || [])]
    .filter((style) => imageMap[style.styleCode]?.productUrl)
    .sort((a, b) => Number(b.weekly?.at(-1)?.actualQty || 0) - Number(a.weekly?.at(-1)?.actualQty || 0))
    .slice(0, MAX_STYLES);
  return ranked;
}

const appData = loadWindowData(APP_DATA_PATH, "REORDER_DATA") || { styles: [] };
const imageMap = loadWindowData(IMAGE_MAP_PATH, "WHOAU_IMAGE_MAP")?.images || {};
const output = {};
const styles = chooseStyles(appData, imageMap);

console.log(`Building review insights for ${styles.length} styles`);

for (let index = 0; index < styles.length; index += 1) {
  const style = styles[index];
  const styleCode = style.styleCode;
  const styleName = style.styleName || style.productName || styleCode;
  const productNo = productNoFromUrl(imageMap[styleCode]?.productUrl);
  const sourceResults = [];
  let reviews = [];
  let averageScore = 0;

  if (productNo) {
    try {
      const whoau = await fetchWhoauReviews(productNo);
      reviews = reviews.concat(whoau.reviews);
      averageScore = whoau.averageScore;
      sourceResults.push({
        id: "whoau",
        label: "공홈",
        status: "collected",
        count: whoau.total,
        url: imageMap[styleCode]?.productUrl || sources[0].searchUrl(styleCode),
      });
    } catch (error) {
      sourceResults.push({
        id: "whoau",
        label: "공홈",
        status: "error",
        count: 0,
        url: imageMap[styleCode]?.productUrl || sources[0].searchUrl(styleCode),
        reason: error.message,
      });
    }
  } else {
    sourceResults.push(unavailableSource(sources[0], styleCode, "공홈 상품 URL을 찾지 못했습니다."));
  }

  sourceResults.push(unavailableSource(sources[1], styleCode, "검색 페이지는 접근 가능하지만 리뷰 API는 추가 확인이 필요합니다."));
  sourceResults.push(unavailableSource(sources[2], styleCode, "서버 접근이 차단되어 브라우저/공식 제휴 API 확인이 필요합니다."));
  sourceResults.push(unavailableSource(sources[3], styleCode, "검색 결과가 없거나 리뷰 API 엔드포인트 확인이 필요합니다."));
  sourceResults.push(unavailableSource(sources[4], styleCode, "현재 검색 엔드포인트가 오류 응답을 반환합니다."));

  output[styleCode] = analyze(styleCode, styleName, sourceResults, reviews, averageScore);
  console.log(`${index + 1}/${styles.length} ${styleCode} reviews ${output[styleCode].totalReviews}`);
}

const payload = {
  generatedAt: nowKst(),
  sourceNote: "공홈은 Crema 공개 리뷰 API에서 수집했습니다. 지그재그, 네이버, 무신사, 이랜드몰은 채널별 검색 URL과 수집 상태를 함께 제공합니다.",
  sources: sources.map((source) => ({ id: source.id, label: source.label })),
  insights: output,
};

fs.writeFileSync(OUTPUT_PATH, `window.WHOAU_REVIEW_INSIGHTS = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`Wrote ${OUTPUT_PATH}`);
