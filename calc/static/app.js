/**
 * Cozzie Livs Calc — Frontend
 *
 * Two modes:
 *   SEARCH: Single product search → listing → per-store detail
 *   BASKET: Ingredient list → staggered search → per-store basket totals
 *
 * Client-side cache prevents repeat requests for the same query/product.
 */

// ─── DOM ─────────────────────────────────────────────────────────
const $ = (sel) => document.getElementById(sel);

// Search mode
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

// Basket mode
const basketTextarea    = $("basketTextarea");
const basketProgress    = $("basketProgress");
const basketProgressMsg = $("basketProgressMsg");
const basketProgressList = $("basketProgressList");
const basketResults     = $("basketResults");
const basketSummary     = $("basketSummary");
const basketIngredients = $("basketIngredients");
const basketError       = $("basketError");
const basketErrorText   = $("basketErrorText");

// ─── State ───────────────────────────────────────────────────────
let lastResults = null;
let currentMode = "search";
let basketSearching = false;
const cache = { searches: {}, products: {} };

// Basket state: { ingredientName: { store: product, ... } }
let basketSelections = {};
// All basket data: { ingredientName: { storeGroups: { store: [products] }, allFiltered: [] } }
let basketData = {};

// ─── Mode Toggle ─────────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  $("searchMode").hidden = mode !== "search";
  $("basketMode").hidden = mode !== "basket";

  document.querySelectorAll(".mode-toggle__btn").forEach((btn) => {
    btn.classList.toggle("mode-toggle__btn--active", btn.dataset.mode === mode);
  });
}

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

// ═════════════════════════════════════════════════════════════════
// SEARCH MODE
// ═════════════════════════════════════════════════════════════════

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

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
    cache.searches[query] = data;
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

async function openProduct(code, slug) {
  showView("detail");
  detailContent.innerHTML = "";
  detailLoading.hidden = false;

  if (cache.products[code]) {
    renderDetail(cache.products[code], code);
    detailLoading.hidden = true;
    return;
  }

  try {
    const res = await fetch(`/api/search?product=${encodeURIComponent(code)}&slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    cache.products[code] = data;
    renderDetail(data, code);
  } catch (err) {
    detailContent.innerHTML = `<div class="error-state"><p class="error-state__text">${esc(err.message)}</p></div>`;
  } finally {
    detailLoading.hidden = true;
  }
}

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

function renderDetail(data, code) {
  const listing = lastResults?.products?.find((p) => p.code === code);
  const hasStorePrices = data.storePrices && data.storePrices.length > 0;
  const hasAlternatives = data.alternatives && data.alternatives.length > 0;

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

  if (hasStorePrices) {
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

  const trolleyUrl = listing?.productUrl || `https://www.trolley.co.uk/product/${data.slug || "_"}/${code}`;
  html += `<a class="detail__trolley-link" href="${esc(trolleyUrl)}" target="_blank" rel="noopener">View full details on Trolley.co.uk &rarr;</a>`;

  detailContent.innerHTML = html;
}

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


// ═════════════════════════════════════════════════════════════════
// BASKET MODE
// ═════════════════════════════════════════════════════════════════

const FUN_MESSAGES = [
  "Checking the {0} aisle...",
  "Scanning prices for {0}...",
  "Hunting for deals on {0}...",
  "Comparing {0} across stores...",
  "Finding the cheapest {0}...",
  "Rummaging through shelves for {0}...",
  "Eyeing up the {0} section...",
];

function getSelectedStores() {
  return [...document.querySelectorAll(".store-check input:checked")].map((cb) => cb.value);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Basket: Main search loop ────────────────────────────────────
async function doBasketSearch() {
  const text = basketTextarea.value.trim();
  if (!text) return;
  if (basketSearching) return;

  const ingredients = text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  if (ingredients.length === 0) return;

  const stores = getSelectedStores();
  if (stores.length === 0) {
    alert("Please select at least one store.");
    return;
  }

  basketSearching = true;
  basketSelections = {};
  basketData = {};

  // Show progress, hide other basket views
  $("basketInput").hidden = true;
  basketProgress.hidden = false;
  basketResults.hidden = true;
  basketError.hidden = true;

  // Build progress list
  basketProgressList.innerHTML = ingredients.map((ing, i) => `
    <div class="bp-item" id="bp-${i}">
      <span class="bp-item__icon bp-item__icon--pending">&#x23F3;</span>
      <span class="bp-item__name">${esc(ing)}</span>
    </div>
  `).join("");

  try {
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];

      // Update progress UI
      const bpItem = $(`bp-${i}`);
      if (bpItem) {
        bpItem.querySelector(".bp-item__icon").innerHTML = '<div class="loading__spinner loading__spinner--sm"></div>';
        bpItem.querySelector(".bp-item__icon").className = "bp-item__icon bp-item__icon--active";
      }

      // Fun message
      const msg = FUN_MESSAGES[i % FUN_MESSAGES.length].replace("{0}", ing);
      basketProgressMsg.textContent = msg;

      // Check cache
      let data;
      if (cache.searches[ing]) {
        data = cache.searches[ing];
      } else {
        // Delay before non-cached requests (except first)
        if (i > 0) await delay(2500);

        const res = await fetch(`/api/search?q=${encodeURIComponent(ing)}&max_results=15`);
        if (!res.ok) throw new Error(`Failed to search for "${ing}"`);
        data = await res.json();
        cache.searches[ing] = data;
      }

      // Score, filter, group
      const storeGroups = scoreAndFilter(data.products || [], ing, stores);
      basketData[ing] = storeGroups;

      // Auto-select cheapest per store
      basketSelections[ing] = {};
      for (const [store, products] of Object.entries(storeGroups)) {
        if (products.length > 0) {
          basketSelections[ing][store] = products[0]; // already sorted cheapest first
        }
      }

      // Mark done
      if (bpItem) {
        const hasResults = Object.keys(storeGroups).length > 0;
        bpItem.querySelector(".bp-item__icon").innerHTML = hasResults ? "&#x2705;" : "&#x274C;";
        bpItem.querySelector(".bp-item__icon").className = `bp-item__icon bp-item__icon--${hasResults ? "done" : "fail"}`;
      }
    }

    // Show results
    basketProgress.hidden = true;
    basketResults.hidden = false;
    renderBasketResults(ingredients, stores);

  } catch (err) {
    basketProgress.hidden = true;
    basketError.hidden = false;
    basketErrorText.textContent = err.message || "Something went wrong.";
  } finally {
    basketSearching = false;
  }
}

// ─── Basket: Score and filter products ───────────────────────────
function scoreAndFilter(products, query, selectedStores) {
  // Tokenize query
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  // Filter by store + name match
  const filtered = products.filter((p) => {
    if (!p.store || !selectedStores.includes(p.store)) return false;
    if (p.price <= 0) return false;
    const nameLower = (p.name || "").toLowerCase();
    return words.every((w) => nameLower.includes(w));
  });

  // Sort by per-unit price (or raw price fallback)
  filtered.sort((a, b) => {
    const aUnit = a.pricePerUnit || a.price;
    const bUnit = b.pricePerUnit || b.price;
    return aUnit - bUnit;
  });

  // Group by store, top 3 per store
  const groups = {};
  for (const p of filtered) {
    if (!groups[p.store]) groups[p.store] = [];
    if (groups[p.store].length < 3) {
      groups[p.store].push(p);
    }
  }

  return groups;
}

// ─── Basket: Render results ──────────────────────────────────────
function renderBasketResults(ingredients, stores) {
  // Calculate totals per store
  const storeTotals = {};
  const storeMissing = {};

  for (const store of stores) {
    storeTotals[store] = 0;
    storeMissing[store] = [];
  }

  for (const ing of ingredients) {
    const selections = basketSelections[ing] || {};
    for (const store of stores) {
      if (selections[store]) {
        storeTotals[store] += selections[store].price;
      } else {
        storeMissing[store].push(ing);
      }
    }
  }

  // Sort stores by total (cheapest first), but put stores with missing items last
  const sortedStores = [...stores].sort((a, b) => {
    const aMiss = storeMissing[a].length;
    const bMiss = storeMissing[b].length;
    if (aMiss !== bMiss) return aMiss - bMiss; // fewer missing first
    return storeTotals[a] - storeTotals[b];
  });

  // Render summary
  let summaryHtml = '<h3 class="basket-summary__title">Basket total by store</h3>';
  summaryHtml += '<div class="basket-summary__cards">';

  sortedStores.forEach((store, i) => {
    const total = storeTotals[store];
    const missing = storeMissing[store];
    const itemCount = ingredients.length - missing.length;
    const isCheapest = i === 0 && missing.length === 0;
    const hasAllItems = missing.length === 0;

    summaryHtml += `
      <div class="bs-card ${isCheapest ? "bs-card--cheapest" : ""} ${!hasAllItems ? "bs-card--incomplete" : ""}">
        <div class="bs-card__header">
          <span class="bs-card__store bs-card__store--${storeClass(store)}">
            ${esc(store)}
            ${isCheapest ? '<span class="bs-card__tag">CHEAPEST</span>' : ""}
          </span>
          <span class="bs-card__total">${total > 0 ? `£${total.toFixed(2)}` : "—"}</span>
        </div>
        <div class="bs-card__meta">
          <span class="bs-card__count">${itemCount}/${ingredients.length} items</span>
          ${missing.length > 0 ? `<span class="bs-card__missing">Missing: ${missing.map(esc).join(", ")}</span>` : ""}
        </div>
      </div>
    `;
  });

  summaryHtml += '</div>';
  basketSummary.innerHTML = summaryHtml;

  // Render per-ingredient breakdown
  let ingHtml = '<h3 class="basket-ing__title">Per ingredient</h3>';

  for (const ing of ingredients) {
    const groups = basketData[ing] || {};
    const selections = basketSelections[ing] || {};
    const hasAny = Object.keys(groups).length > 0;

    ingHtml += `<div class="bi-row" id="bi-${esc(ing).replace(/\s+/g, "-")}">`;
    ingHtml += `<div class="bi-row__header">${esc(ing)}</div>`;

    if (!hasAny) {
      ingHtml += `<div class="bi-row__empty">No matches found</div>`;
    } else {
      ingHtml += `<div class="bi-row__stores">`;

      // Sort stores by selected product price
      const storesWithProduct = Object.entries(selections)
        .sort((a, b) => a[1].price - b[1].price);

      storesWithProduct.forEach(([store, product], idx) => {
        const isCheap = idx === 0;
        const alternatives = groups[store] || [];
        const hasAlts = alternatives.length > 1;

        ingHtml += `
          <div class="bi-store ${isCheap ? "bi-store--cheapest" : ""}">
            <span class="bi-store__name bi-store__name--${storeClass(store)}">${esc(store)}</span>
            <span class="bi-store__price">£${product.price.toFixed(2)}</span>
            <span class="bi-store__product">${esc(product.name)}</span>
            ${product.weight ? `<span class="bi-store__weight">${esc(product.weight)}</span>` : ""}
            ${hasAlts ? `<button class="bi-store__change" onclick="showAlternatives('${esc(ing)}', '${esc(store)}')">change</button>` : ""}
          </div>
        `;
      });

      // Show stores that have no match for this ingredient
      for (const store of stores) {
        if (!selections[store]) {
          ingHtml += `
            <div class="bi-store bi-store--missing">
              <span class="bi-store__name bi-store__name--${storeClass(store)}">${esc(store)}</span>
              <span class="bi-store__price">—</span>
              <span class="bi-store__product">Not found</span>
            </div>
          `;
        }
      }

      ingHtml += `</div>`;
    }

    // Hidden alternatives picker
    ingHtml += `<div class="bi-alts" id="alts-${esc(ing).replace(/\s+/g, "-")}" hidden></div>`;
    ingHtml += `</div>`;
  }

  basketIngredients.innerHTML = ingHtml;
}

// ─── Basket: Show alternatives for a store+ingredient ────────────
function showAlternatives(ingredient, store) {
  const altId = `alts-${ingredient.replace(/\s+/g, "-")}`;
  const altContainer = $(altId);
  if (!altContainer) return;

  // Toggle off if already showing
  if (!altContainer.hidden) {
    altContainer.hidden = true;
    altContainer.innerHTML = "";
    return;
  }

  const alternatives = (basketData[ingredient] || {})[store] || [];
  const currentSelection = (basketSelections[ingredient] || {})[store];

  let html = `<div class="bi-alts__label">Alternatives at ${esc(store)}:</div>`;
  html += `<div class="bi-alts__list">`;

  alternatives.forEach((p) => {
    const isSelected = currentSelection && currentSelection.code === p.code;
    html += `
      <button class="bi-alt-card ${isSelected ? "bi-alt-card--selected" : ""}"
              onclick="selectAlternative('${esc(ingredient)}', '${esc(store)}', '${esc(p.code)}')">
        <img class="bi-alt-card__img" src="${esc(p.imageUrl)}" alt="" loading="lazy"
             onerror="this.style.display='none'">
        <div class="bi-alt-card__info">
          <span class="bi-alt-card__name">${esc(p.name)}</span>
          <span class="bi-alt-card__price">£${p.price.toFixed(2)}</span>
          ${p.weight ? `<span class="bi-alt-card__weight">${esc(p.weight)}</span>` : ""}
          ${p.pricePerUnit ? `<span class="bi-alt-card__unit">£${p.pricePerUnit.toFixed(2)} ${esc(p.unit || "")}</span>` : ""}
        </div>
        ${isSelected ? '<span class="bi-alt-card__check">&#x2713;</span>' : ""}
      </button>
    `;
  });

  html += `</div>`;
  altContainer.innerHTML = html;
  altContainer.hidden = false;
}

// ─── Basket: Select alternative product ──────────────────────────
function selectAlternative(ingredient, store, code) {
  const alternatives = (basketData[ingredient] || {})[store] || [];
  const product = alternatives.find((p) => p.code === code);
  if (!product) return;

  basketSelections[ingredient][store] = product;

  // Re-render
  const stores = getSelectedStores();
  const ingredients = Object.keys(basketData);
  renderBasketResults(ingredients, stores);
}

// ─── Basket: Reset ───────────────────────────────────────────────
function resetBasket() {
  basketSelections = {};
  basketData = {};
  basketResults.hidden = true;
  basketProgress.hidden = true;
  basketError.hidden = true;
  $("basketInput").hidden = false;
}


// ═════════════════════════════════════════════════════════════════
// UTILS
// ═════════════════════════════════════════════════════════════════

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
