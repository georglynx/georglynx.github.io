/**
 * Cozzie Livs Calc — Frontend
 *
 * Two-step flow:
 *   1. Search → shows product listing (1 request to Trolley via our function)
 *   2. Click product → shows per-store pricing detail (1 more request)
 *
 * Client-side cache prevents repeat requests for the same query/product.
 */

// ─── DOM ─────────────────────────────────────────────────────────
const $ = (sel) => document.getElementById(sel);

const searchInput     = $("searchInput");
const searchBtn       = $("searchBtn");
const loading         = $("loading");
const listingSection  = $("listingSection");
const listingSummary  = $("listingSummary");
const listingGrid     = $("listingGrid");
const detailSection   = $("detailSection");
const detailBack      = $("detailBack");
const detailLoading   = $("detailLoading");
const detailContent   = $("detailContent");
const emptyState      = $("emptyState");
const errorState      = $("errorState");
const errorText       = $("errorText");

// ─── State ───────────────────────────────────────────────────────
let lastResults = null;
const cache = { searches: {}, products: {} }; // simple in-memory cache

// ─── Events ──────────────────────────────────────────────────────
searchBtn.addEventListener("click", () => doSearch());
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

document.querySelectorAll(".hint-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    searchInput.value = chip.dataset.query;
    doSearch();
  });
});

detailBack.addEventListener("click", () => {
  detailSection.hidden = true;
  listingSection.hidden = false;
});

// ─── Search (1 request) ──────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  // Check cache
  if (cache.searches[query]) {
    lastResults = cache.searches[query];
    renderListing(lastResults);
    showView("listing");
    return;
  }

  showView("loading");

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&max_results=20`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    cache.searches[query] = data; // cache it
    lastResults = data;

    if (!data.products || data.products.length === 0) {
      showView("empty");
      return;
    }

    renderListing(data);
    showView("listing");
  } catch (err) {
    showView("error", err.message);
  }
}

// ─── Product Detail (1 request) ──────────────────────────────────
async function openProduct(code, slug) {
  showView("detail");
  detailContent.innerHTML = "";
  detailLoading.hidden = false;

  // Check cache
  if (cache.products[code]) {
    renderDetail(cache.products[code], code);
    detailLoading.hidden = true;
    return;
  }

  try {
    const res = await fetch(`/api/search?product=${encodeURIComponent(code)}&slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    cache.products[code] = data; // cache it
    renderDetail(data, code);
  } catch (err) {
    detailContent.innerHTML = `<div class="error-state"><p class="error-state__text">${esc(err.message)}</p></div>`;
  } finally {
    detailLoading.hidden = true;
  }
}

// ─── Render: Listing ─────────────────────────────────────────────
function renderListing(data) {
  listingSummary.innerHTML = `<strong>${data.totalResults}</strong> results for "<strong>${esc(data.query)}</strong>"`;

  listingGrid.innerHTML = data.products.map((p) => {
    const priceHtml = p.price > 0 ? `£${p.price.toFixed(2)}` : "";
    const wasPriceHtml = p.wasPrice ? `<span class="listing-card__was">£${p.wasPrice.toFixed(2)}</span>` : "";
    const storeHtml = p.store ? `<span class="listing-card__store listing-card__store--${storeClass(p.store)}">${esc(p.store)}</span>` : "";
    const weightHtml = p.weight ? `<span class="listing-card__weight">${esc(p.weight)}</span>` : "";
    const unitHtml = p.pricePerUnit ? `<span class="listing-card__unit">£${p.pricePerUnit.toFixed(2)} ${esc(p.unit || "")}</span>` : "";

    return `
      <button class="listing-card" onclick="openProduct('${esc(p.code)}', '${esc(p.slug)}')">
        <img class="listing-card__img" src="${esc(p.imageUrl)}" alt="" loading="lazy"
             onerror="this.style.display='none'">
        <div class="listing-card__info">
          <div class="listing-card__top">
            ${storeHtml}
            ${weightHtml}
          </div>
          <div class="listing-card__name">${esc(p.name)}</div>
          <div class="listing-card__bottom">
            <span class="listing-card__price">${priceHtml}</span>
            ${wasPriceHtml}
            ${unitHtml}
          </div>
        </div>
        <svg class="listing-card__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    `;
  }).join("");
}

// ─── Render: Detail ──────────────────────────────────────────────
function renderDetail(data, code) {
  // Find original listing data for context
  const listing = lastResults?.products?.find((p) => p.code === code);

  const hasStorePrices = data.storePrices && data.storePrices.length > 0;
  const hasAlternatives = data.alternatives && data.alternatives.length > 0;

  // Header
  let html = `
    <div class="detail__header">
      ${data.imageUrl ? `<img class="detail__img" src="${esc(data.imageUrl)}" alt="">` : ""}
      <div class="detail__meta">
        <h2 class="detail__name">${esc(data.name || listing?.name || "")}</h2>
        ${data.weight ? `<span class="detail__weight">${esc(data.weight)}</span>` : ""}
        ${data.priceHistory?.usual ? `<span class="detail__usual">Usually £${data.priceHistory.usual.toFixed(2)}</span>` : ""}
      </div>
    </div>
  `;

  // Store prices
  if (hasStorePrices) {
    // Sort by best price
    const sorted = [...data.storePrices].sort((a, b) => (a.bestPrice || a.price) - (b.bestPrice || b.price));

    html += `<h3 class="detail__section-title">Where to buy</h3>`;
    html += `<div class="store-prices">`;

    sorted.forEach((sp, i) => {
      const isCheapest = i === 0;
      const hasLoyalty = sp.loyaltyPrice && sp.loyaltyPrice < sp.price;

      let loyaltyHtml = "";
      if (hasLoyalty) {
        loyaltyHtml = `
          <div class="sp__loyalty">
            <span class="sp__loyalty-price">£${sp.loyaltyPrice.toFixed(2)}</span>
            <span class="sp__loyalty-badge sp__loyalty-badge--${sp.loyaltyScheme?.toLowerCase() || ""}">${esc(sp.loyaltyScheme || "")}</span>
          </div>
        `;
      }

      html += `
        <div class="sp ${isCheapest ? "sp--cheapest" : ""}">
          <div class="sp__store sp__store--${storeClass(sp.store)}">
            ${esc(sp.store)}
            ${isCheapest ? '<span class="sp__cheapest-tag">CHEAPEST</span>' : ""}
          </div>
          <div class="sp__pricing">
            <span class="sp__price ${hasLoyalty ? "sp__price--struck" : ""}">£${sp.price.toFixed(2)}</span>
            ${loyaltyHtml}
            ${sp.pricePerUnit ? `<span class="sp__unit">£${sp.pricePerUnit.toFixed(2)} ${esc(sp.unit || "")}</span>` : ""}
            ${sp.promotion ? `<span class="sp__promo">${esc(sp.promotion)}</span>` : ""}
          </div>
        </div>
      `;
    });

    html += `</div>`;
  } else {
    html += `<p class="detail__no-data">No per-store pricing available for this product.</p>`;
  }

  // Alternatives
  if (hasAlternatives) {
    html += `<h3 class="detail__section-title">Supermarket alternatives</h3>`;
    html += `<div class="alt-grid">`;

    data.alternatives.forEach((alt) => {
      html += `
        <button class="alt-card" onclick="openProduct('${esc(alt.code)}', '${esc(alt.slug)}')">
          <img class="alt-card__img" src="${esc(alt.imageUrl)}" alt="" loading="lazy"
               onerror="this.style.display='none'">
          <div class="alt-card__info">
            <span class="alt-card__store alt-card__store--${storeClass(alt.store)}">${esc(alt.store)}</span>
            <span class="alt-card__name">${esc(alt.name)}</span>
            <span class="alt-card__price">£${alt.price.toFixed(2)}</span>
            ${alt.pricePerUnit ? `<span class="alt-card__unit">£${alt.pricePerUnit.toFixed(2)} ${esc(alt.unit || "")}</span>` : ""}
          </div>
        </button>
      `;
    });

    html += `</div>`;
  }

  // Trolley link
  const trolleyUrl = listing?.productUrl || `https://www.trolley.co.uk/product/${data.slug || "_"}/${code}`;
  html += `<a class="detail__trolley-link" href="${esc(trolleyUrl)}" target="_blank" rel="noopener">View full details on Trolley.co.uk →</a>`;

  detailContent.innerHTML = html;
}

// ─── View Management ─────────────────────────────────────────────
function showView(view, errorMsg) {
  loading.hidden = true;
  listingSection.hidden = true;
  detailSection.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = true;

  switch (view) {
    case "loading":  loading.hidden = false; break;
    case "listing":  listingSection.hidden = false; break;
    case "detail":   detailSection.hidden = false; break;
    case "empty":    emptyState.hidden = false; break;
    case "error":
      errorState.hidden = false;
      errorText.textContent = errorMsg || "Something went wrong.";
      break;
  }
}

// ─── Utils ───────────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function storeClass(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("tesco")) return "tesco";
  if (n.includes("sainsbury")) return "sainsburys";
  if (n.includes("aldi")) return "aldi";
  if (n.includes("asda")) return "asda";
  if (n.includes("morrisons")) return "morrisons";
  if (n.includes("waitrose")) return "waitrose";
  if (n.includes("ocado")) return "ocado";
  if (n.includes("co-op")) return "coop";
  return "other";
}
