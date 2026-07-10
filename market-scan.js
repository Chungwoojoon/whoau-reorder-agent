const data = window.MARKET_SCAN_DATA;
let activeId = data.platforms[0].id;

const formatter = new Intl.NumberFormat("ko-KR");

function formatPrice(value) {
  return typeof value === "number" ? `${formatter.format(value)}원` : "가격 미노출";
}

function formatReview(item) {
  if (typeof item.reviewScore === "number" && typeof item.reviewCount === "number") {
    return `리뷰 ${formatter.format(item.reviewCount)}개 · ${item.reviewScore}점`;
  }
  return "리뷰 원문 미노출";
}

function getActivePlatform() {
  return data.platforms.find((platform) => platform.id === activeId) || data.platforms[0];
}

function renderTabs() {
  const tabs = document.querySelector("#platformTabs");
  tabs.innerHTML = data.platforms
    .map(
      (platform) => `
        <button type="button" class="${platform.id === activeId ? "active" : ""}" data-platform="${platform.id}">
          ${platform.name}
        </button>
      `,
    )
    .join("");

  tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeId = button.dataset.platform;
      render();
    });
  });
}

function renderPlatform() {
  const platform = getActivePlatform();
  document.querySelector("#basisLabel").textContent = platform.basis;
  document.querySelector("#platformTitle").textContent = platform.name;
  document.querySelector("#summaryText").textContent = platform.summary;
  document.querySelector("#confidenceLabel").textContent = `신뢰도 ${platform.confidence}`;
  document.querySelector("#sourceLink").href = platform.sourceUrl;
  document.querySelector("#signalList").innerHTML = platform.signals.map((signal) => `<span>${signal}</span>`).join("");
  document.querySelector("#reviewThemes").innerHTML = platform.reviewThemes
    .map((theme) => `<li>${theme}</li>`)
    .join("");
  document.querySelector("#productMeta").textContent = `${platform.items.length}개 항목 · ${platform.basis}`;
}

function renderProducts() {
  const platform = getActivePlatform();
  document.querySelector("#productGrid").innerHTML = platform.items
    .map(
      (item) => `
        <article class="product-card">
          <img src="${item.image}" alt="${item.name}" loading="lazy" />
          <div class="product-body">
            <div class="rank-line">
              <span>#${item.rank}</span>
              <span>${item.brand}</span>
            </div>
            <h3>${item.name}</h3>
            <div class="metric-row">
              <span>${formatPrice(item.price)}</span>
              <span>${typeof item.discount === "number" && item.discount > 0 ? `${item.discount}% 할인` : "할인 미노출"}</span>
              <span>${formatReview(item)}</span>
            </div>
            <a href="${item.url}" target="_blank" rel="noreferrer">상세 보기</a>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderCompare() {
  document.querySelector("#compareGrid").innerHTML = data.platforms
    .map(
      (platform) => `
        <article class="compare-card">
          <h3>${platform.name}</h3>
          <p>${platform.summary}</p>
        </article>
      `,
    )
    .join("");
}

function render() {
  document.querySelector("#generatedAt").textContent = data.generatedAt;
  renderTabs();
  renderPlatform();
  renderProducts();
  renderCompare();
}

render();
