/**
 * Cozzie Livs Calc — Netlify Function
 *
 * Serverless endpoint that searches Tesco, Sainsbury's, and Aldi
 * concurrently and returns combined price comparison results.
 *
 * Called by the frontend at: /.netlify/functions/search?q=mozzarella
 */

const cheerio = require("cheerio");

// ─── Main Handler ────────────────────────────────────────────────

exports.handler = async (event) => {
  // Only allow GET
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const query = (event.queryStringParameters?.q || "").trim();
  if (!query || query.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid query" }) };
  }

  const maxResults = Math.min(
    parseInt(event.queryStringParameters?.max_results || "8", 10),
    20
  );

  console.log(`Searching for: "${query}"`);

  // Run all 3 scrapers concurrently
  const [tesco, sainsburys, aldi] = await Promise.allSettled([
    searchTesco(query, maxResults),
    searchSainsburys(query, maxResults),
    searchAldi(query, maxResults),
  ]);

  // Process results
  const storeResults = [tesco, sainsburys, aldi].map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      store: "unknown",
      query,
      products: [],
      error: result.reason?.message || "Scraper failed",
    };
  });

  // Collect all products and sort by best price
  const allProducts = storeResults.flatMap((sr) => sr.products || []);
  allProducts.sort((a, b) => (a.bestPrice || Infinity) - (b.bestPrice || Infinity));

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // cache 5 mins
    },
    body: JSON.stringify({
      query,
      stores: storeResults,
      cheapest: allProducts.slice(0, 5),
      totalResults: allProducts.length,
    }),
  };
};


// ─── Shared Helpers ──────────────────────────────────────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

/**
 * Fetch a URL with timeout and error handling.
 */
async function fetchPage(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract a numeric price from text like "£1.50", "150p", etc.
 */
function extractPrice(text) {
  if (!text) return 0;
  if (typeof text === "number") return text;
  text = String(text);

  // £1.50
  let match = text.match(/£([\d.]+)/);
  if (match) return parseFloat(match[1]);

  // 150p
  match = text.match(/(\d+)p/);
  if (match) return parseFloat(match[1]) / 100;

  // bare number
  match = text.match(/[\d.]+/);
  if (match) return parseFloat(match[0]);

  return 0;
}

/**
 * Build a standardised product object.
 */
function makeProduct(store, { name, regularPrice, loyaltyPrice, pricePerUnit, unit, imageUrl, productUrl, promotion, weight }) {
  const bestPrice = loyaltyPrice != null && loyaltyPrice < regularPrice
    ? loyaltyPrice
    : regularPrice;

  return {
    store,
    name: name || "",
    regularPrice: regularPrice || 0,
    loyaltyPrice: loyaltyPrice ?? null,
    pricePerUnit: pricePerUnit ?? null,
    unit: unit ?? null,
    imageUrl: imageUrl ?? null,
    productUrl: productUrl ?? null,
    promotion: promotion ?? null,
    weight: weight ?? null,
    bestPrice,
  };
}


// ═══════════════════════════════════════════════════════════════════
// TESCO SCRAPER
// ═══════════════════════════════════════════════════════════════════

async function searchTesco(query, maxResults) {
  const result = { store: "tesco", query, products: [], error: null };

  try {
    const url = `https://www.tesco.com/groceries/en-GB/search?query=${encodeURIComponent(query)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Method 1: Parse __NEXT_DATA__ (most reliable)
    const nextDataScript = $("#__NEXT_DATA__");
    if (nextDataScript.length) {
      try {
        const data = JSON.parse(nextDataScript.html());
        const products = parseTescoNextData(data, maxResults);
        if (products.length > 0) {
          result.products = products;
          return result;
        }
      } catch (e) {
        console.log("Tesco __NEXT_DATA__ parse failed:", e.message);
      }
    }

    // Method 2: Parse HTML product tiles
    result.products = parseTescoHTML($, maxResults);

  } catch (e) {
    console.error("Tesco scraper error:", e.message);
    result.error = e.message;
  }

  return result;
}

function parseTescoNextData(data, maxResults) {
  const products = [];

  try {
    const pageProps = data?.props?.pageProps || {};

    // Try various paths where Tesco stores search results
    const items =
      pageProps?.results?.productItems ||
      pageProps?.results?.results ||
      pageProps?.searchResults?.productItems ||
      [];

    for (const item of items.slice(0, maxResults)) {
      const prod = item.product || item;
      const name = prod.title || prod.name;
      if (!name) continue;

      // Regular price
      let regularPrice = 0;
      if (typeof prod.price === "number") {
        regularPrice = prod.price;
      } else if (typeof prod.price === "string") {
        regularPrice = extractPrice(prod.price);
      }

      // Clubcard price — look in promotions
      let clubcardPrice = null;
      const promotions = prod.promotions || [];
      for (const promo of promotions) {
        const desc = (promo.description || "").toLowerCase();
        if (desc.includes("clubcard")) {
          if (promo.price != null) {
            clubcardPrice = parseFloat(promo.price);
          } else if (promo.offerPrice != null) {
            clubcardPrice = parseFloat(promo.offerPrice);
          } else {
            const match = (promo.description || "").match(/£([\d.]+)/);
            if (match) clubcardPrice = parseFloat(match[1]);
          }
          break;
        }
      }

      // Unit price
      let pricePerUnit = null;
      let unit = null;
      const unitStr = prod.unitPrice || prod.unitOfSale || "";
      if (unitStr) {
        const match = String(unitStr).match(/£?([\d.]+)\s*\/?\s*(\w+)/);
        if (match) {
          pricePerUnit = parseFloat(match[1]);
          unit = `per ${match[2]}`;
        }
      }

      // Image
      const imageUrl = prod.defaultImageUrl || prod.imageUrl || null;

      // Product URL
      const productId = prod.id || "";
      const productUrl = productId
        ? `https://www.tesco.com/groceries/en-GB/products/${productId}`
        : null;

      // Promo text
      const promoText = promotions[0]?.description || null;

      products.push(
        makeProduct("tesco", {
          name,
          regularPrice,
          loyaltyPrice: clubcardPrice,
          pricePerUnit,
          unit,
          imageUrl,
          productUrl,
          promotion: promoText,
          weight: prod.unitOfMeasure || null,
        })
      );
    }
  } catch (e) {
    console.log("Tesco __NEXT_DATA__ product parse error:", e.message);
  }

  return products;
}

function parseTescoHTML($, maxResults) {
  const products = [];

  const tiles = $(
    '[data-auto="product-tile"], .product-list--list-item, li[class*="product"]'
  );

  tiles.slice(0, maxResults).each((_, el) => {
    try {
      const $el = $(el);

      // Name
      const nameEl = $el.find(
        '[data-auto="product-tile--title"], h3 a, .product-tile--title'
      );
      const name = nameEl.text().trim();
      if (!name) return;

      // Price
      const priceEl = $el.find(
        '[data-auto="price-value"], .price-per-sellable-unit .value, .beans-price__text'
      );
      const regularPrice = extractPrice(priceEl.text());

      // Clubcard price
      let clubcardPrice = null;
      const ccEl = $el.find('[class*="clubcard"], [class*="Clubcard"], .offer-text');
      if (ccEl.length) {
        const ccText = ccEl.text();
        if (ccText.toLowerCase().includes("clubcard")) {
          const match = ccText.match(/£([\d.]+)/);
          if (match) clubcardPrice = parseFloat(match[1]);
        }
      }

      // Image
      const imgEl = $el.find("img");
      const imageUrl = imgEl.attr("src") || null;

      // URL
      const linkEl = $el.find("a[href*='/products/']");
      let productUrl = null;
      if (linkEl.length) {
        const href = linkEl.attr("href") || "";
        productUrl = href.startsWith("/") ? `https://www.tesco.com${href}` : href;
      }

      products.push(
        makeProduct("tesco", {
          name,
          regularPrice,
          loyaltyPrice: clubcardPrice,
          imageUrl,
          productUrl,
        })
      );
    } catch (e) {
      // skip this product
    }
  });

  return products;
}


// ═══════════════════════════════════════════════════════════════════
// SAINSBURY'S SCRAPER
// ═══════════════════════════════════════════════════════════════════

async function searchSainsburys(query, maxResults) {
  const result = { store: "sainsburys", query, products: [], error: null };

  try {
    const url = `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(query)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Method 1: Look for embedded JSON state
    $("script").each((_, el) => {
      const text = $(el).html() || "";

      if (text.includes("__PRELOADED_STATE__") || text.includes("searchResults")) {
        try {
          const match = text.match(
            /(?:__PRELOADED_STATE__|__NEXT_DATA__)\s*=\s*({.+?});?\s*$/s
          );
          if (match) {
            const data = JSON.parse(match[1]);
            const products = parseSainsburysState(data, maxResults);
            if (products.length > 0) {
              result.products = products;
              return false; // break .each
            }
          }
        } catch (e) {
          // continue
        }
      }
    });

    if (result.products.length > 0) return result;

    // Method 2: __NEXT_DATA__
    const nextData = $("#__NEXT_DATA__");
    if (nextData.length) {
      try {
        const data = JSON.parse(nextData.html());
        const pageProps = data?.props?.pageProps || {};
        const products = parseSainsburysState(pageProps, maxResults);
        if (products.length > 0) {
          result.products = products;
          return result;
        }
      } catch (e) {
        console.log("Sainsbury's __NEXT_DATA__ parse failed:", e.message);
      }
    }

    // Method 3: HTML fallback
    result.products = parseSainsburysHTML($, maxResults);

  } catch (e) {
    console.error("Sainsbury's scraper error:", e.message);
    result.error = e.message;
  }

  return result;
}

function parseSainsburysState(data, maxResults) {
  const products = [];

  try {
    const searchData = data.search || data.searchResults || data;
    const items =
      searchData.products ||
      searchData.results ||
      searchData.data?.products ||
      [];

    for (const item of items.slice(0, maxResults)) {
      const name = item.name || item.productName;
      if (!name) continue;

      // Price
      let regularPrice = 0;
      const rp = item.retailPrice;
      if (typeof rp === "object" && rp !== null) {
        regularPrice = parseFloat(rp.price || 0);
      } else if (rp != null) {
        regularPrice = parseFloat(rp);
      }

      // Nectar price
      let nectarPrice = null;
      const promos = item.promotions || [];
      for (const promo of promos) {
        const desc = (promo.description || "").toLowerCase();
        if (desc.includes("nectar")) {
          if (promo.price != null) nectarPrice = parseFloat(promo.price);
          else if (promo.offerPrice != null) nectarPrice = parseFloat(promo.offerPrice);
          else {
            const match = (promo.description || "").match(/£([\d.]+)/);
            if (match) nectarPrice = parseFloat(match[1]);
          }
          break;
        }
      }

      // Also check dedicated nectar fields
      if (nectarPrice == null) {
        const np = item.nectarPrice || item.nectar_price;
        if (np != null) {
          nectarPrice = typeof np === "object" ? parseFloat(np.price || 0) : parseFloat(np);
        }
      }

      // Unit price
      let pricePerUnit = null;
      let unit = null;
      const up = item.unitPrice;
      if (typeof up === "object" && up !== null) {
        pricePerUnit = parseFloat(up.price || 0) || null;
        unit = up.measure ? `per ${up.measure}` : null;
      }

      // Image & URL
      const imageUrl = item.image || item.imageUrl || null;
      let productUrl = item.url || item.productUrl || null;
      if (productUrl && !productUrl.startsWith("http")) {
        productUrl = `https://www.sainsburys.co.uk${productUrl}`;
      }

      const promoText = promos[0]?.description || null;

      products.push(
        makeProduct("sainsburys", {
          name,
          regularPrice,
          loyaltyPrice: nectarPrice,
          pricePerUnit,
          unit,
          imageUrl,
          productUrl,
          promotion: promoText,
          weight: item.unitOfMeasure || item.size || null,
        })
      );
    }
  } catch (e) {
    console.log("Sainsbury's state parse error:", e.message);
  }

  return products;
}

function parseSainsburysHTML($, maxResults) {
  const products = [];

  const cards = $(
    '[data-test-id="product-tile"], .pt-grid-item, .product-grid .ln-c-card, li[class*="product"]'
  );

  cards.slice(0, maxResults).each((_, el) => {
    try {
      const $el = $(el);

      const nameEl = $el.find(
        '[data-test-id="product-tile-name"], a[data-test-id="product-title"], h2 a, h3 a, .pt__info__description'
      );
      const name = nameEl.text().trim();
      if (!name) return;

      const priceEl = $el.find(
        '[data-test-id="pt-retail-price"], .pt__cost__retail-price, .pricing-now'
      );
      const regularPrice = extractPrice(priceEl.text());

      // Nectar
      let nectarPrice = null;
      const nectarEl = $el.find('[class*="nectar"], [data-test-id*="nectar"]');
      if (nectarEl.length) {
        const nt = nectarEl.text();
        if (nt.toLowerCase().includes("nectar")) {
          const match = nt.match(/£([\d.]+)/);
          if (match) nectarPrice = parseFloat(match[1]);
        }
      }

      // Unit price
      let pricePerUnit = null;
      let unit = null;
      const unitEl = $el.find('[data-test-id="pt-unit-price"], .pt__cost__unit-price');
      if (unitEl.length) {
        const match = unitEl.text().match(/£?([\d.]+)\s*\/?\s*(\w+)/);
        if (match) {
          pricePerUnit = parseFloat(match[1]);
          unit = `per ${match[2]}`;
        }
      }

      // Image & URL
      const imgEl = $el.find("img");
      const imageUrl = imgEl.attr("src") || null;

      const linkEl = $el.find("a[href]");
      let productUrl = null;
      if (linkEl.length) {
        const href = linkEl.attr("href") || "";
        if (href.startsWith("/")) productUrl = `https://www.sainsburys.co.uk${href}`;
        else if (href.startsWith("http")) productUrl = href;
      }

      products.push(
        makeProduct("sainsburys", {
          name,
          regularPrice,
          loyaltyPrice: nectarPrice,
          pricePerUnit,
          unit,
          imageUrl,
          productUrl,
        })
      );
    } catch (e) {
      // skip
    }
  });

  return products;
}


// ═══════════════════════════════════════════════════════════════════
// ALDI SCRAPER
// ═══════════════════════════════════════════════════════════════════

async function searchAldi(query, maxResults) {
  const result = { store: "aldi", query, products: [], error: null };

  try {
    const url = `https://www.aldi.co.uk/search?q=${encodeURIComponent(query)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Method 1: JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item["@type"] === "Product") {
            const product = parseAldiJsonLd(item);
            if (product) result.products.push(product);
          }
        }
      } catch (e) {
        // continue
      }
    });

    if (result.products.length > 0) {
      result.products = result.products.slice(0, maxResults);
      return result;
    }

    // Method 2: __NEXT_DATA__
    const nextData = $("#__NEXT_DATA__");
    if (nextData.length) {
      try {
        const data = JSON.parse(nextData.html());
        const products = parseAldiNextData(data, maxResults);
        if (products.length > 0) {
          result.products = products;
          return result;
        }
      } catch (e) {
        console.log("Aldi __NEXT_DATA__ parse failed:", e.message);
      }
    }

    // Method 3: HTML fallback
    result.products = parseAldiHTML($, maxResults);

  } catch (e) {
    console.error("Aldi scraper error:", e.message);
    result.error = e.message;
  }

  return result;
}

function parseAldiJsonLd(data) {
  try {
    const name = data.name;
    if (!name) return null;

    let offers = data.offers || {};
    if (Array.isArray(offers)) offers = offers[0] || {};

    const price = parseFloat(offers.price || 0);

    return makeProduct("aldi", {
      name,
      regularPrice: price,
      imageUrl: data.image || null,
      productUrl: data.url || null,
    });
  } catch (e) {
    return null;
  }
}

function parseAldiNextData(data, maxResults) {
  const products = [];

  try {
    const pageProps = data?.props?.pageProps || {};
    const items =
      pageProps.searchResults?.products ||
      pageProps.products ||
      pageProps.results ||
      [];

    for (const item of items.slice(0, maxResults)) {
      const name = item.name || item.productName;
      if (!name) continue;

      const price = parseFloat(item.price || item.retailPrice || 0);

      let imageUrl = item.image || item.imageUrl || null;
      let productUrl = item.url || item.productUrl || null;
      if (productUrl && !productUrl.startsWith("http")) {
        productUrl = `https://www.aldi.co.uk${productUrl}`;
      }

      const unitPrice = item.unitPrice ? parseFloat(item.unitPrice) : null;
      const unit = item.unitOfMeasure ? `per ${item.unitOfMeasure}` : null;

      products.push(
        makeProduct("aldi", {
          name,
          regularPrice: price,
          pricePerUnit: unitPrice,
          unit,
          imageUrl,
          productUrl,
          weight: item.size || null,
        })
      );
    }
  } catch (e) {
    console.log("Aldi __NEXT_DATA__ parse error:", e.message);
  }

  return products;
}

function parseAldiHTML($, maxResults) {
  const products = [];

  const tiles = $(
    '.hover-item, [data-qa="search-product-tile"], .category-item, .product-tile'
  );

  tiles.slice(0, maxResults).each((_, el) => {
    try {
      const $el = $(el);

      const nameEl = $el.find(
        ".hover-item__title, a.category-item__title, [data-qa=\"product-title\"], h3, h4"
      );
      const name = nameEl.text().trim();
      if (!name) return;

      const priceEl = $el.find(
        ".hover-item__price, .category-item__price, [data-qa=\"product-price\"], .product-tile-price"
      );
      const regularPrice = extractPrice(priceEl.text());

      const imgEl = $el.find("img");
      const imageUrl = imgEl.attr("src") || imgEl.attr("data-src") || null;

      const linkEl = $el.find("a[href]");
      let productUrl = null;
      if (linkEl.length) {
        const href = linkEl.attr("href") || "";
        if (href.startsWith("/")) productUrl = `https://www.aldi.co.uk${href}`;
        else if (href.startsWith("http")) productUrl = href;
      }

      products.push(
        makeProduct("aldi", {
          name,
          regularPrice,
          imageUrl,
          productUrl,
        })
      );
    } catch (e) {
      // skip
    }
  });

  return products;
}
