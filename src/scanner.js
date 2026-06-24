const { chromium } = require('@playwright/test');
const { URL } = require('url');
const { classifyCookie } = require('./classifier');

function normaliseUrl(input) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = '';
  return url.toString();
}

function sameSite(url, rootHost) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === rootHost || host.endsWith(`.${rootHost}`);
  } catch {
    return false;
  }
}

function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function cookieKey(cookie) {
  return `${cookie.name}|${cookie.domain}|${cookie.path}`;
}

async function collectLinks(page, rootHost) {
  const hrefs = await page
    .$$eval('a[href]', links => links.map(a => a.href).filter(Boolean))
    .catch(() => []);

  const links = [];

  for (const href of hrefs) {
    const cleaned = cleanUrl(href);
    if (!cleaned) continue;
    if (!sameSite(cleaned, rootHost)) continue;

    const pathname = new URL(cleaned).pathname;

    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)$/i.test(pathname)) {
      continue;
    }

    links.push(cleaned);
  }

  return [...new Set(links)];
}

async function collectSitemapUrls(request, rootUrl, rootHost, maxPages) {
  const sitemapCandidates = [
    new URL('/sitemap.xml', rootUrl).toString(),
    new URL('/sitemap_index.xml', rootUrl).toString()
  ];

  const urls = [];

  async function readSitemap(sitemapUrl) {
    try {
      const response = await request.get(sitemapUrl, { timeout: 10000 });
      if (!response.ok()) return;

      const xml = await response.text();
      const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m =>
        m[1].trim().replace(/&amp;/g, '&')
      );

      for (const loc of locs) {
        const cleaned = cleanUrl(loc);
        if (!cleaned) continue;
        if (!sameSite(cleaned, rootHost)) continue;

        if (cleaned.endsWith('.xml')) {
          await readSitemap(cleaned);
        } else {
          urls.push(cleaned);
        }

        if (urls.length >= maxPages) return;
      }
    } catch {
      return;
    }
  }

  for (const sitemap of sitemapCandidates) {
    await readSitemap(sitemap);
    if (urls.length >= maxPages) break;
  }

  return [...new Set(urls)].slice(0, maxPages);
}

async function handleConsent(page, mode) {
  if (mode === 'none') return;

  const acceptPatterns = [
    'accept all',
    'accept',
    'agree',
    'allow all',
    'ok',
    'got it'
  ];

  const rejectPatterns = [
    'reject all',
    'reject',
    'decline',
    'deny',
    'necessary only'
  ];

  const patterns = mode === 'accept' ? acceptPatterns : rejectPatterns;

  for (const text of patterns) {
    try {
      const button = page.getByRole('button', { name: new RegExp(text, 'i') }).first();

      if (await button.count()) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      // Ignore failed consent attempts.
    }
  }
}

async function launchBrowser() {
  return chromium.launch({
    channel: 'chrome',
    headless: true
  });
}

async function scanWebsite(options, onProgress = () => {}) {
  const startUrl = normaliseUrl(options.url);
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || 100), 1000));
  const consentMode = options.consentMode || 'none';

  const root = new URL(startUrl);
  const rootHost = root.hostname.replace(/^www\./, '');
  const startedAt = new Date().toISOString();

  const browser = await launchBrowser();

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  const cookieMap = new Map();
  const pages = [];
  const errors = [];
  const queue = [startUrl];
  const seen = new Set();

  try {
    const sitemapUrls = await collectSitemapUrls(
      context.request,
      startUrl,
      rootHost,
      maxPages
    );

    for (const u of sitemapUrls) {
      if (!queue.includes(u)) queue.push(u);
    }

    while (queue.length && pages.length < maxPages) {
      const currentUrl = queue.shift();

      if (!currentUrl || seen.has(currentUrl)) continue;

      seen.add(currentUrl);

      onProgress({
        status: 'scanning',
        currentUrl,
        scanned: pages.length,
        queued: queue.length
      });

      const pageRecord = {
        url: currentUrl,
        status: 'pending',
        cookiesFound: 0,
        newLinksFound: 0
      };

      try {
        const response = await page.goto(currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await handleConsent(page, consentMode);
        await page.waitForTimeout(1200);

        const cookies = await context.cookies();
        let pageCookieCount = 0;

        for (const cookie of cookies) {
          const classified = classifyCookie(cookie);

          const enriched = {
            ...cookie,
            ...classified,
            detectedOn: currentUrl,
            firstParty: sameSite(
              `https://${cookie.domain.replace(/^\./, '')}`,
              rootHost
            )
          };

          const key = cookieKey(cookie);

          if (!cookieMap.has(key)) {
            cookieMap.set(key, {
              ...enriched,
              pagesDetected: [currentUrl]
            });
          } else {
            const existing = cookieMap.get(key);
            if (!existing.pagesDetected.includes(currentUrl)) {
              existing.pagesDetected.push(currentUrl);
            }
          }

          pageCookieCount++;
        }

        const newLinks = await collectLinks(page, rootHost);
        let added = 0;

        for (const link of newLinks) {
          if (
            !seen.has(link) &&
            !queue.includes(link) &&
            pages.length + queue.length < maxPages * 3
          ) {
            queue.push(link);
            added++;
          }
        }

        pageRecord.status = response ? response.status() : 'loaded';
        pageRecord.cookiesFound = pageCookieCount;
        pageRecord.newLinksFound = added;
      } catch (error) {
        pageRecord.status = 'error';
        pageRecord.error = error.message;
        errors.push({
          url: currentUrl,
          error: error.message
        });
      }

      pages.push(pageRecord);
    }
  } finally {
    await browser.close();
  }

  const cookies = [...cookieMap.values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name))
  );

  const categoryCounts = cookies.reduce((acc, c) => {
    const category = c.category || 'unknown';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  return {
    scannedAt: startedAt,
    rootUrl: startUrl,
    rootHost,
    consentMode,
    maxPages,
    scannedPageCount: pages.length,
    discoveredQueueCount: queue.length,
    cookieCount: cookies.length,
    categoryCounts,
    pages,
    cookies,
    errors
  };
}

module.exports = { scanWebsite };
