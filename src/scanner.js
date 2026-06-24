const { chromium } = require('@playwright/test');
const { URL } = require('url');
const { classifyCookie } = require('./classifier');

function normaliseUrl(input) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = '';
  return url.toString();
}

function getHost(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sameSite(url, rootHost) {
  const host = getHost(url);
  return host === rootHost || host.endsWith(`.${rootHost}`);
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

function resourceKey(item) {
  return `${item.type}|${item.url}|${item.detectedOn}`;
}

function isAssetUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|ico|woff2?|ttf)$/i.test(pathname);
  } catch {
    return true;
  }
}

function guessProvider(url) {
  const host = getHost(url);

  if (host.includes('google-analytics')) return 'Google Analytics';
  if (host.includes('googletagmanager')) return 'Google Tag Manager';
  if (host.includes('doubleclick')) return 'Google DoubleClick';
  if (host.includes('youtube') || host.includes('ytimg')) return 'YouTube';
  if (host.includes('cookieyes')) return 'CookieYes';
  if (host.includes('moneypenny')) return 'Moneypenny';
  if (host.includes('yoshki')) return 'Yoshki / SRA Digital Badge';
  if (host.includes('facebook') || host.includes('connect.facebook')) return 'Meta / Facebook';
  if (host.includes('linkedin')) return 'LinkedIn';
  if (host.includes('hotjar')) return 'Hotjar';
  if (host.includes('clarity')) return 'Microsoft Clarity';

  return host || 'Unknown';
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
    if (isAssetUrl(cleaned)) continue;
    links.push(cleaned);
  }

  return [...new Set(links)];
}

async function collectPageResources(page, currentUrl, rootHost) {
  const resources = [];

  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(el => el.src);
    const iframes = Array.from(document.querySelectorAll('iframe[src]')).map(el => el.src);
    const images = Array.from(document.querySelectorAll('img[src]')).map(el => el.src);
    const links = Array.from(document.querySelectorAll('link[href]')).map(el => el.href);

    return { scripts, iframes, images, links };
  }).catch(() => ({
    scripts: [],
    iframes: [],
    images: [],
    links: []
  }));

  for (const [type, urls] of Object.entries(data)) {
    for (const url of urls) {
      const cleaned = cleanUrl(url);
      if (!cleaned) continue;

      const thirdParty = !sameSite(cleaned, rootHost);

      resources.push({
        type,
        url: cleaned,
        domain: getHost(cleaned),
        provider: guessProvider(cleaned),
        thirdParty,
        detectedOn: currentUrl
      });
    }
  }

  return resources;
}

async function collectSitemapUrls(request, rootUrl, rootHost, maxPages) {
  const sitemapCandidates = [
    new URL('/sitemap.xml', rootUrl).toString(),
    new URL('/sitemap_index.xml', rootUrl).toString(),
    new URL('/wp-sitemap.xml', rootUrl).toString()
  ];

  const urls = [];
  const seenSitemaps = new Set();

  async function readSitemap(sitemapUrl) {
    if (seenSitemaps.has(sitemapUrl)) return;
    seenSitemaps.add(sitemapUrl);

    try {
      const response = await request.get(sitemapUrl, { timeout: 15000 });
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
        } else if (!isAssetUrl(cleaned)) {
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
    } catch {}
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

  // Increased from 1000 to 10000.
  // Still limited to stop accidental endless crawling.
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || 1000), 10000));

  const consentMode = options.consentMode || 'none';
  const root = new URL(startUrl);
  const rootHost = root.hostname.replace(/^www\./, '').toLowerCase();
  const startedAt = new Date().toISOString();

  const browser = await launchBrowser();

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const cookieMap = new Map();
  const resourceMap = new Map();
  const networkMap = new Map();

  const pages = [];
  const errors = [];
  const queue = [startUrl];
  const seen = new Set();

  const page = await context.newPage();

  page.on('request', request => {
    try {
      const url = request.url();
      const cleaned = cleanUrl(url);
      if (!cleaned) return;

      const item = {
        type: 'network-request',
        method: request.method(),
        url: cleaned,
        domain: getHost(cleaned),
        provider: guessProvider(cleaned),
        thirdParty: !sameSite(cleaned, rootHost)
      };

      networkMap.set(`${item.method}|${item.url}`, item);
    } catch {}
  });

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
        newLinksFound: 0,
        thirdPartyResourcesFound: 0,
        thirdPartyNetworkRequestsFound: 0
      };

      try {
        const response = await page.goto(currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await handleConsent(page, consentMode);
        await page.waitForTimeout(1500);

        const cookies = await context.cookies();
        let pageCookieCount = 0;

        for (const cookie of cookies) {
          const classified = classifyCookie(cookie);

          const enriched = {
            ...cookie,
            ...classified,
            detectedOn: currentUrl,
            firstParty: sameSite(`https://${cookie.domain.replace(/^\./, '')}`, rootHost)
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

        const pageResources = await collectPageResources(page, currentUrl, rootHost);
        let thirdPartyResourcesFound = 0;

        for (const item of pageResources) {
          const key = resourceKey(item);

          if (!resourceMap.has(key)) {
            resourceMap.set(key, {
              ...item,
              pagesDetected: [currentUrl]
            });
          } else {
            const existing = resourceMap.get(key);
            if (!existing.pagesDetected.includes(currentUrl)) {
              existing.pagesDetected.push(currentUrl);
            }
          }

          if (item.thirdParty) thirdPartyResourcesFound++;
        }

        const newLinks = await collectLinks(page, rootHost);
        let added = 0;

        for (const link of newLinks) {
          if (!seen.has(link) && !queue.includes(link)) {
            queue.push(link);
            added++;
          }
        }

        const thirdPartyNetworkRequestsFound = [...networkMap.values()].filter(
          r => r.thirdParty
        ).length;

        pageRecord.status = response ? response.status() : 'loaded';
        pageRecord.cookiesFound = pageCookieCount;
        pageRecord.newLinksFound = added;
        pageRecord.thirdPartyResourcesFound = thirdPartyResourcesFound;
        pageRecord.thirdPartyNetworkRequestsFound = thirdPartyNetworkRequestsFound;
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

  const resources = [...resourceMap.values()].sort((a, b) =>
    String(a.domain).localeCompare(String(b.domain))
  );

  const networkRequests = [...networkMap.values()].sort((a, b) =>
    String(a.domain).localeCompare(String(b.domain))
  );

  const thirdPartyResources = resources.filter(r => r.thirdParty);
  const thirdPartyNetworkRequests = networkRequests.filter(r => r.thirdParty);

  const thirdPartyDomains = [
    ...new Set([
      ...thirdPartyResources.map(r => r.domain),
      ...thirdPartyNetworkRequests.map(r => r.domain),
      ...cookies.filter(c => !c.firstParty).map(c => c.domain.replace(/^\./, ''))
    ])
  ].sort();

  const thirdPartyServicesMap = new Map();

  for (const domain of thirdPartyDomains) {
    const provider = guessProvider(`https://${domain}`);

    if (!thirdPartyServicesMap.has(provider)) {
      thirdPartyServicesMap.set(provider, {
        provider,
        domains: [],
        cookiesFound: 0,
        scriptsFound: 0,
        iframesFound: 0,
        networkRequestsFound: 0,
        pagesDetected: []
      });
    }

    const service = thirdPartyServicesMap.get(provider);
    if (!service.domains.includes(domain)) service.domains.push(domain);
  }

  for (const cookie of cookies) {
    if (!cookie.firstParty) {
      const domain = cookie.domain.replace(/^\./, '');
      const provider = guessProvider(`https://${domain}`);
      const service = thirdPartyServicesMap.get(provider);

      if (service) {
        service.cookiesFound += 1;
        for (const p of cookie.pagesDetected || []) {
          if (!service.pagesDetected.includes(p)) service.pagesDetected.push(p);
        }
      }
    }
  }

  for (const resource of thirdPartyResources) {
    const provider = resource.provider;
    const service = thirdPartyServicesMap.get(provider);

    if (service) {
      if (resource.type === 'scripts') service.scriptsFound += 1;
      if (resource.type === 'iframes') service.iframesFound += 1;

      for (const p of resource.pagesDetected || []) {
        if (!service.pagesDetected.includes(p)) service.pagesDetected.push(p);
      }
    }
  }

  for (const request of thirdPartyNetworkRequests) {
    const provider = request.provider;
    const service = thirdPartyServicesMap.get(provider);

    if (service) {
      service.networkRequestsFound += 1;
    }
  }

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
    thirdPartyDomains,
    thirdPartyServices: [...thirdPartyServicesMap.values()],
    resources,
    thirdPartyResources,
    networkRequests,
    thirdPartyNetworkRequests,
    errors,
    auditLimits: {
      note: 'This scan covers discoverable public pages found through sitemaps and internal links. It does not guarantee hidden, login-only, form-only, or interaction-only pages.'
    }
  };
}

module.exports = { scanWebsite };
