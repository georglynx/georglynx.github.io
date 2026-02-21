/**
 * Cozzie Livs Calc — Frontend
 *
 * Two modes:
 *   SEARCH: Type a product → per-store compare view
 *           (listing → first product detail + supermarket alternatives → merge)
 *   BASKET: Ingredient list → staggered search → totals per store
 */

// ─── DOM ─────────────────────────────────────────────────────────
const $ = (sel) => document.getElementById(sel);

const searchInput          = $("searchInput");
const searchBtn            = $("searchBtn");
const loading              = $("loading");
const compareSection       = $("compareSection");
const emptyState           = $("emptyState");
const errorState           = $("errorState");
const errorText            = $("errorText");

const basketTextarea       = $("basketTextarea");
const basketProgress       = $("basketProgress");
const basketProgressMsg    = $("basketProgressMsg");
const basketProgressList   = $("basketProgressList");
const basketResults        = $("basketResults");
const basketSummary        = $("basketSummary");
const basketIngredients    = $("basketIngredients");
const basketError          = $("basketError");
const basketErrorText      = $("basketErrorText");

// ─── State ───────────────────────────────────────────────────────
let currentMode           = "search";
let basketSearching       = false;
let currentCompareByStore = {};
const cache = { searches: {} };

let basketSelections = {};

// ─── Known stores ────────────────────────────────────────────────
const STORE_NAMES = [
  "Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons",
  "Waitrose", "Ocado", "Co-op", "Iceland", "M&S",
];
const LOYALTY_STORES = ["Tesco", "Sainsbury's"];

// ─── Mode Toggle ─────────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  $("searchMode").hidden = mode !== "search";
  $("basketMode").hidden = mode !== "basket";
  document.querySelectorAll(".mode-toggle__btn").forEach((btn) => {
    btn.classList.toggle("mode-toggle__btn--active", btn.dataset.mode === mode);
  });
}

function getSelectedSearchStores() {
  return new Set(
    [...document.querySelectorAll(".search-box__stores input:checked")].map(cb => cb.value)
  );
}

function onStoreFilterChange() {
  // Re-render immediately from cached data — no new network request needed
  if (!compareSection.hidden && Object.keys(currentCompareByStore).length > 0) {
    renderCompareTable(currentIsHomeBrand);
    renderOtherOptions();
  }
}

// ─── Events ──────────────────────────────────────────────────────
searchBtn.addEventListener("click", () => doSearch());
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
document.querySelectorAll(".hint-chip").forEach((chip) => {
  chip.addEventListener("click", () => { searchInput.value = chip.dataset.query; doSearch(); });
});


// ═════════════════════════════════════════════════════════════════
// SEARCH MODE
// ═════════════════════════════════════════════════════════════════

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  showSearchView("loading");

  const cacheKey = `compare:${query}`;
  if (cache.searches[cacheKey]) {
    currentCompareByStore = toByStore(cache.searches[cacheKey].storePrices);
    renderCompareTable();
    showSearchView("compare");
    return;
  }

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&compare=1`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    cache.searches[cacheKey] = data;

    if (!data.storePrices || data.storePrices.length === 0) { showSearchView("empty"); return; }

    currentCompareByStore = toByStore(data.storePrices);
    renderCompareTable();
    showSearchView("compare");
  } catch (err) {
    showSearchView("error", err.message);
  }
}

function toByStore(storePrices) {
  const m = {};
  for (const sp of (storePrices || [])) m[sp.store] = sp;
  return m;
}

/** Render (or re-render) the compare table from currentCompareByStore */
function renderCompareTable() {
  const selectedStores = getSelectedSearchStores();
  const byStore = selectedStores.size > 0
    ? Object.fromEntries(Object.entries(currentCompareByStore).filter(([s]) => selectedStores.has(s)))
    : currentCompareByStore;

  const sorted = Object.entries(byStore).sort((a, b) => {
    const aP = effectiveUnitCost(a[1]);
    const bP = effectiveUnitCost(b[1]);
    return aP - bP;
  });

  const subLabel = `${sorted.length} store${sorted.length !== 1 ? "s" : ""} found &mdash; sorted cheapest first`;

  let html = `
    <div class="cmp-header">
      <p class="cmp-header__sub">${subLabel}</p>
    </div>
    <div class="cmp-table">
  `;

  if (sorted.length === 0) {
    html += `<p class="cmp-empty">No results found. Try a more specific search, or check <a href="https://www.trolley.co.uk/search/?q=${encodeURIComponent(searchInput.value.trim())}" target="_blank" rel="noopener">Trolley.co.uk</a> directly.</p>`;
  } else {
    const minCost = effectiveUnitCost(sorted[0][1]);
    sorted.forEach(([store, p], i) => {
      const isCheapest = effectiveUnitCost(p) <= minCost + 0.001;
      const hasLoyalty = p.loyaltyPrice && p.loyaltyPrice < p.price;

      let priceHtml = `<span class="cmp-price">£${p.price.toFixed(2)}</span>`;
      if (hasLoyalty) {
        priceHtml = `
          <span class="cmp-price cmp-price--struck">£${p.price.toFixed(2)}</span>
          <span class="cmp-loyalty-price">
            £${p.loyaltyPrice.toFixed(2)}
            <span class="cmp-loyalty-badge cmp-loyalty-badge--${(p.loyaltyScheme || "").toLowerCase()}">${esc(p.loyaltyScheme)}</span>
          </span>
        `;
      }

      html += `
        <a class="cmp-row ${isCheapest ? "cmp-row--cheapest" : ""}"
           href="${esc(p.productUrl)}" target="_blank" rel="noopener">
          <span class="cmp-store cmp-store--${storeClass(store)}">${esc(store)}</span>
          <span class="cmp-product">
            <span class="cmp-product__name">${esc(p.name)}</span>
            <span class="cmp-product__meta">
              ${p.weight ? `<span class="cmp-product__weight">${esc(p.weight)}</span>` : ""}
              ${p.onSale ? `<span class="cmp-sale">↓ on sale</span>` : ""}
              ${p.promotion ? `<span class="cmp-promo">${esc(p.promotion)}</span>` : ""}
            </span>
          </span>
          <span class="cmp-prices">
            ${priceHtml}
            ${p.per100g ? `<span class="cmp-unit">£${p.per100g.toFixed(2)}/100g</span>` : (p.pricePerUnit ? `<span class="cmp-unit">£${p.pricePerUnit.toFixed(2)} ${esc(p.unit || "")}</span>` : "")}
          </span>
          ${isCheapest ? '<span class="cmp-badge">CHEAPEST</span>' : '<span class="cmp-arrow">→</span>'}
        </a>
      `;
    });
  }

  html += `</div>`;
  compareSection.innerHTML = html;
}

function showSearchView(view, errorMsg) {
  loading.hidden = true;
  compareSection.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = true;
  switch (view) {
    case "loading": loading.hidden = false; break;
    case "compare": compareSection.hidden = false; break;
    case "empty":   emptyState.hidden = false; break;
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

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function doBasketSearch() {
  const text = basketTextarea.value.trim();
  if (!text || basketSearching) return;

  const ingredients = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (ingredients.length === 0) return;

  const stores = getSelectedStores();
  if (stores.length === 0) { alert("Please select at least one store."); return; }

  basketSearching = true;
  basketSelections = {};

  $("basketInput").hidden = true;
  basketProgress.hidden = false;
  basketResults.hidden = true;
  basketError.hidden = true;

  basketProgressList.innerHTML = ingredients.map((ing, i) => `
    <div class="bp-item" id="bp-${i}">
      <span class="bp-item__icon bp-item__icon--pending">&#x23F3;</span>
      <span class="bp-item__name">${esc(ing)}</span>
    </div>
  `).join("");

  try {
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      const bpItem = $(`bp-${i}`);

      if (bpItem) {
        bpItem.querySelector(".bp-item__icon").innerHTML = '<div class="loading__spinner loading__spinner--sm"></div>';
        bpItem.querySelector(".bp-item__icon").className = "bp-item__icon bp-item__icon--active";
      }
      basketProgressMsg.textContent = FUN_MESSAGES[i % FUN_MESSAGES.length].replace("{0}", ing);

      let data;
      const basketCacheKey = `branded:${ing}`;
      if (cache.searches[basketCacheKey]) {
        data = cache.searches[basketCacheKey];
      } else {
        if (i > 0) await delay(2500);
        const res = await fetch(`/api/search?q=${encodeURIComponent(ing)}&compare=1`);
        if (!res.ok) throw new Error(`Failed to search for "${ing}"`);
        data = await res.json();
        cache.searches[basketCacheKey] = data;
      }

      basketSelections[ing] = {};
      for (const sp of (data.storePrices || [])) {
        if (stores.includes(sp.store)) {
          basketSelections[ing][sp.store] = sp;
        }
      }

      if (bpItem) {
        const hasResults = Object.keys(basketSelections[ing]).length > 0;
        bpItem.querySelector(".bp-item__icon").innerHTML = hasResults ? "&#x2705;" : "&#x274C;";
        bpItem.querySelector(".bp-item__icon").className = `bp-item__icon bp-item__icon--${hasResults ? "done" : "fail"}`;
      }
    }

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

function renderBasketResults(ingredients, stores) {
  const storeTotals  = {};
  const storeMissing = {};
  for (const store of stores) { storeTotals[store] = 0; storeMissing[store] = []; }

  for (const ing of ingredients) {
    const selections = basketSelections[ing] || {};
    for (const store of stores) {
      if (selections[store]) {
        const p = selections[store];
        storeTotals[store] += (p.loyaltyPrice && p.loyaltyPrice < p.price) ? p.loyaltyPrice : p.price;
      } else {
        storeMissing[store].push(ing);
      }
    }
  }

  const sortedStores = [...stores].sort((a, b) => {
    if (storeMissing[a].length !== storeMissing[b].length)
      return storeMissing[a].length - storeMissing[b].length;
    return storeTotals[a] - storeTotals[b];
  });

  // Summary cards
  let summaryHtml = '<h3 class="basket-summary__title">Basket total by store</h3><div class="basket-summary__cards">';
  sortedStores.forEach((store, i) => {
    const total   = storeTotals[store];
    const missing = storeMissing[store];
    const itemCount  = ingredients.length - missing.length;
    const isCheapest = i === 0 && missing.length === 0;
    summaryHtml += `
      <div class="bs-card ${isCheapest ? "bs-card--cheapest" : ""} ${missing.length > 0 ? "bs-card--incomplete" : ""}">
        <div class="bs-card__header">
          <span class="bs-card__store bs-card__store--${storeClass(store)}">
            ${esc(store)}${isCheapest ? ' <span class="bs-card__tag">CHEAPEST</span>' : ""}
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

  // Per-ingredient breakdown
  let ingHtml = '<h3 class="basket-ing__title">Per ingredient</h3>';
  for (const ing of ingredients) {
    const selections = basketSelections[ing] || {};
    const hasAny = Object.keys(selections).length > 0;

    ingHtml += `<div class="bi-row">`;
    ingHtml += `<div class="bi-row__header">${esc(ing)}</div>`;

    if (!hasAny) {
      ingHtml += `<div class="bi-row__empty">No matches found</div>`;
    } else {
      ingHtml += `<div class="bi-row__stores">`;

      const storesWithProduct = Object.entries(selections)
        .sort((a, b) => bestPrice(a[1]) - bestPrice(b[1]));

      storesWithProduct.forEach(([store, product], idx) => {
        const isCheap    = idx === 0;
        const hasLoyalty = product.loyaltyPrice && product.loyaltyPrice < product.price;

        let priceHtml = `£${product.price.toFixed(2)}`;
        let loyaltyHtml = "";
        if (hasLoyalty) {
          priceHtml = `<span class="bi-store__price--struck">£${product.price.toFixed(2)}</span>`;
          loyaltyHtml = `<span class="bi-loyalty-badge bi-loyalty-badge--${(product.loyaltyScheme || "").toLowerCase()}">${esc(product.loyaltyScheme)}</span> £${product.loyaltyPrice.toFixed(2)}`;
        }

        ingHtml += `
          <div class="bi-store ${isCheap ? "bi-store--cheapest" : ""}">
            <span class="bi-store__name bi-store__name--${storeClass(store)}">${esc(store)}</span>
            <span class="bi-store__price">${priceHtml}${loyaltyHtml ? " " + loyaltyHtml : ""}</span>
            <span class="bi-store__product">${esc(product.name)}</span>
            ${product.weight ? `<span class="bi-store__weight">${esc(product.weight)}</span>` : ""}
          </div>
        `;
      });

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

    ingHtml += `</div>`;
  }

  ingHtml += `<p class="basket-loyalty-note">* Tesco &amp; Sainsbury's totals include Clubcard/Nectar prices where available.</p>`;
  basketIngredients.innerHTML = ingHtml;
}

function resetBasket() {
  basketSelections = {};
  basketResults.hidden = true;
  basketProgress.hidden = true;
  basketError.hidden = true;
  $("basketInput").hidden = false;
}


// ═════════════════════════════════════════════════════════════════
// UTILS
// ═════════════════════════════════════════════════════════════════

/** The price to use for ranking — loyalty if cheaper, else listing price */
function bestPrice(p) {
  return (p.loyaltyPrice && p.loyaltyPrice < p.price) ? p.loyaltyPrice : p.price;
}

/** Effective unit cost for compare table sorting — prefers per-100g for fair size comparison */
function effectiveUnitCost(p) {
  // per100g is already loyalty-adjusted by the server — use directly
  if (p.per100g) return p.per100g;
  const bp = bestPrice(p);
  if (p.pricePerUnit && p.price > 0) return p.pricePerUnit * (bp / p.price);
  return bp;
}

function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function storeClass(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("tesco"))     return "tesco";
  if (n.includes("sainsbury")) return "sainsburys";
  if (n.includes("aldi"))      return "aldi";
  if (n.includes("asda"))      return "asda";
  if (n.includes("morrisons")) return "morrisons";
  if (n.includes("waitrose"))  return "waitrose";
  if (n.includes("ocado"))     return "ocado";
  if (n.includes("co-op"))     return "coop";
  return "other";
}
