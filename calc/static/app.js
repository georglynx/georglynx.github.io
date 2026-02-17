/**
 * Cozzie Livs Calc — Frontend
 *
 * Calls the Netlify Function at /api/search and renders results.
 */

// ─── DOM Elements ────────────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const resultsSummary = document.getElementById('resultsSummary');
const cheapestSection = document.getElementById('cheapestSection');
const cheapestGrid = document.getElementById('cheapestGrid');
const productGrid = document.getElementById('productGrid');
const emptyState = document.getElementById('emptyState');
const errorState = document.getElementById('errorState');
const errorText = document.getElementById('errorText');
const storeTabs = document.getElementById('storeTabs');

let currentResults = null;
let activeStore = 'tesco';

// ─── Event Listeners ─────────────────────────────────────────────
searchBtn.addEventListener('click', () => doSearch());
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

document.querySelectorAll('.hint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        searchInput.value = chip.dataset.query;
        doSearch();
    });
});

storeTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.store-tab');
    if (!tab) return;
    activeStore = tab.dataset.store;
    updateActiveTabs();
    renderStoreProducts();
});

// ─── Search ──────────────────────────────────────────────────────
async function doSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    showLoading();

    try {
        // This hits /api/search, which netlify.toml redirects to /.netlify/functions/search
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&max_results=8`);

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        currentResults = data;

        if (data.totalResults === 0) {
            showEmpty();
            return;
        }

        renderResults(data);
        showResults();

    } catch (err) {
        console.error('Search failed:', err);
        showError(err.message);
    }
}

// ─── Render Results ──────────────────────────────────────────────
function renderResults(data) {
    const storeCount = data.stores.filter(s => (s.products || []).length > 0).length;
    resultsSummary.innerHTML = `
        Found <strong>${data.totalResults}</strong> results for
        "<strong>${escapeHtml(data.query)}</strong>"
        across <strong>${storeCount}</strong> store${storeCount !== 1 ? 's' : ''}
    `;

    // Cheapest picks
    if (data.cheapest && data.cheapest.length > 0) {
        cheapestGrid.innerHTML = data.cheapest
            .slice(0, 3)
            .map((p, i) => renderProductCard(p, i === 0))
            .join('');
        cheapestSection.hidden = false;
    } else {
        cheapestSection.hidden = true;
    }

    // Tab counts
    for (const sr of data.stores) {
        const el = document.getElementById(`count${capitalize(sr.store)}`);
        if (el) el.textContent = (sr.products || []).length;
    }

    renderStoreProducts();
}

function renderStoreProducts() {
    if (!currentResults) return;

    const storeData = currentResults.stores.find(s => s.store === activeStore);

    if (!storeData) {
        productGrid.innerHTML = '<div class="store-error">No data available for this store.</div>';
        return;
    }

    if (storeData.error) {
        productGrid.innerHTML = `<div class="store-error">⚠️ Could not reach ${getStoreName(activeStore)}: ${escapeHtml(storeData.error)}</div>`;
        return;
    }

    if (!storeData.products || storeData.products.length === 0) {
        productGrid.innerHTML = `<div class="store-error">No products found at ${getStoreName(activeStore)}.</div>`;
        return;
    }

    const globalCheapest = currentResults.cheapest?.[0]?.bestPrice ?? Infinity;

    productGrid.innerHTML = storeData.products
        .map(p => renderProductCard(p, p.bestPrice === globalCheapest && p.bestPrice > 0))
        .join('');
}

// ─── Product Card ────────────────────────────────────────────────
function renderProductCard(product, isCheapest = false) {
    const store = product.store;
    const hasLoyalty = product.loyaltyPrice != null && product.loyaltyPrice < product.regularPrice;
    const displayPrice = hasLoyalty ? product.loyaltyPrice : product.regularPrice;

    const storeEmoji = { tesco: '🔵', sainsburys: '🟠', aldi: '🔷' }[store] || '🛒';

    // Loyalty badge
    let loyaltyBadge = '';
    if (hasLoyalty) {
        if (store === 'tesco') {
            loyaltyBadge = '<span class="product-card__loyalty-badge product-card__loyalty-badge--clubcard">Clubcard</span>';
        } else if (store === 'sainsburys') {
            loyaltyBadge = '<span class="product-card__loyalty-badge product-card__loyalty-badge--nectar">Nectar</span>';
        }
    }

    // Image
    const imageHtml = product.imageUrl
        ? `<img class="product-card__img" src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'product-card__img--placeholder\\'>${storeEmoji}</div>'">`
        : `<div class="product-card__img--placeholder">${storeEmoji}</div>`;

    // Name
    const nameHtml = product.productUrl
        ? `<a href="${escapeHtml(product.productUrl)}" target="_blank" rel="noopener">${escapeHtml(product.name)}</a>`
        : escapeHtml(product.name);

    // Price
    let priceHtml;
    if (hasLoyalty) {
        priceHtml = `
            <span class="product-card__price product-card__price--loyalty">£${displayPrice.toFixed(2)}</span>
            ${loyaltyBadge}
            <span class="product-card__price--regular-struck">£${product.regularPrice.toFixed(2)}</span>
        `;
    } else {
        priceHtml = `<span class="product-card__price">£${displayPrice.toFixed(2)}</span>`;
    }

    // Unit price
    const unitHtml = product.pricePerUnit && product.unit
        ? `<div class="product-card__unit">£${product.pricePerUnit.toFixed(2)} ${escapeHtml(product.unit)}</div>`
        : '';

    // Promotion
    const promoHtml = product.promotion
        ? `<div class="product-card__promo">${escapeHtml(product.promotion)}</div>`
        : '';

    return `
        <div class="product-card ${isCheapest ? 'product-card--cheapest' : ''}">
            ${imageHtml}
            <div class="product-card__info">
                <div class="product-card__store product-card__store--${store}">
                    ${escapeHtml(getStoreName(store))}
                </div>
                <div class="product-card__name">${nameHtml}</div>
                <div class="product-card__prices">${priceHtml}</div>
                ${unitHtml}
                ${promoHtml}
            </div>
        </div>
    `;
}

// ─── UI State ────────────────────────────────────────────────────
function showLoading()  { loading.hidden = false; results.hidden = true; emptyState.hidden = true; errorState.hidden = true; }
function showResults()  { loading.hidden = true; results.hidden = false; emptyState.hidden = true; errorState.hidden = true; }
function showEmpty()    { loading.hidden = true; results.hidden = true; emptyState.hidden = false; errorState.hidden = true; }
function showError(msg) { loading.hidden = true; results.hidden = true; emptyState.hidden = true; errorState.hidden = false; errorText.textContent = msg || 'Something went wrong.'; }

function updateActiveTabs() {
    document.querySelectorAll('.store-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.store === activeStore);
    });
}

// ─── Utils ───────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

function getStoreName(store) {
    return { tesco: 'Tesco', sainsburys: "Sainsbury's", aldi: 'Aldi' }[store] || store;
}
