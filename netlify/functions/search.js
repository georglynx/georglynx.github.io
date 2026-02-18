/**
 * Cozzie Livs Calc — Netlify Function
 *
 * Two modes:
 *   GET /api/search?q=mozzarella     → 1 request to Trolley explore page, returns product list
 *   GET /api/search?product=CODE     → 1 request to Trolley product page, returns per-store detail
 */

const cheerio = require("cheerio");

const TROLLEY = "https://www.trolley.co.uk";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};


// ─── Main Handler ────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};

  // Mode 1: Product detail (single product, per-store pricing)
  if (params.product) {
    return handleProductDetail(params.product, params.slug || "");
  }

  // Mode 2: Search (lightweight listing)
  if (params.q) {
    return handleSearch(params.q.trim(), parseInt(params.max_results || "20", 10));
  }

  return json(400, { error: "Provide ?q=search+term or ?product=CODE&slug=product-slug" });
};


// ═════════════════════════════════════════════════════════════════
// MODE 1: SEARCH — one request, returns product listing
// ═════════════════════════════════════════════════════════════════

async function handleSearch(query, maxResults) {
  if (!query || query.length > 120) {
    return json(400, { error: "Invalid query" });
  }
  maxResults = Math.max(1, Math.min(maxResults, 40));

  console.log(`[search] q="${query}"`);

  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Try several URL variants — Trolley uses plural category slugs
  const urls = [
    `${TROLLEY}/explore/${slug}s`,
    `${TROLLEY}/explore/${slug}`,
    `${TROLLEY}/explore/${slug}es`,
    `${TROLLEY}/search/?q=${encodeURIComponent(query)}`,
  ];

  for (const url of urls) {
    try {
      console.log(`[search] trying ${url}`);
      const html = await fetchPage(url);
      if (!html || html.length < 200) continue;

      const products = parseListingPage(html, maxResults);
      if (products.length > 0) {
        console.log(`[search] found ${products.length} products`);
        return json(200, {
          query,
          products,
          totalResults: products.length,
          source: "trolley.co.uk",
        });
      }
    } catch (err) {
      console.log(`[search] ${url} failed: ${err.message}`);
    }
  }

  return json(200, { query, products: [], totalResults: 0, source: "trolley.co.uk" });
}

/**
 * Parse a Trolley explore/search page into a product listing.
 */
function parseListingPage(html, max) {
  const $ = cheerio.load(html);
  const products = [];
  const seen = new Set();

  const allStoreNames = ["Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons", "Waitrose", "Ocado", "Co-op", "M&S", "Iceland"];
  const storePattern = new RegExp(`(${allStoreNames.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})`, "gi");

  $('a[href*="/product/"]').each((_, el) => {
    if (products.length >= max) return false;

    const $a = $(el);
    const href = $a.attr("href") || "";
    const m = href.match(/\/product\/([^/]+)\/([A-Z0-9]{3,})/);
    if (!m) return;

    const [, slug, code] = m;
    const title = $a.attr("title") || "";
    const text = $a.text().replace(/\s+/g, " ").trim();

    // Name — extract before "Where to buy" section
    let name = title;
    if (!name) {
      const inner = $a.find("strong, b, h3, h4").first().text().trim();
      name = inner || text.split(/Where to buy|£/i)[0].replace(/\d+g\b|\d+ml\b|\d+l\b|\d+kg\b/gi, "").trim();
    }
    if (!name || name.length < 3) return;

    // Weight
    const wm = text.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pt)\b/i);
    const weight = wm ? `${wm[1]}${wm[2]}` : null;

    // Per-unit price (shown once for the product)
    const um = text.match(/£([\d.]+)\s+per\s+([\d]*\s*\w+)/i);

    // Image
    const imgSrc = $a.find("img").attr("src") || "";
    const imageUrl = imgSrc
      ? (imgSrc.startsWith("/") ? `${TROLLEY}${imgSrc}` : imgSrc)
      : `${TROLLEY}/img/product/${code}`;

    // ── Parse "Where to buy" for per-store prices ──
    const wtbIdx = text.search(/Where to buy/i);
    const wtbText = wtbIdx >= 0 ? text.slice(wtbIdx) : "";

    if (wtbText) {
      // Split by store names to get per-store segments
      const parts = wtbText.split(storePattern);
      // parts: [before, storeName, segment, storeName, segment, ...]
      for (let i = 1; i < parts.length - 1; i += 2) {
        if (products.length >= max) break;
        const storeName = parts[i];
        const segment = parts[i + 1] || "";

        // Normalise store name to match known list
        const storeNorm = allStoreNames.find(s => s.toLowerCase() === storeName.toLowerCase()) || storeName;

        const priceMatch = segment.match(/£([\d.]+)/);
        if (!priceMatch) continue;

        const key = `${code}-${storeNorm}`;
        if (seen.has(key)) continue;
        seen.add(key);

        products.push({
          name,
          code,
          slug,
          store: storeNorm,
          price: parseFloat(priceMatch[1]),
          wasPrice: null,
          weight,
          pricePerUnit: um ? parseFloat(um[1]) : null,
          unit: um ? `per ${um[2]}` : null,
          imageUrl,
          productUrl: `${TROLLEY}${href}`,
        });
      }
    } else {
      // Fallback: no "Where to buy" — try to detect a single store from text
      if (seen.has(code)) return;
      seen.add(code);

      let store = "";
      for (const s of allStoreNames) {
        if (text.includes(s)) { store = s; break; }
      }

      const priceMatch = text.match(/£([\d.]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

      products.push({
        name,
        code,
        slug,
        store,
        price,
        wasPrice: null,
        weight,
        pricePerUnit: um ? parseFloat(um[1]) : null,
        unit: um ? `per ${um[2]}` : null,
        imageUrl,
        productUrl: `${TROLLEY}${href}`,
      });
    }
  });

  return products;
}


// ═════════════════════════════════════════════════════════════════
// MODE 2: PRODUCT DETAIL — one request, returns per-store pricing
// ═════════════════════════════════════════════════════════════════

async function handleProductDetail(code, slug) {
  if (!code || !code.match(/^[A-Z0-9]{3,}$/)) {
    return json(400, { error: "Invalid product code" });
  }

  // Build URL — we need the slug for the URL path
  const url = slug
    ? `${TROLLEY}/product/${slug}/${code}`
    : `${TROLLEY}/product/_/${code}`; // Trolley redirects even with wrong slugs

  console.log(`[product] fetching ${url}`);

  try {
    const html = await fetchPage(url);
    if (!html) return json(404, { error: "Product not found" });

    const detail = parseProductPage(html, code);
    return json(200, detail);
  } catch (err) {
    console.error(`[product] error: ${err.message}`);
    return json(500, { error: err.message });
  }
}

/**
 * Parse a Trolley product detail page.
 * Extracts: per-store pricing (inc loyalty), alternatives, reviews.
 */
function parseProductPage(html, code) {
  const $ = cheerio.load(html);
  const fullText = $.text().replace(/\s+/g, " ");

  // Product name
  const name = $("h1").first().text().trim() || "";

  // Weight
  const wm = fullText.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pt)\b/i);
  const weight = wm ? `${wm[1]}${wm[2]}` : null;

  // Image
  const imgSrc = $('img[src*="/img/product/"]').first().attr("src") || "";
  const imageUrl = imgSrc ? (imgSrc.startsWith("/") ? `${TROLLEY}${imgSrc}` : imgSrc) : null;

  // ── "Where To Buy" — main store pricing ──
  const storePrices = [];

  // Strategy 1: Parse the HTML structure directly — find redirect links per store
  const storeEntries = [];
  $('a[href*="redirect.trolley.co.uk"], a[href*="open_store"]').each((_, el) => {
    const $link = $(el);
    // Walk up to find the containing block for this store entry
    const $container = $link.closest("div, li, section, article") || $link.parent();
    const blockText = $container.text().replace(/\s+/g, " ").trim();
    if (blockText) storeEntries.push(blockText);
  });

  // Strategy 2: Fall back to text-based splitting if no redirect links found
  const wtbIdx = fullText.indexOf("Where To Buy");
  const altIdx = fullText.indexOf("Supermarket Alternatives");
  const revIdx = fullText.indexOf("Reviews");
  const sectionEnd = altIdx >= 0 ? altIdx : (revIdx >= 0 ? revIdx : wtbIdx + 2000);
  const wtbText = wtbIdx >= 0 ? fullText.slice(wtbIdx, sectionEnd) : "";

  const knownStores = [
    { name: "Tesco", loyalty: "Clubcard", loyaltyRx: /CLUBCARD\s*(?:PRICE)?\s*£?([\d.]+)/i },
    { name: "Sainsbury's", loyalty: "Nectar", loyaltyRx: /NECTAR\s*(?:PRICE)?\s*£?([\d.]+)/i },
    { name: "Aldi" },
    { name: "Asda" },
    { name: "Morrisons" },
    { name: "Waitrose" },
    { name: "Ocado" },
    { name: "Co-op" },
    { name: "Iceland" },
    { name: "Amazon" },
  ];

  // Split wtbText into per-store segments
  if (wtbText) {
    const storePattern = new RegExp(`(${knownStores.map(s => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})`, "gi");
    const parts = wtbText.split(storePattern);

    // parts alternates: [before, storeName, segment, storeName, segment, ...]
    for (let i = 1; i < parts.length - 1; i += 2) {
      const storeName = parts[i];
      const segment = parts[i + 1] || "";

      // Skip "Unavailable" stores
      if (/unavailable/i.test(segment.slice(0, 60))) continue;

      // Find the store config
      const storeConfig = knownStores.find(s => s.name.toLowerCase() === storeName.toLowerCase());
      if (!storeConfig) continue;

      // Extract all £ prices from this segment (before the next store or VISIT)
      const segmentClean = segment.split(/VISIT/i)[0]; // cut at VISIT link
      const allPrices = [...segmentClean.matchAll(/£([\d.]+)/g)].map(m => parseFloat(m[1]));

      if (allPrices.length === 0) continue;

      // Find per-unit price (the one followed by "per ...")
      let pricePerUnit = null;
      let unit = null;
      const unitMatch = segmentClean.match(/£([\d.]+)\s+per\s+([\d]*\s*[\w]+)/i);
      if (unitMatch) {
        pricePerUnit = parseFloat(unitMatch[1]);
        unit = `per ${unitMatch[2].trim()}`;
      }

      // The main price is the first £ amount (current selling price)
      const price = allPrices[0];

      // Check for loyalty price
      let loyaltyPrice = null;
      let loyaltyScheme = null;
      if (storeConfig.loyaltyRx) {
        const loyaltyMatch = segmentClean.match(storeConfig.loyaltyRx);
        if (loyaltyMatch) {
          loyaltyPrice = parseFloat(loyaltyMatch[1]);
          loyaltyScheme = storeConfig.loyalty;
        }
      }

      // Check for promo text
      const promoMatch = segmentClean.match(/(\d+\s+FOR\s+£[\d.]+|BUY\s+\d+.+?SAVE|ANY\s+\d+\s+FOR\s+£[\d.]+)/i);

      const entry = {
        store: storeConfig.name,
        price,
        pricePerUnit,
        unit,
        loyaltyPrice,
        loyaltyScheme,
        promotion: promoMatch ? promoMatch[1].trim() : null,
      };
      entry.bestPrice = entry.loyaltyPrice && entry.loyaltyPrice < entry.price
        ? entry.loyaltyPrice : entry.price;

      storePrices.push(entry);
    }
  }

  // ── "Supermarket Alternatives" — similar products at other stores ──
  const alternatives = [];
  let inAlts = false;

  $('a[href*="/product/"]').each((_, el) => {
    const $a = $(el);
    const aText = $a.text().replace(/\s+/g, " ").trim();
    const aHref = $a.attr("href") || "";

    // Detect when we're in the alternatives section
    if (aText.includes("Supermarket Alternative")) inAlts = true;

    const pm = aHref.match(/\/product\/([^/]+)\/([A-Z0-9]{3,})/);
    if (!pm) return;
    if (pm[2] === code) return; // skip self

    // Only count products that show a store name and price
    const storeNames = ["Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons", "Waitrose", "Ocado", "Co-op", "Iceland", "M&S"];
    for (const sn of storeNames) {
      if (!aText.includes(sn)) continue;

      const priceM = aText.match(/£([\d.]+)/);
      if (!priceM) break;

      const umM = aText.match(/£([\d.]+)\s+per\s+([\w]+)/i);
      const altName = $a.attr("title") || aText.split("£")[0].trim();

      // Image
      const altImg = $a.find("img").attr("src") || "";

      alternatives.push({
        name: altName,
        code: pm[2],
        slug: pm[1],
        store: sn,
        price: parseFloat(priceM[1]),
        pricePerUnit: umM ? parseFloat(umM[1]) : null,
        unit: umM ? `per ${umM[2]}` : null,
        imageUrl: altImg ? (altImg.startsWith("/") ? `${TROLLEY}${altImg}` : altImg) : `${TROLLEY}/img/product/${pm[2]}`,
        productUrl: `${TROLLEY}${aHref}`,
      });
      break;
    }
  });

  // ── Price history hint ──
  let usualPrice = null;
  let highestPrice = null;
  const usualM = fullText.match(/Usually\s+£([\d.]+)/i);
  if (usualM) usualPrice = parseFloat(usualM[1]);
  const highM = fullText.match(/Highest\s+£([\d.]+)/i);
  if (highM) highestPrice = parseFloat(highM[1]);

  return {
    code,
    name,
    weight,
    imageUrl,
    storePrices,
    alternatives: alternatives.slice(0, 8),
    priceHistory: { usual: usualPrice, highest: highestPrice },
    source: "trolley.co.uk",
  };
}


// ─── Helpers ─────────────────────────────────────────────────────

async function fetchPage(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "public, max-age=900" : "no-cache", // 15 min cache on success
    },
    body: JSON.stringify(body),
  };
}
