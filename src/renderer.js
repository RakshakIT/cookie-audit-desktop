let latestReport = null;

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

function getApi() {
  if (window.cookieScanner?.startScan) return window.cookieScanner.startScan;
  if (window.api?.startScan) return window.api.startScan;
  if (window.electronAPI?.startScan) return window.electronAPI.startScan;
  if (window.cookieAudit?.startScan) return window.cookieAudit.startScan;
  if (window.scanner?.startScan) return window.scanner.startScan;
  return null;
}

function setStatus(message) {
  const status = $('status');
  if (status) status.textContent = message;
}

function renderSummary(report) {
  const categories = report.categoryCounts || {};

  return `
    <section class="panel">
      <h2>Summary</h2>
      <div class="cards">
        <div class="card"><div class="value">${esc(report.scannedPageCount || 0)}</div><div class="label">Pages scanned</div></div>
        <div class="card"><div class="value">${esc(report.cookieCount || 0)}</div><div class="label">Cookies found</div></div>
        <div class="card"><div class="value">${esc((report.thirdPartyServices || []).length)}</div><div class="label">Third-party services</div></div>
        <div class="card"><div class="value">${esc((report.thirdPartyDomains || []).length)}</div><div class="label">Third-party domains</div></div>
      </div>

      <h3>Cookie categories</h3>
      <div class="category-grid">
        ${Object.entries(categories).map(([category, count]) => `
          <div class="category">
            <strong>${esc(category)}</strong>
            <span>${esc(count)}</span>
          </div>
        `).join('')}
      </div>

      <p class="muted">${esc(report.auditLimits?.note || '')}</p>
    </section>
  `;
}

function renderPages(report) {
  const pages = report.pages || [];

  return `
    <section class="panel">
      <h2>Pages scanned</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Status</th>
              <th>Cookies</th>
              <th>New links</th>
              <th>Third-party resources</th>
              <th>Third-party requests</th>
            </tr>
          </thead>
          <tbody>
            ${pages.map(p => `
              <tr>
                <td>${esc(p.url)}</td>
                <td>${esc(p.status)}</td>
                <td>${esc(p.cookiesFound)}</td>
                <td>${esc(p.newLinksFound)}</td>
                <td>${esc(p.thirdPartyResourcesFound)}</td>
                <td>${esc(p.thirdPartyNetworkRequestsFound)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCookies(report) {
  const cookies = report.cookies || [];

  return `
    <section class="panel">
      <h2>Cookies</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider</th>
              <th>Domain</th>
              <th>Category</th>
              <th>Confidence</th>
              <th>Expiry</th>
              <th>First found</th>
              <th>Pages found</th>
              <th>Initiator</th>
              <th>Source URL</th>
              <th>Server IP</th>
              <th>MIME</th>
              <th>Used requests</th>
              <th>HttpOnly</th>
              <th>Secure</th>
              <th>SameSite</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${cookies.map(c => `
              <tr>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.provider)}</td>
                <td>${esc(c.domain)}</td>
                <td><span class="badge">${esc(c.category)}</span></td>
                <td>${esc(c.confidence)}</td>
                <td>${esc(c.expiryLabel || c.expires)}</td>
                <td>${esc(c.firstFound || c.detectedOn)}</td>
                <td>${esc((c.pagesDetected || []).length)}</td>
                <td>${esc(c.initiator)}</td>
                <td>${esc(c.sourceUrl)}</td>
                <td>${esc(c.serverIPAddress)}</td>
                <td>${esc(c.mimeType)}</td>
                <td>${esc(c.usedRequestCount)}</td>
                <td>${esc(c.httpOnly)}</td>
                <td>${esc(c.secure)}</td>
                <td>${esc(c.sameSite)}</td>
                <td>${esc(c.description)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderThirdPartyServices(report) {
  const services = report.thirdPartyServices || [];

  return `
    <section class="panel">
      <h2>Third-party services</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Domains</th>
              <th>Cookies</th>
              <th>Scripts</th>
              <th>Iframes</th>
              <th>Images</th>
              <th>Links</th>
              <th>Network requests</th>
              <th>Pages detected</th>
            </tr>
          </thead>
          <tbody>
            ${services.map(s => `
              <tr>
                <td><strong>${esc(s.provider)}</strong></td>
                <td>${esc((s.domains || []).join(', '))}</td>
                <td>${esc(s.cookiesFound || 0)}</td>
                <td>${esc(s.scriptsFound || 0)}</td>
                <td>${esc(s.iframesFound || 0)}</td>
                <td>${esc(s.imagesFound || 0)}</td>
                <td>${esc(s.linksFound || 0)}</td>
                <td>${esc(s.networkRequestsFound || 0)}</td>
                <td>${esc((s.pagesDetected || []).length)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderResources(title, rows) {
  return `
    <section class="panel">
      <h2>${esc(title)}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Provider</th>
              <th>Domain</th>
              <th>URL</th>
              <th>Third party</th>
              <th>Initiator</th>
              <th>Source URL</th>
              <th>Server IP</th>
              <th>MIME</th>
              <th>Status</th>
              <th>Used requests</th>
              <th>Detected on</th>
            </tr>
          </thead>
          <tbody>
            ${(rows || []).map(r => `
              <tr>
                <td>${esc(r.type)}</td>
                <td>${esc(r.provider)}</td>
                <td>${esc(r.domain)}</td>
                <td>${esc(r.url)}</td>
                <td>${esc(r.thirdParty)}</td>
                <td>${esc(r.initiator)}</td>
                <td>${esc(r.sourceUrl)}</td>
                <td>${esc(r.serverIPAddress)}</td>
                <td>${esc(r.mimeType)}</td>
                <td>${esc(r.networkStatus || r.status)}</td>
                <td>${esc(r.usedRequestCount)}</td>
                <td>${esc(r.detectedOn)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderErrors(report) {
  const errors = report.errors || [];
  if (!errors.length) return '';

  return `
    <section class="panel">
      <h2>Errors</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${errors.map(e => `
              <tr>
                <td>${esc(e.url)}</td>
                <td>${esc(e.error)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRaw(report) {
  return `
    <section class="panel">
      <h2>Raw JSON</h2>
      <details>
        <summary>Show raw report</summary>
        <pre>${esc(JSON.stringify(report, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderReport(report) {
  const output = $('output') || $('results') || $('report');

  if (!output) {
    console.error('No output container found. Add <div id="output"></div> to renderer.html.');
    return;
  }

  output.innerHTML = `
    ${renderSummary(report)}
    ${renderPages(report)}
    ${renderCookies(report)}
    ${renderThirdPartyServices(report)}
    ${renderResources('Third-party resources', report.thirdPartyResources || [])}
    ${renderResources('Network requests', report.networkRequests || [])}
    ${renderErrors(report)}
    ${renderRaw(report)}
  `;
}

async function startScan() {
  const url = $('url')?.value?.trim();
  const maxPages = $('maxPages')?.value || 1000;
  const consentMode = $('consentMode')?.value || 'none';

  if (!url) {
    setStatus('Enter a website URL first.');
    return;
  }

  const scanApi = getApi();

  if (!scanApi) {
    setStatus('Scanner API not found. Check preload.js and main.js IPC setup.');
    return;
  }

  setStatus('Scanning. This may take several minutes...');
  const output = $('output') || $('results') || $('report');
  if (output) output.innerHTML = '';

  try {
    const report = await scanApi({
      url,
      maxPages: Number(maxPages),
      consentMode
    });

    latestReport = report;

    setStatus(
      `Scan complete. ${report.scannedPageCount || 0} pages scanned, ${report.cookieCount || 0} cookies found, ${(report.thirdPartyServices || []).length} third-party services detected.`
    );

    renderReport(report);
  } catch (error) {
    console.error(error);
    setStatus(`Scan failed: ${error.message || error}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const runButton =
    $('runScan') ||
    $('scanButton') ||
    $('startScan') ||
    document.querySelector('button');

  if (runButton) {
    runButton.addEventListener('click', startScan);
  }

  if (window.cookieScanner?.onProgress) {
    window.cookieScanner.onProgress(progress => {
      setStatus(
        `Scanning: ${progress.scanned || 0} pages done, ${progress.queued || 0} queued — ${progress.currentUrl || ''}`
      );
    });
  }

  const urlInput = $('url');

  if (urlInput) {
    if (urlInput.value && urlInput.value.includes('langleywellington')) {
      urlInput.value = '';
    }

    urlInput.placeholder = 'Enter website URL, e.g. https://example.com';
  }

  const maxPagesInput = $('maxPages');

  if (maxPagesInput) {
    if (!maxPagesInput.value || maxPagesInput.value === '100') {
      maxPagesInput.value = '1000';
    }

    maxPagesInput.min = '1';
    maxPagesInput.max = '10000';
  }

  setStatus('');
});
