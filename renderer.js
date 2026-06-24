let latestResult = null;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));

window.cookieScanner.onProgress((p) => {
  $('status').textContent = `Scanning ${p.currentUrl} — scanned ${p.scanned}, queued ${p.queued}`;
});

$('scanBtn').addEventListener('click', async () => {
  const options = {
    url: $('url').value.trim(),
    maxPages: Number($('maxPages').value || 100),
    consentMode: $('consentMode').value
  };
  if (!options.url) return;

  $('scanBtn').disabled = true;
  $('status').textContent = 'Starting Chromium scan...';
  try {
    latestResult = await window.cookieScanner.startScan(options);
    render(latestResult);
    $('status').textContent = `Complete. Scanned ${latestResult.scannedPageCount} pages and found ${latestResult.cookieCount} unique cookies.`;
  } catch (error) {
    $('status').textContent = `Scan failed: ${error.message}`;
  } finally {
    $('scanBtn').disabled = false;
  }
});

$('jsonBtn').addEventListener('click', async () => {
  if (!latestResult) return;
  await window.cookieScanner.saveFile({
    defaultPath: `cookie-audit-${latestResult.rootHost}.json`,
    content: JSON.stringify(latestResult, null, 2),
    type: 'json'
  });
});

$('csvBtn').addEventListener('click', async () => {
  if (!latestResult) return;
  await window.cookieScanner.saveFile({
    defaultPath: `cookie-audit-${latestResult.rootHost}.csv`,
    content: toCsv(latestResult.cookies),
    type: 'csv'
  });
});

function render(result) {
  $('actions').classList.remove('hidden');
  $('categoryPanel').classList.remove('hidden');
  $('pagesPanel').classList.remove('hidden');
  $('cookiesPanel').classList.remove('hidden');

  $('summaryCards').innerHTML = [
    ['Pages scanned', result.scannedPageCount],
    ['Unique cookies', result.cookieCount],
    ['Queued links left', result.discoveredQueueCount],
    ['Errors', result.errors.length]
  ].map(([label, value]) => `<div class="card"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div>`).join('');

  $('categories').innerHTML = Object.entries(result.categoryCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([cat, count]) => `<div class="category"><strong>${esc(count)}</strong><span>${esc(cat)}</span></div>`).join('') || '<p>No cookies found.</p>';

  renderTable('pagesTable', ['URL', 'Status', 'Cookies', 'New links'], result.pages.map(p => [p.url, p.status, p.cookiesFound, p.newLinksFound]));
  renderTable('cookiesTable', ['Name', 'Domain', 'Category', 'Confidence', 'Secure', 'HttpOnly', 'SameSite', 'Detected on'], result.cookies.map(c => [
    c.name,
    c.domain,
    `<span class="badge">${esc(c.category)}</span>`,
    c.confidence,
    c.secure,
    c.httpOnly,
    c.sameSite,
    c.detectedOn
  ]), true);
}

function renderTable(id, headers, rows, allowHtml = false) {
  const head = `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${allowHtml ? cell : esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $(id).innerHTML = head + body;
}

function toCsv(cookies) {
  const headers = ['name','domain','path','category','confidence','reason','secure','httpOnly','sameSite','expires','detectedOn','firstParty'];
  const lines = [headers.join(',')];
  for (const c of cookies) {
    lines.push(headers.map(h => csvCell(c[h])).join(','));
  }
  return lines.join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
