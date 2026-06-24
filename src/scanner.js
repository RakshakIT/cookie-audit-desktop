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
    return /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|ico|woff2?|ttf)$/i.test(pathname);
  } catch {
    return true;
  }
}

function guessProvider(url) {
  const host = getHost(url);

  if (host.includes('google-analytics')) return 'Google Analytics';
  if (host.includes('googletagmanager')) return 'Google Tag Manager';
  if (host.includes('doubleclick')) return 'Google DoubleClick';
  if (host.includes('google.com')) return 'Google';
  if (host.includes('youtube') || host.includes('ytimg')) return 'YouTube';
  if (host.includes('cookieyes')) return 'CookieYes';
  if (host.includes('moneypenny')) return 'Moneypenny';
  if (host.includes('yoshki')) return 'Yoshki / SRA Digital Badge';
  if (host.includes('trustpilot')) return 'Trustpilot';
  if (host.includes('blockmarktech')) return 'BlockMark Registry';
  if (host.includes('regulationandcomplianceoffice')) return 'Regulation and Compliance Office';
  if (host.includes('facebook') || host.includes('connect.facebook')) return 'Meta / Facebook';
  if (host.includes('linkedin')) return 'LinkedIn';
  if (host.includes('hotjar')) return 'Hotjar';
  if (host.includes('clarity')) return 'Microsoft Clarity';

  return host || 'Unknown';
}

function getExpiryLabel(cookie) {
  if (!cookie.expires || cookie.expires < 0) return 'Session';

  const now = Date.now() / 1000;
  const diff = cookie.expires - now;

  if (diff <= 0) return 'Expired';

  const days = Math.round(diff / 86400);

  if (days < 1) return 'Less than 1 day';
  if (days === 1) return '1 day';
  if (days < 31) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} month`;
  return `${Math.round(days / 365)} year`;
}

function getCookieDescription(cookie) {
  const name = String(cookie.name || '').toLowerCase();
  const domain = String(cookie.domain || '').toLowerCase();

  if (name === '_ga') return 'Google Analytics cookie used to distinguish users.';
  if (name.startsWith('_ga_')) return 'Google Analytics 4 cookie used to maintain session state.';
  if (name === '_gid') return 'Google Analytics cookie used to distinguish users.';
  if (name.startsWith('_gat')) return 'Google Analytics throttling cookie.';
  if (name === '_gcl_au') return 'Google advertising conversion linker cookie.';
  if (name === 'ide') return 'Google DoubleClick advertising cookie.';
  if (name === 'test_cookie') return 'DoubleClick test cookie used to check whether the browser supports cookies.';
  if (name === 'ysc') return 'YouTube cookie used to maintain and track video session activity.';
  if (name === 'visitor_info1_live') return 'YouTube cookie used for video preferences and tracking.';
  if (name === 'visitor_privacy_metadata') return 'YouTube cookie used to store privacy and consent metadata.';
  if (name === 'cookieyes-consent') return 'CookieYes consent cookie used to store the visitor cookie preferences.';
  if (name.includes('moneypenny')) return 'Moneypenny live chat cookie used for chat session or visitor state.';
  if (domain.includes('yoshki')) return 'Yoshki / SRA badge resource. Cookie not always set; service should still be disclosed as a third-party embed.';

  return '';
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
  const data = await page.evaluate(() => {
    return {
      scripts: Array.from(document.querySelectorAll('script[src]')).map(el => el.src),
      iframes: Array.from(document.querySelectorAll('iframe[src]')).map(el => el.src),
      images: Array.from(document.querySelectorAll('img[src]')).map(el => el.src),
      links: Array.from(document.querySelectorAll('link[href]')).map(el => el.href)
    };
  }).catch(() => ({
    scripts: [],
    iframes: [],
    images: [],
    links: []
  }));

  const resources = [];

  for (const [type, urls] of Object.entries(data)) {
    for (const url of urls) {
      const cleaned = cleanUrl(url);
      if (!cleaned) continue;

      resources.push({
        type,
        url: cleaned,
        domain: getHost(cleaned),
        provider: guessProvider(cleaned),
        thirdParty: !sameSite(cleaned, rootHost),
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

  const patterns = mode === 'accept'
    ? ['accept all', 'accept', 'agree', 'allow all', 'ok', 'got it']
    : ['reject all', 'reject', 'decline', 'deny', 'necessary only'];

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

async function triggerLazyLoadedServices(page) {
  await page.waitForTimeout(3000);

  await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    window.scrollTo(0, 0);
    await wait(500);

    window.scrollTo(0, Math.floor(document.body.scrollHeight / 3));
    await wait(1000);

    window.scrollTo(0, Math.floor(document.body.scrollHeight / 2));
    await wait(1000);

    window.scrollTo(0, document.body.scrollHeight);
    await wait(2500);

    window.scrollTo(0, 0);
    await wait(800);
  }).catch(() => {});
}

async function launchBrowser() {
  return chromium.launch({
    channel: 'chrome',
    headless: true
  });
}

function createNetworkTracker() {
  const requestById = new Map();
  const responseByUrl = new Map();
  const requestCountByUrl = new Map();

  function getInitiatorType(initiator) {
    if (!initiator) return 'unknown';
    if (initiator.type) return initiator.type;
    return 'unknown';
  }

  function getInitiatorSource(initiator) {
    if (!initiator) return '';

    if (initiator.url) return initiator.url;

    if (Array.isArray(initiator.stack?.callFrames)) {
      const frame = initiator.stack.callFrames.find(f => f.url);
      if (frame) return frame.url;
    }

    return '';
  }

  async function attach(page) {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');

    client.on('Network.requestWillBeSent', event => {
      const url = cleanUrl(event.request?.url);
      if (!url) return;

      requestById.set(event.requestId, {
        requestId: event.requestId,
        url,
        method: event.request?.method || '',
        initiator: getInitiatorType(event.initiator),
        sourceUrl: getInitiatorSource(event.initiator),
        timestamp: event.timestamp
      });

      requestCountByUrl.set(url, (requestCountByUrl.get(url) || 0) + 1);
    });

    client.on('Network.responseReceived', event => {
      const request = requestById.get(event.requestId);
      const response = event.response;
      const url = cleanUrl(response?.url || request?.url);
      if (!url) return;

      responseByUrl.set(url, {
        url,
        status: response.status,
        mimeType: response.mimeType || '',
        remoteIPAddress: response.remoteIPAddress || '',
        remotePort: response.remotePort || '',
        protocol: response.protocol || '',
        fromDiskCache: response.fromDiskCache || false,
        fromServiceWorker: response.fromServiceWorker || false,
        headers: response.headers || {},
        initiator: request?.initiator || 'unknown',
        sourceUrl: request?.sourceUrl || '',
        method: request?.method || ''
      });
    });

    return client;
  }

  function getMetaForUrl(url) {
    const cleaned = cleanUrl(url);
    if (!cleaned) return {};

    const response = responseByUrl.get(cleaned) || {};

    return {
      initiator: response.initiator || 'unknown',
      sourceUrl: response.sourceUrl || '',
      serverIPAddress: response.remoteIPAddress || '',
      mimeType: response.mimeType || '',
      usedRequestCount: requestCountByUrl.get(cleaned) || 0,
      networkStatus: response.status || '',
      protocol: response.protocol || ''
    };
  }

  function allRequests(rootHost) {
    const rows = [];

    for (const [url, response] of responseByUrl.entries()) {
      rows.push({
        type: 'network-request',
        method: response.method || '',
        url,
        domain: getHost(url),
        provider: guessProvider(url),
        thirdParty: !sameSite(url, rootHost),
        status: response.status || '',
        mimeType: response.mimeType || '',
        serverIPAddress: response.remoteIPAddress || '',
        initiator: response.initiator || 'unknown',
        sourceUrl: response.sourceUrl || '',
        usedRequestCount: requestCountByUrl.get(url) || 0
      });
    }

    return rows;
  }

  return {
    attach,
    getMetaForUrl,
    allRequests
  };
}

async function scanWebsite(options, onProgress = () => {}) {
  const startUrl = normaliseUrl(options.url);
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || 1000), 10000));
  const consentMode = options.consentMode || 'none';

  const root = new URL(startUrl);
  const rootHost = root.hostname.replace(/^www\./, '').toLowerCase();
  const startedAt = new Date().toISOString();

  const browser = await launchBrowser();

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  const networkTracker = createNetworkTracker();
  await networkTracker.attach(page);

  const cookieMap = new Map();
  const resourceMap = new Map();

  const pages = [];
  const errors = [];
  const queue = [startUrl];
  const seen = new Set();

  try {
    const sitemapUrls = await collectSitemapUrls(context.request, startUrl, rootHost, maxPages);

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
        await triggerLazyLoadedServices(page);
        await page.waitForTimeout(5000);

        const cookies = await context.cookies();
        let pageCookieCount = 0;

        for (const cookie of cookies) {
          const classified = classifyCookie(cookie);
          const cookieDomainUrl = `https://${cookie.domain.replace(/^\./, '')}`;

          const bestNetworkMeta =
            networkTracker.getMetaForUrl(cookieDomainUrl) ||
            {};

          const enriched = {
            ...cookie,
            ...classified,
            provider: guessProvider(cookieDomainUrl),
            description: getCookieDescription(cookie),
            expiryLabel: getExpiryLabel(cookie),
            detectedOn: currentUrl,
            firstFound: currentUrl,
            firstParty: sameSite(cookieDomainUrl, rootHost),
            initiator: bestNetworkMeta.initiator || 'unknown',
            sourceUrl: bestNetworkMeta.sourceUrl || '',
            serverIPAddress: bestNetworkMeta.serverIPAddress || '',
            mimeType: bestNetworkMeta.mimeType || '',
            usedRequestCount: bestNetworkMeta.usedRequestCount || 0
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
          const meta = networkTracker.getMetaForUrl(item.url);

          const enrichedResource = {
            ...item,
            initiator: meta.initiator || 'unknown',
            sourceUrl: meta.sourceUrl || '',
            serverIPAddress: meta.serverIPAddress || '',
            mimeType: meta.mimeType || '',
            usedRequestCount: meta.usedRequestCount || 0,
            networkStatus: meta.networkStatus || '',
            protocol: meta.protocol || ''
          };

          const key = resourceKey(enrichedResource);

          if (!resourceMap.has(key)) {
            resourceMap.set(key, {
              ...enrichedResource,
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

        const networkRequests = networkTracker.allRequests(rootHost);
        const thirdPartyNetworkRequestsFound = networkRequests.filter(r => r.thirdParty).length;

        pageRecord.status = response ? response.status() : 'loaded';
        pageRecord.cookiesFound = pageCookieCount;
        pageRecord.newLinksFound = added;
        pageRecord.thirdPartyResourcesFound = thirdPartyResourcesFound;
        pageRecord.thirdPartyNetworkRequestsFound = thirdPartyNetworkRequestsFound;
      } catch (error) {
        pageRecord.status = 'error';
        pageRecord.error = error.message;
        errors.push({ url: currentUrl, error: error.message });
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

  const networkRequests = networkTracker.allRequests(rootHost).sort((a, b) =>
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
        imagesFound: 0,
        linksFound: 0,
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
    const service = thirdPartyServicesMap.get(resource.provider);
    if (!service) continue;

    if (resource.type === 'scripts') service.scriptsFound += 1;
    if (resource.type === 'iframes') service.iframesFound += 1;
    if (resource.type === 'images') service.imagesFound += 1;
    if (resource.type === 'links') service.linksFound += 1;

    for (const p of resource.pagesDetected || []) {
      if (!service.pagesDetected.includes(p)) service.pagesDetected.push(p);
    }
  }

  for (const request of thirdPartyNetworkRequests) {
    const service = thirdPartyServicesMap.get(request.provider);
    if (service) service.networkRequestsFound += 1;
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
