/**
 * Cozzie Livs Calc — Netlify Function
 *
 * Two modes:
 *   GET /api/search?q=mozzarella     → 1 request to Trolley explore page, returns product list
 *   GET /api/search?product=CODE     → 1 request to Trolley product page, returns per-store detail
 */

const cheerio = require("cheerio");

const TROLLEY = "https://www.trolley.co.uk";

/**
 * Use Haiku to select the 1-2 best candidate products for a query.
 * Calls the Anthropic API directly via fetch — no SDK needed.
 * Returns ordered indices (best first), falling back to [0] on failure.
 */
async function aiSelectBestCandidates(candidates, coreQuery) {
  if (!process.env.ANTHROPIC_API_KEY || candidates.length <= 1) return [0];

  const list = candidates.map((c, i) => {
    const per100g = (c.weight && c.price > 0) ? computePer100g(c.price, c.weight) : null;
    let line = `${i}. ${c.name}`;
    if (c.weight) line += ` (${c.weight})`;
    if (c.price > 0) line += ` £${c.price.toFixed(2)}`;
    if (per100g)  line += ` = £${per100g.toFixed(2)}/100g`;
    return line;
  }).join("\n");

  const prompt = `UK grocery search: "${coreQuery}"\n\nCandidates:\n${list}\n\nSelect the best 3-4 products that most closely match the search query. Rules:\n- Match the specific descriptor precisely (e.g. "mature cheddar" → mature cheddar, NOT mild or extra mature)\n- Any brand is fine — own-brand and national brands equally welcome\n- Exclude: dips, sauces, spreads, composites, products that merely contain the ingredient as a component\n- Prefer better value (cheaper per 100g) among equally relevant products\nReply ONLY with a JSON array of 3-4 indices e.g. [0,2,3] or [1,2,3,4]`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 30,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const m = text.match(/\[[\d,\s]*\]/);
    if (!m) return [0];
    const indices = JSON.parse(m[0]).filter(i => Number.isInteger(i) && i >= 0 && i < candidates.length);
    return indices.length > 0 ? indices.slice(0, 4) : [0];
  } catch (err) {
    console.log(`[ai-select] failed (${err.message}), using first candidate`);
    return [0];
  }
}

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

  // Mode 0: Compare (listing → AI selection → detail + alternatives → per-store compare)
  if (params.compare && params.q) {
    return handleCompare(params.q.trim());
  }

  // Mode 1: Product detail (single product, per-store pricing)
  if (params.product) {
    return handleProductDetail(params.product, params.slug || "");
  }

  // Mode 2: Search (lightweight listing)
  if (params.q) {
    return handleSearch(params.q.trim(), parseInt(params.max_results || "60", 10));
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
  maxResults = Math.max(1, Math.min(maxResults, 500));

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

  const knownStoreNames = ["Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons", "Waitrose", "Ocado", "Co-op", "M&S", "Iceland"];

  $('a[href*="/product/"]').each((_, el) => {
    if (products.length >= max) return false;

    const $a = $(el);
    const href = $a.attr("href") || "";
    const m = href.match(/\/product\/([^/]+)\/([A-Z0-9]{3,})/);
    if (!m) return;

    const [, slug, code] = m;
    if (seen.has(code)) return;
    seen.add(code);

    const title = $a.attr("title") || "";
    const text = $a.text().replace(/\s+/g, " ").trim();

    // Name — prefer title attr, then first heading inside link, then text before first £
    let name = title;
    if (!name) {
      const inner = $a.find("strong, b, h3, h4, p").first().text().trim();
      if (inner && inner.length > 3) {
        name = inner;
      } else {
        // Strip weight patterns and take everything before first £
        name = text.split("£")[0].replace(/\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|pt)\b/gi, "").trim();
      }
    }
    if (!name || name.length < 3) return;

    // Price — skip per-unit figures (e.g. "£0.55 per 100g") to get the item price
    const price = extractItemPrice(text);

    // Weight
    const wm = text.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pt)\b/i);
    const weight = wm ? `${wm[1]}${wm[2]}` : null;

    // Per-unit price
    const um = text.match(/£([\d.]+)\s+per\s+([\d]*\s*\w+)/i);

    // Store — search anywhere in the card text (store name can appear mid-card)
    let store = "";
    const textLower = text.toLowerCase();
    for (const s of knownStoreNames) {
      if (textLower.includes(s.toLowerCase())) {
        store = s; break;
      }
    }
    // Image
    const imgSrc = $a.find("img").attr("src") || "";
    const imageUrl = imgSrc
      ? (imgSrc.startsWith("/") ? `${TROLLEY}${imgSrc}` : imgSrc)
      : `${TROLLEY}/img/product/${code}`;

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
  });

  return products;
}


// ═════════════════════════════════════════════════════════════════
// MODE 0: COMPARE — listing + detail merge, returns per-store compare
// ═════════════════════════════════════════════════════════════════

async function handleCompare(query) {
  if (!query || query.length > 120) return json(400, { error: "Invalid query" });

  console.log(`[compare] q="${query}"`);

  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const urls = [
    `${TROLLEY}/explore/${slug}s`,
    `${TROLLEY}/explore/${slug}`,
    `${TROLLEY}/explore/${slug}es`,
    `${TROLLEY}/search/?q=${encodeURIComponent(query)}`,
  ];

  // Step 1: get candidates from listing, AI picks the most relevant
  let candidates = [];
  for (const url of urls) {
    try {
      console.log(`[compare] trying ${url}`);
      const html = await fetchPage(url);
      if (!html || html.length < 200) continue;
      const products = parseListingPage(html, 30);
      if (products.length > 0) { candidates = products; break; }
    } catch (err) {
      console.log(`[compare] ${url} failed: ${err.message}`);
    }
  }

  if (candidates.length === 0) {
    console.log(`[compare] no products found`);
    return json(200, { query, storePrices: [] });
  }

  const selectedIndices = await aiSelectBestCandidates(candidates, query);
  const topProducts = selectedIndices.map(i => candidates[i]);
  console.log(`[compare] ${candidates.length} candidates → AI selected ${topProducts.length}: ${topProducts.map(p => `"${p.name}"`).join(", ")}`);

  // Step 2: fetch detail pages for AI-selected products in parallel
  const detailResults = (await Promise.all(
    topProducts.map(async (product) => {
      const detailUrl = `${TROLLEY}/product/${product.slug}/${product.code}`;
      try {
        const html = await fetchPage(detailUrl, 8000);
        return { product, detail: parseProductPage(html, product.code), detailUrl };
      } catch (err) {
        console.log(`[compare] detail fetch failed for ${product.code}: ${err.message}`);
        return null;
      }
    })
  )).filter(Boolean);

  if (detailResults.length === 0) {
    return json(200, { query, storePrices: [] });
  }

  // Step 3: merge all storePrices first (with loyalty data), keeping cheapest per store
  const byStore = {};

  for (const { product, detail, detailUrl } of detailResults) {
    for (const sp of (detail.storePrices || [])) {
      if (!sp.store || !sp.price) continue;
      const effectivePrice = sp.loyaltyPrice && sp.loyaltyPrice < sp.price ? sp.loyaltyPrice : sp.price;
      const existing = byStore[sp.store];
      const existingEffective = existing ? (existing.loyaltyPrice && existing.loyaltyPrice < existing.price ? existing.loyaltyPrice : existing.price) : Infinity;
      if (!existing || effectivePrice < existingEffective) {
        byStore[sp.store] = {
          store: sp.store,
          price: sp.price,
          pricePerUnit: sp.pricePerUnit || null,
          unit: sp.unit || null,
          loyaltyPrice: sp.loyaltyPrice || null,
          loyaltyScheme: sp.loyaltyScheme || null,
          promotion: sp.promotion || null,
          per100g: computePer100g(effectivePrice, detail.weight),
          name: detail.name,
          weight: detail.weight,
          imageUrl: detail.imageUrl,
          productUrl: detailUrl,
          code: product.code,
          slug: product.slug,
        };
      }
    }
  }

  // Step 4: fill in stores not covered by storePrices using alternatives
  for (const { detail } of detailResults) {
    for (const alt of (detail.alternatives || [])) {
      if (!alt.store || byStore[alt.store]) continue;
      if (!alt.price || alt.price <= 0) continue;
      const altName = (alt.name && alt.name.length > alt.store.length + 2)
        ? alt.name
        : (alt.slug || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || alt.store;
      byStore[alt.store] = {
        store: alt.store,
        price: alt.price,
        pricePerUnit: alt.pricePerUnit || null,
        unit: alt.unit || null,
        loyaltyPrice: null,
        loyaltyScheme: null,
        promotion: null,
        per100g: null, // alternatives don't carry weight data
        name: altName,
        weight: null,
        imageUrl: alt.imageUrl,
        productUrl: alt.productUrl,
        code: alt.code,
        slug: alt.slug,
      };
    }
  }

  const storePrices = Object.values(byStore);
  console.log(`[compare] stores found: ${storePrices.map(s => s.store).join(", ")}`);
  console.log(`[compare] loyalty: ${storePrices.filter(s => s.loyaltyPrice).map(s => `${s.store} £${s.loyaltyPrice} (${s.loyaltyScheme})`).join(", ") || "none"}`);
  return json(200, { query, storePrices });
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

  // Product name — h1 first, fall back to page title (strip "Buy X | Trolley.co.uk")
  let name = $("h1").first().text().trim();
  if (!name || name.length < 3) {
    const rawTitle = $("title").first().text().trim();
    name = rawTitle.split(/\s*[|\-–]\s*/)[0].replace(/^Buy\s+/i, "").trim();
  }

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
    // loyaltyRx:    matches "Clubcard Price £3.00" (label before price)
    // loyaltyAltRx: matches "£3.00 Clubcard Price" (price before label — Trolley's actual format)
    { name: "Tesco",       loyalty: "Clubcard", loyaltyRx: /CLUBCARD\s*(?:PRICE)?\s*£([\d.]+)/i,  loyaltyAltRx: /£([\d.]+)\s+Clubcard/i },
    { name: "Sainsbury's", loyalty: "Nectar",   loyaltyRx: /NECTAR\s*(?:PRICE)?\s*£([\d.]+)/i,    loyaltyAltRx: /£([\d.]+)\s+Nectar/i },
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

      // Find per-unit price — "£X per unit" or "£X each"
      let pricePerUnit = null;
      let unit = null;
      const unitMatch = segmentClean.match(/£([\d.]+)\s+per\s+([\d]*\s*[\w]+)/i);
      const eachMatch = segmentClean.match(/£([\d.]+)\s+each/i);
      if (unitMatch) { pricePerUnit = parseFloat(unitMatch[1]); unit = `per ${unitMatch[2].trim()}`; }
      else if (eachMatch) { pricePerUnit = parseFloat(eachMatch[1]); unit = "per item"; }

      // Collect positions of per-unit prices so we can skip them when finding the item price
      const perUnitPositions = new Set();
      for (const m of segmentClean.matchAll(/£[\d.]+\s+per\s+/gi)) perUnitPositions.add(m.index);

      // Main item price = first £ amount that is NOT a per-unit figure
      const allPrices = [];
      for (const m of segmentClean.matchAll(/£([\d.]+)/g)) {
        if (!perUnitPositions.has(m.index)) allPrices.push(parseFloat(m[1]));
      }

      if (allPrices.length === 0) continue;

      const price = allPrices[0];

      // Check for loyalty price — try "Clubcard Price £X" then "£X Clubcard Price" (Trolley's format)
      let loyaltyPrice = null;
      let loyaltyScheme = null;
      if (storeConfig.loyaltyRx) {
        const m1 = segmentClean.match(storeConfig.loyaltyRx);
        if (m1) {
          loyaltyPrice = parseFloat(m1[1]);
          loyaltyScheme = storeConfig.loyalty;
        } else if (storeConfig.loyaltyAltRx) {
          const m2 = segmentClean.match(storeConfig.loyaltyAltRx);
          // Only treat as loyalty price if it's cheaper than the regular price
          if (m2 && parseFloat(m2[1]) < price) {
            loyaltyPrice = parseFloat(m2[1]);
            loyaltyScheme = storeConfig.loyalty;
          }
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

  $('a[href*="/product/"]').each((_, el) => {
    const $a = $(el);
    const aText = $a.text().replace(/\s+/g, " ").trim();
    const aHref = $a.attr("href") || "";


    const pm = aHref.match(/\/product\/([^/]+)\/([A-Z0-9]{3,})/);
    if (!pm) return;
    if (pm[2] === code) return; // skip self

    // Only count products that show a store name and price
    const storeNames = ["Tesco", "Sainsbury's", "Aldi", "Asda", "Morrisons", "Waitrose", "Ocado", "Co-op", "Iceland", "M&S"];
    for (const sn of storeNames) {
      if (!aText.includes(sn)) continue;

      const altPrice = extractItemPrice(aText);
      if (!altPrice) break;

      const perM = aText.match(/£([\d.]+)\s+per\s+([\d]*\s*[\w]+)/i);
      const eachM = aText.match(/£([\d.]+)\s+each/i);
      const altPpu = perM ? parseFloat(perM[1]) : (eachM ? parseFloat(eachM[1]) : null);
      const altUnit = perM ? `per ${perM[2]}` : (eachM ? "per item" : null);
      const altName = $a.attr("title") || aText.split("£")[0].trim();

      // Image
      const altImg = $a.find("img").attr("src") || "";

      alternatives.push({
        name: altName,
        code: pm[2],
        slug: pm[1],
        store: sn,
        price: altPrice,
        pricePerUnit: altPpu,
        unit: altUnit,
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

/**
 * Extract the first item price from text, skipping any "£X per unit" figures.
 * e.g. "£0.55 per 100g £2.50" → 2.50, not 0.55
 */
function extractItemPrice(text) {
  const perUnitPositions = new Set();
  for (const m of text.matchAll(/£[\d.]+\s+per\s+/gi)) perUnitPositions.add(m.index);
  for (const m of text.matchAll(/£([\d.]+)/g)) {
    if (!perUnitPositions.has(m.index)) return parseFloat(m[1]);
  }
  return 0;
}

/** Returns price per 100g (or per 100ml), or null if weight can't be parsed. */
function computePer100g(price, weight) {
  if (!price || !weight) return null;
  const m = String(weight).match(/^([\d.]+)\s*(g|kg|ml|l|pt)$/i);
  if (!m) return null;
  let amount = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "kg" || unit === "l") amount *= 1000;
  else if (unit === "pt") amount *= 568; // 1 pint ≈ 568ml
  if (amount < 5 || amount > 50000) return null; // sanity check
  return (price / amount) * 100;
}

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
