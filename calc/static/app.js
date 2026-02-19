/**
 * Cozzie Livs Calc — Frontend
 *
 * Two modes:
 *   SEARCH: Type a product → optional clarification → per-store compare view
 *           (loyalty prices enriched in background via 2 detail calls)
 *   BASKET: Ingredient list → staggered search → loyalty second pass → totals
 */

// ─── DOM ─────────────────────────────────────────────────────────
const $ = (sel) => document.getElementById(sel);

const searchInput          = $("searchInput");
const searchBtn            = $("searchBtn");
const loading              = $("loading");
const clarificationSection = $("clarificationSection");
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
let currentMode         = "search";
let basketSearching     = false;
let pendingVariant      = "";
let currentCompareByStore = {};   // live reference for loyalty enrichment
const cache = { searches: {}, products: {} };

let basketSelections = {};
let basketData       = {};

// ─── Known stores ────────────────────────────────────────────────
const STORE_NAMES = [
  "Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons",
  "Waitrose", "Ocado", "Co-op", "Iceland", "M&S",
];
const LOYALTY_STORES = ["Tesco", "Sainsbury's"]; // only these have schemes

// ─── Clarification prompts ────────────────────────────────────────
const CLARIFICATIONS = {
  "olive oil":  ["Extra Virgin", "Virgin", "Light", "Any"],
  "eggs":       ["Free Range", "Organic", "Standard", "Any"],
  "milk":       ["Full Fat", "Semi-Skimmed", "Skimmed", "Any"],
  "butter":     ["Salted", "Unsalted", "Any"],
  "bread":      ["White", "Wholemeal", "Sourdough", "Any"],
  "chicken":    ["Breast", "Thighs", "Whole", "Mince", "Any"],
  "mince":      ["Beef", "Pork", "Turkey", "Lamb", "Any"],
  "beef":       ["Mince", "Steak", "Diced", "Any"],
  "cheese":     ["Cheddar", "Mozzarella", "Parmesan", "Brie", "Any"],
  "pasta":      ["Spaghetti", "Penne", "Fusilli", "Rigatoni", "Any"],
  "rice":       ["Basmati", "Long Grain", "Brown", "Any"],
  "yoghurt":    ["Natural", "Greek", "Flavoured", "Any"],
  "yogurt":     ["Natural", "Greek", "Flavoured", "Any"],
  "coffee":     ["Ground", "Instant", "Beans", "Any"],
  "tea":        ["English Breakfast", "Green", "Herbal", "Any"],
  "juice":      ["Orange", "Apple", "Cranberry", "Any"],
  "oil":        ["Olive", "Vegetable", "Sunflower", "Coconut", "Any"],
};

function getClarification(query) {
  const q = query.toLowerCase().trim();
  return CLARIFICATIONS[q] ? { key: q, variants: CLARIFICATIONS[q] } : null;
}

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
  chip.addEventListener("click", () => { searchInput.value = chip.dataset.query; doSearch(); });
});


// ═════════════════════════════════════════════════════════════════
// SEARCH MODE
// ═════════════════════════════════════════════════════════════════

async function doSearch(variantOverride) {
  const query = searchInput.value.trim();
  if (!query) return;

  if (!variantOverride) {
    const clar = getClarification(query);
    if (clar) { showClarification(query, clar.variants); return; }
  }

  const variant = variantOverride === "Any" ? "" : (variantOverride || "");
  const effectiveQuery = variant ? `${variant} ${query}` : query;
  pendingVariant = variant;

  showSearchView("loading");

  if (cache.searches[effectiveQuery]) {
    const byStore = buildByStore(cache.searches[effectiveQuery].products, query);
    currentCompareByStore = byStore;
    renderCompareTable();
    showSearchView("compare");
    enrichCompareWithLoyalty(); // background
    return;
  }

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(effectiveQuery)}`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    cache.searches[effectiveQuery] = data;

    if (!data.products || data.products.length === 0) { showSearchView("empty"); return; }

    console.log('[debug] products from API:', data.products.length);
    console.log('[debug] sample:', data.products.slice(0,5).map(p => ({ name: p.name, store: p.store, slug: p.slug, price: p.price })));

    const byStore = buildByStore(data.products, query);
    console.log('[debug] byStore keys:', Object.keys(byStore));
    currentCompareByStore = byStore;
    renderCompareTable();
    showSearchView("compare");
    enrichCompareWithLoyalty(); // background — updates table in place
  } catch (err) {
    showSearchView("error", err.message);
  }
}

function showClarification(query, variants) {
  showSearchView("clarification");
  $("clarLabel").textContent = `What kind of ${query}?`;
  $("clarChips").innerHTML = variants.map((v) =>
    `<button class="clar-chip" onclick="doSearch('${esc(v)}')">${esc(v)}</button>`
  ).join("");
}

/** Build the store→product map from listing products */
function buildByStore(products, query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const byStore = {};
  for (const p of products) {
    const store = p.store || detectStore(p.name, p.slug);
    if (!store || p.price <= 0) continue;
    if (words.length > 0) {
      const nl = (p.name || "").toLowerCase();
      if (!words.every((w) => nl.includes(w))) continue;
    }
    const unitCost = p.pricePerUnit || p.price;
    if (!byStore[store] || unitCost < (byStore[store].pricePerUnit || byStore[store].price)) {
      byStore[store] = { ...p, store };
    }
  }
  return byStore;
}

/** Render (or re-render) the compare table from currentCompareByStore */
function renderCompareTable() {
  const byStore = currentCompareByStore;

  // Sort by effective best price (loyalty if enriched, else listing price)
  const sorted = Object.entries(byStore).sort((a, b) => {
    const aP = effectiveUnitCost(a[1]);
    const bP = effectiveUnitCost(b[1]);
    return aP - bP;
  });

  const variantNote = pendingVariant
    ? `<span class="cmp-variant">Showing: ${esc(pendingVariant)} ${esc(searchInput.value.trim())}</span>` : "";
  const changeLink = pendingVariant
    ? `<button class="cmp-change-btn" onclick="showClarification(searchInput.value.trim(), getClarification(searchInput.value.trim())?.variants || [])">Change variant</button>` : "";

  let html = `
    <div class="cmp-header">
      <div class="cmp-header__left">
        ${variantNote}
        <p class="cmp-header__sub">${sorted.length} store${sorted.length !== 1 ? "s" : ""} found &mdash; sorted cheapest first</p>
      </div>
      ${changeLink}
    </div>
    <div class="cmp-table">
  `;

  if (sorted.length === 0) {
    html += `<p class="cmp-empty">No supermarket own-brand products found. Try a more specific search (e.g. "cheddar cheese" instead of "cheese"), or check <a href="https://www.trolley.co.uk/search/?q=${encodeURIComponent(searchInput.value.trim())}" target="_blank" rel="noopener">Trolley.co.uk</a> directly.</p>`;
  } else {
    sorted.forEach(([store, p], i) => {
      const isCheapest = i === 0;
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
            ${p.pricePerUnit ? `<span class="cmp-unit">£${p.pricePerUnit.toFixed(2)} ${esc(p.unit || "")}</span>` : ""}
          </span>
          ${isCheapest ? '<span class="cmp-badge">CHEAPEST</span>' : '<span class="cmp-arrow">→</span>'}
        </a>
      `;
    });
  }

  html += `</div>`;
  compareSection.innerHTML = html;
}

/** Fetch loyalty prices for Tesco + Sainsbury's in parallel, then re-render */
async function enrichCompareWithLoyalty() {
  const byStore = currentCompareByStore; // capture ref
  const toFetch = LOYALTY_STORES.filter(s => byStore[s]);
  if (toFetch.length === 0) return;

  await Promise.all(toFetch.map(async (store) => {
    const p = byStore[store];
    const loyalty = await fetchLoyaltyInfo(p);
    if (loyalty && byStore === currentCompareByStore) {
      byStore[store] = { ...byStore[store], ...loyalty };
    }
  }));

  if (byStore === currentCompareByStore) renderCompareTable();
}

function showSearchView(view, errorMsg) {
  loading.hidden = true;
  clarificationSection.hidden = true;
  compareSection.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = true;
  switch (view) {
    case "loading":       loading.hidden = false; break;
    case "clarification": clarificationSection.hidden = false; break;
    case "compare":       compareSection.hidden = false; break;
    case "empty":         emptyState.hidden = false; break;
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
  basketData = {};

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
    // ── Phase 1: search each ingredient ──────────────────────────
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      const bpItem = $(`bp-${i}`);

      if (bpItem) {
        bpItem.querySelector(".bp-item__icon").innerHTML = '<div class="loading__spinner loading__spinner--sm"></div>';
        bpItem.querySelector(".bp-item__icon").className = "bp-item__icon bp-item__icon--active";
      }
      basketProgressMsg.textContent = FUN_MESSAGES[i % FUN_MESSAGES.length].replace("{0}", ing);

      let data;
      if (cache.searches[ing]) {
        data = cache.searches[ing];
      } else {
        if (i > 0) await delay(2500);
        const res = await fetch(`/api/search?q=${encodeURIComponent(ing)}`);
        if (!res.ok) throw new Error(`Failed to search for "${ing}"`);
        data = await res.json();
        cache.searches[ing] = data;
      }

      const storeGroups = scoreAndFilter(data.products || [], ing, stores);
      basketData[ing] = storeGroups;
      basketSelections[ing] = {};
      for (const [store, prods] of Object.entries(storeGroups)) {
        if (prods.length > 0) basketSelections[ing][store] = { ...prods[0] };
      }

      if (bpItem) {
        const hasResults = Object.keys(storeGroups).length > 0;
        bpItem.querySelector(".bp-item__icon").innerHTML = hasResults ? "&#x2705;" : "&#x274C;";
        bpItem.querySelector(".bp-item__icon").className = `bp-item__icon bp-item__icon--${hasResults ? "done" : "fail"}`;
      }
    }

    // ── Phase 2: enrich Tesco + Sainsbury's with loyalty prices ──
    const loyaltyStoresSelected = LOYALTY_STORES.filter(s => stores.includes(s));
    if (loyaltyStoresSelected.length > 0) {
      basketProgressMsg.textContent = "Checking Clubcard & Nectar prices...";
      basketProgress.hidden = false;

      for (let i = 0; i < ingredients.length; i++) {
        const ing = ingredients[i];
        if (i > 0) await delay(1000);

        // Fetch both loyalty stores in parallel for this ingredient
        await Promise.all(loyaltyStoresSelected.map(async (store) => {
          const product = basketSelections[ing]?.[store];
          if (!product) return;
          const loyalty = await fetchLoyaltyInfo(product);
          if (loyalty) {
            basketSelections[ing][store] = { ...basketSelections[ing][store], ...loyalty };
          }
        }));
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

function scoreAndFilter(products, query, selectedStores) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  const filtered = products.filter((p) => {
    const store = p.store || detectStore(p.name, p.slug);
    if (!store || !selectedStores.includes(store)) return false;
    if (p.price <= 0) return false;
    const nl = (p.name || "").toLowerCase();
    return words.every((w) => nl.includes(w));
  });

  filtered.forEach((p) => { if (!p.store) p.store = detectStore(p.name, p.slug) || ""; });

  filtered.sort((a, b) => (a.pricePerUnit || a.price) - (b.pricePerUnit || b.price));

  const groups = {};
  for (const p of filtered) {
    if (!groups[p.store]) groups[p.store] = [];
    if (groups[p.store].length < 3) groups[p.store].push(p);
  }
  return groups;
}

function renderBasketResults(ingredients, stores) {
  const storeTotals  = {};
  const storeMissing = {};
  for (const store of stores) { storeTotals[store] = 0; storeMissing[store] = []; }

  for (const ing of ingredients) {
    const selections = basketSelections[ing] || {};
    for (const store of stores) {
      if (selections[store]) {
        // Use loyalty price if available (the real cost)
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
    const groups    = basketData[ing] || {};
    const selections = basketSelections[ing] || {};
    const hasAny    = Object.keys(selections).length > 0;

    ingHtml += `<div class="bi-row" id="bi-${esc(ing).replace(/\s+/g, "-")}">`;
    ingHtml += `<div class="bi-row__header">${esc(ing)}</div>`;

    if (!hasAny) {
      ingHtml += `<div class="bi-row__empty">No matches found</div>`;
    } else {
      ingHtml += `<div class="bi-row__stores">`;

      const storesWithProduct = Object.entries(selections)
        .sort((a, b) => bestPrice(a[1]) - bestPrice(b[1]));

      storesWithProduct.forEach(([store, product], idx) => {
        const isCheap   = idx === 0;
        const hasAlts   = (groups[store] || []).length > 1;
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
            ${hasAlts ? `<button class="bi-store__change" onclick="showAlternatives('${esc(ing)}', '${esc(store)}')">change</button>` : ""}
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

    ingHtml += `<div class="bi-alts" id="alts-${esc(ing).replace(/\s+/g, "-")}" hidden></div></div>`;
  }

  ingHtml += `<p class="basket-loyalty-note">* Tesco &amp; Sainsbury's totals include Clubcard/Nectar prices where available.</p>`;
  basketIngredients.innerHTML = ingHtml;
}

function showAlternatives(ingredient, store) {
  const altId = `alts-${ingredient.replace(/\s+/g, "-")}`;
  const altContainer = $(altId);
  if (!altContainer) return;
  if (!altContainer.hidden) { altContainer.hidden = true; altContainer.innerHTML = ""; return; }

  const alternatives = (basketData[ingredient] || {})[store] || [];
  const currentSelection = (basketSelections[ingredient] || {})[store];

  let html = `<div class="bi-alts__label">Alternatives at ${esc(store)}:</div><div class="bi-alts__list">`;
  alternatives.forEach((p) => {
    const isSelected = currentSelection && currentSelection.code === p.code;
    html += `
      <button class="bi-alt-card ${isSelected ? "bi-alt-card--selected" : ""}"
              onclick="selectAlternative('${esc(ingredient)}', '${esc(store)}', '${esc(p.code)}')">
        <img class="bi-alt-card__img" src="${esc(p.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">
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

function selectAlternative(ingredient, store, code) {
  const product = ((basketData[ingredient] || {})[store] || []).find((p) => p.code === code);
  if (!product) return;
  basketSelections[ingredient][store] = { ...product };
  renderBasketResults(Object.keys(basketData), getSelectedStores());
}

function resetBasket() {
  basketSelections = {};
  basketData = {};
  basketResults.hidden = true;
  basketProgress.hidden = true;
  basketError.hidden = true;
  $("basketInput").hidden = false;
}


// ═════════════════════════════════════════════════════════════════
// LOYALTY — shared helpers
// ═════════════════════════════════════════════════════════════════

/**
 * Fetch loyalty + promotion + sale info for a product.
 * Uses the product detail endpoint and returns enrichment fields.
 * Results cached in cache.products.
 */
async function fetchLoyaltyInfo(product) {
  if (!product?.code) return null;

  let detail = cache.products[product.code];
  if (!detail) {
    try {
      const res = await fetch(
        `/api/search?product=${encodeURIComponent(product.code)}&slug=${encodeURIComponent(product.slug || "")}`
      );
      if (!res.ok) return null;
      detail = await res.json();
      cache.products[product.code] = detail;
    } catch {
      return null;
    }
  }

  // Find the matching store entry in storePrices
  const storeEntry = (detail.storePrices || []).find(
    (sp) => sp.store.toLowerCase() === (product.store || "").toLowerCase()
  );
  if (!storeEntry) return null;

  const usualPrice = detail.priceHistory?.usual;
  const isOnSale   = usualPrice && storeEntry.price < usualPrice;

  return {
    loyaltyPrice:  storeEntry.loyaltyPrice  || null,
    loyaltyScheme: storeEntry.loyaltyScheme || null,
    promotion:     storeEntry.promotion     || null,
    onSale:        isOnSale || false,
    usualPrice:    usualPrice || null,
  };
}

/** The price to use for ranking — loyalty if cheaper, else listing price */
function bestPrice(p) {
  return (p.loyaltyPrice && p.loyaltyPrice < p.price) ? p.loyaltyPrice : p.price;
}

/** Effective unit cost for compare table sorting */
function effectiveUnitCost(p) {
  const bp = bestPrice(p);
  if (p.pricePerUnit && p.price > 0) {
    // Scale per-unit price by loyalty ratio
    return p.pricePerUnit * (bp / p.price);
  }
  return bp;
}


// ═════════════════════════════════════════════════════════════════
// UTILS
// ═════════════════════════════════════════════════════════════════

function detectStore(name, slug) {
  if (name) {
    for (const s of STORE_NAMES) {
      if (name.startsWith(s) || name.toLowerCase().startsWith(s.toLowerCase())) return s;
    }
  }
  if (slug) {
    const sl = slug.toLowerCase();
    if (sl.startsWith("tesco"))      return "Tesco";
    if (sl.startsWith("sainsburys")) return "Sainsbury's";
    if (sl.startsWith("aldi"))       return "Aldi";
    if (sl.startsWith("asda"))       return "Asda";
    if (sl.startsWith("morrisons"))  return "Morrisons";
    if (sl.startsWith("waitrose"))   return "Waitrose";
    if (sl.startsWith("ocado"))      return "Ocado";
    if (sl.startsWith("coop") || sl.startsWith("co-op")) return "Co-op";
    if (sl.startsWith("iceland"))    return "Iceland";
  }
  return "";
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
