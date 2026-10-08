/* ── STATE ─────────────────────────────────────────────────────── */
let activeSetId        = null;
let activeTransactions = [];
let priceTol           = 2.0;
let qtyTol             = 2.0;
let activeFilter       = 'all';

/* ── DOM REFS ──────────────────────────────────────────────────── */
const setList          = document.getElementById('setList');
const newSetBtn        = document.getElementById('newSetBtn');
const newSetForm       = document.getElementById('newSetForm');
const newSetName       = document.getElementById('newSetName');
const createSetBtn     = document.getElementById('createSetBtn');
const cancelSetBtn     = document.getElementById('cancelSetBtn');
const uploadSetLabel   = document.getElementById('uploadSetLabel');
const priceSlider      = document.getElementById('priceSlider');
const priceVal         = document.getElementById('priceVal');
const qtySlider        = document.getElementById('qtySlider');
const qtyVal           = document.getElementById('qtyVal');
const summaryRow       = document.getElementById('summaryRow');
const filterAll        = document.getElementById('filterAll');
const filterPerfect    = document.getElementById('filterPerfect');
const filterTolerance  = document.getElementById('filterTolerance');
const filterVariance   = document.getElementById('filterVariance');
const filterMissing    = document.getElementById('filterMissing');
const countAll         = document.getElementById('countAll');
const countPerfect     = document.getElementById('countPerfect');
const countTolerance   = document.getElementById('countTolerance');
const countVariance    = document.getElementById('countVariance');
const countMissing     = document.getElementById('countMissing');
const exportBtn        = document.getElementById('exportBtn');
const tableSearch      = document.getElementById('tableSearch');
const tableToolbar     = document.getElementById('tableToolbar');
const emptyNoSet       = document.getElementById('emptyNoSet');
const emptyNoUploads   = document.getElementById('emptyNoUploads');
const realTable        = document.getElementById('realTable');
const matchTableBody   = document.getElementById('matchTableBody');
const detailOverlay    = document.getElementById('detailOverlay');
const matchCards       = document.getElementById('matchCards');
const modalTxnId       = document.getElementById('modalTxnId');
const modalVendor      = document.getElementById('modalVendor');
const modalDiscNote    = document.getElementById('modalDiscNote');
const modalStatusBadge = document.getElementById('modalStatusBadge');
const modalClose       = document.getElementById('modalClose');

/* ── HELPERS ───────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n)     { return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(d) { if (!d) return '—'; const p = d.split('-'); return p.length===3 ? `${p[1]}/${p[2]}/${p[0]}` : d; }

/* ── FUZZY VENDOR MATCHING ─────────────────────────────────────── */
function normalizeVendor(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .replace(/\b(ltd|inc|corp|llc|co|gmbh|plc|pty|ag|bv|sa|sas|nv|ab|oy|as|pvt|limited|incorporated)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function vendorSimilar(a, b) {
  if (!a || !b) return true;           // can't compare — treat as OK
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;  // one is a substring of the other
  // word-overlap similarity
  const words = s => new Set(s.split(' ').filter(w => w.length > 1));
  const wa = words(na), wb = words(nb);
  const common = [...wa].filter(w => wb.has(w)).length;
  const total  = Math.max(wa.size, wb.size);
  return total === 0 || (common / total) >= 0.5;
}

/* ── VARIANCE LOGIC ────────────────────────────────────────────── */
function priceVarPct(txn) {
  if (!txn.has_po || !txn.has_inv || !(txn.po_price > 0)) return 0;
  return Math.abs(txn.inv_price - txn.po_price) / txn.po_price * 100;
}
function qtyVarPct(txn) {
  if (!txn.has_po || !txn.has_grn || !(txn.po_qty > 0)) return 0;
  return Math.abs(txn.grn_qty - txn.po_qty) / txn.po_qty * 100;
}

function getStatus(txn) {
  if (!txn.has_grn) return 'missing';
  const pv = priceVarPct(txn);
  const qv = qtyVarPct(txn);
  if (pv > priceTol || qv > qtyTol) return 'variance';
  if (pv > 0 || qv > 0) return 'within_tol';   // diff exists but within threshold
  return 'match';                                 // 100% identical
}

function discNote(txn) {
  if (!txn.has_grn) return { text: 'GRN is missing — cannot complete 3-way match.', type: 'missing' };
  const pv = priceVarPct(txn), qv = qtyVarPct(txn);
  const parts = [];
  if (pv > 0 && pv <= priceTol) parts.push(`Price Δ ${pv.toFixed(2)}% — within ${priceTol}% tolerance`);
  else if (pv > priceTol)       parts.push(`Price Δ ${pv.toFixed(2)}% — exceeds ${priceTol}% tolerance`);
  if (qv > 0 && qv <= qtyTol)   parts.push(`Qty Δ ${qv.toFixed(2)}% — within ${qtyTol}% tolerance`);
  else if (qv > qtyTol)         parts.push(`Qty Δ ${qv.toFixed(2)}% — exceeds ${qtyTol}% tolerance`);
  return parts.length ? { text: parts.join(' · '), type: pv > priceTol || qv > qtyTol ? 'variance' : 'tol' } : null;
}

function isHi(txn, doc, field) {
  if (!txn.has_grn) return false;
  if (field === 'price' && priceVarPct(txn) > 0 && (doc === 'po' || doc === 'inv')) return true;
  if (field === 'qty'   && qtyVarPct(txn)   > 0 && (doc === 'grn' || doc === 'po')) return true;
  return false;
}

/* ── STATUS BADGE ──────────────────────────────────────────────── */
function badgeHtml(st) {
  const chk = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
  const wrn = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const x   = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  if (st === 'match')       return `<span class="badge badge-ok">${chk} Perfect Match</span>`;
  if (st === 'within_tol')  return `<span class="badge badge-tol">${chk} Match within tolerance</span>`;
  if (st === 'variance')    return `<span class="badge badge-flag">${wrn} Mismatch / Variance</span>`;
  return                           `<span class="badge badge-severe">${x} Missing Document</span>`;
}

/* ── RENDER TABLE ──────────────────────────────────────────────── */
function renderTable() {
  if (!activeSetId) {
    emptyNoSet.classList.remove('d-none');
    emptyNoUploads.classList.add('d-none');
    realTable.classList.add('d-none');
    tableToolbar.style.display = 'none';
    summaryRow.classList.add('d-none');
    return;
  }
  if (!activeTransactions.length) {
    emptyNoSet.classList.add('d-none');
    emptyNoUploads.classList.remove('d-none');
    realTable.classList.add('d-none');
    tableToolbar.style.display = 'none';
    summaryRow.classList.add('d-none');
    return;
  }
  emptyNoSet.classList.add('d-none');
  emptyNoUploads.classList.add('d-none');
  realTable.classList.remove('d-none');
  tableToolbar.style.display = '';
  summaryRow.classList.remove('d-none');

  const q = (tableSearch.value || '').trim().toLowerCase();
  let nMatch = 0, nTol = 0, nVar = 0, nMiss = 0;
  let html = '';

  activeTransactions.forEach(txn => {
    const st = getStatus(txn);
    if (st === 'match')      nMatch++;
    if (st === 'within_tol') nTol++;
    if (st === 'variance')   nVar++;
    if (st === 'missing')    nMiss++;

    // filter
    if (activeFilter === 'match'      && st !== 'match')      return;
    if (activeFilter === 'within_tol' && st !== 'within_tol') return;
    if (activeFilter === 'variance'   && st !== 'variance')   return;
    if (activeFilter === 'missing'    && st !== 'missing')    return;

    const hay = `${txn.transaction_id} ${txn.vendor} ${txn.po_ref||''} ${txn.grn_ref||''} ${txn.inv_ref||''}`.toLowerCase();
    if (q && !hay.includes(q)) return;

    const rowCls = st === 'within_tol' ? 'row-tol'
                 : st === 'variance'   ? 'row-variance'
                 : st === 'missing'    ? 'row-missing' : '';
    const grnCell = txn.has_grn
      ? esc(txn.grn_ref || '—')
      : '<span class="match-ref-missing">missing</span>';

    html += `<tr class="${rowCls}" data-id="${esc(txn.transaction_id)}" style="cursor:pointer">
      <td><strong>${esc(txn.transaction_id)}</strong></td>
      <td>${esc(txn.vendor || '—')}</td>
      <td>${esc(txn.po_ref  || (txn.has_po  ? '—' : ''))}</td>
      <td>${grnCell}</td>
      <td>${esc(txn.inv_ref || (txn.has_inv ? '—' : ''))}</td>
      <td>${badgeHtml(st)}</td>
      <td><svg class="row-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></td>
    </tr>`;
  });

  matchTableBody.innerHTML = html ||
    '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--color-text-muted)">No transactions match the current filter.</td></tr>';

  countAll.textContent       = activeTransactions.length;
  countPerfect.textContent   = nMatch;
  countTolerance.textContent = nTol;
  countVariance.textContent  = nVar;
  countMissing.textContent   = nMiss;

  matchTableBody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

/* ── LOAD TRANSACTIONS ─────────────────────────────────────────── */
async function loadTransactions(setId) {
  try {
    const res  = await fetch(`/api/match-sets/${setId}/transactions`);
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to load', 'error'); return; }
    activeTransactions = data;
    activeFilter = 'all';
    document.querySelectorAll('.match-pill').forEach(b => b.classList.remove('active'));
    filterAll.classList.add('active');
    tableSearch.value = '';
    renderTable();
  } catch (e) {
    showToast('Network error loading transactions', 'error');
  }
}

/* ── SET LIST ──────────────────────────────────────────────────── */
newSetBtn.addEventListener('click', () => {
  newSetForm.style.display = newSetForm.style.display === 'none' ? 'block' : 'none';
  if (newSetForm.style.display !== 'none') newSetName.focus();
});
cancelSetBtn.addEventListener('click', () => { newSetForm.style.display = 'none'; newSetName.value = ''; });
newSetName.addEventListener('keydown', e => { if (e.key === 'Enter') createSetBtn.click(); });

createSetBtn.addEventListener('click', async () => {
  const name = newSetName.value.trim();
  if (!name) return;
  createSetBtn.disabled = true;
  try {
    const res  = await fetch('/api/match-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error creating set', 'error'); return; }
    document.getElementById('noSetsMsg')?.remove();
    newSetForm.style.display = 'none';
    newSetName.value = '';
    activateSet(data.id, name, appendSetItem(data.id, name));
  } finally {
    createSetBtn.disabled = false;
  }
});

function appendSetItem(id, name) {
  const div = document.createElement('div');
  div.className    = 'session-item';
  div.dataset.setId = id;
  div.innerHTML    = `
    <span class="session-dot"></span>
    <div class="session-item-info">
      <span class="session-item-name">${esc(name)}</span>
      <span class="session-item-meta">${new Date().toISOString().slice(0,10)}</span>
    </div>
    <button class="btn btn-danger btn-sm session-delete-btn" data-set-id="${id}">Delete</button>`;
  div.querySelector('.session-delete-btn').addEventListener('click', e => {
    e.stopPropagation(); confirmDelete(id, name, div);
  });
  div.addEventListener('click', () => activateSet(id, name, div));
  setList.prepend(div);
  return div;
}

function activateSet(id, name, el) {
  activeSetId = id;
  setList.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  uploadSetLabel.textContent = name;
  enableUploadZones(true);
  resetZoneStates();
  loadTransactions(id);
}

async function confirmDelete(id, name, el) {
  if (!confirm(`Delete match set "${name}" and all its transactions?`)) return;
  const res = await fetch(`/api/match-sets/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  el.remove();
  if (!setList.querySelector('.session-item'))
    setList.innerHTML = '<div class="session-empty-msg" id="noSetsMsg">No sets yet — create one to get started.</div>';
  if (activeSetId === id) {
    activeSetId = null; activeTransactions = [];
    uploadSetLabel.textContent = 'No set selected';
    enableUploadZones(false); resetZoneStates(); renderTable();
  }
  showToast(`"${name}" deleted`, 'default');
}

setList.querySelectorAll('.session-item[data-set-id]').forEach(el => {
  const id   = parseInt(el.dataset.setId);
  const name = el.querySelector('.session-item-name')?.textContent || '';
  el.addEventListener('click', () => activateSet(id, name, el));
  el.querySelector('.session-delete-btn')?.addEventListener('click', e => {
    e.stopPropagation(); confirmDelete(id, name, el);
  });
});

/* ── UPLOAD ZONES ──────────────────────────────────────────────── */
function enableUploadZones(on) {
  ['poZone','grnZone','invoiceZone'].forEach(id => {
    document.getElementById(id).classList.toggle('upload-doc-disabled', !on);
  });
}

function resetZoneStates() {
  ['poZone','grnZone','invoiceZone'].forEach(id => {
    document.getElementById(id).classList.remove('success','uploading','dragover','doc-error');
  });
  ['poStatus','grnStatus','invoiceStatus'].forEach(id => {
    const s = document.getElementById(id);
    s.innerHTML = '';
    s.classList.add('d-none');
  });
}

function setZoneOk(zone, status, msg) {
  zone.classList.remove('uploading','doc-error');
  zone.classList.add('success');
  status.classList.remove('d-none');
  status.innerHTML = `<span style="color:#16a34a">✓ ${esc(msg)}</span>`;
}

function setZoneError(zone, status, msg) {
  zone.classList.remove('uploading','success');
  zone.classList.add('doc-error');
  status.classList.remove('d-none');
  status.innerHTML = `<span style="color:#dc2626">✗ ${esc(msg)}</span>`;
}

function wireZone(docType, zoneId, fileId, statusId) {
  const zone   = document.getElementById(zoneId);
  const input  = document.getElementById(fileId);
  const status = document.getElementById(statusId);

  zone.addEventListener('click',     () => { if (!activeSetId) return; input.click(); });
  zone.addEventListener('dragover',   e => { if (!activeSetId) return; e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave',  () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (!activeSetId) return;
    const file = e.dataTransfer.files[0];
    if (file) triggerUpload(input, file);
  });

  input.addEventListener('change', async () => {
    if (!input.files[0] || !activeSetId) return;
    zone.classList.remove('success','doc-error');
    zone.classList.add('uploading');
    status.innerHTML = '<span>Uploading…</span>';
    status.classList.remove('d-none');

    const fd = new FormData();
    fd.append('file', input.files[0]);
    fd.append('doc_type', docType);

    try {
      const res  = await fetch(`/api/match-sets/${activeSetId}/upload`, { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        if (data.type_mismatch) {
          setZoneError(zone, status, data.error);
          showToast('Wrong file in this zone — see upload box for details', 'error');
        } else if (data.pdf_parse_failed) {
          setZoneError(zone, status, 'PDF could not be parsed. Use a CSV export for reliable results.');
          showToast('PDF parsing failed', 'error');
        } else {
          setZoneError(zone, status, data.error || 'Upload failed');
          showToast(data.error || 'Upload failed', 'error');
        }
        return;
      }

      const suffix = data.is_pdf ? ' (PDF — verify fields in table)' : '';
      setZoneOk(zone, status, `${data.count} row${data.count !== 1 ? 's' : ''} loaded${suffix}`);
      await loadTransactions(activeSetId);
      showToast(`${DOC_LABELS[docType]} uploaded — ${data.count} record${data.count !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      setZoneError(zone, status, err.message);
      showToast('Upload failed: ' + err.message, 'error');
    }
    input.value = '';
  });
}

function triggerUpload(input, file) {
  try {
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  } catch (_) {}
}

const DOC_LABELS = { po: 'Purchase Orders', grn: 'Goods Received Notes', invoice: 'Supplier Invoices' };

wireZone('po',      'poZone',      'poFile',      'poStatus');
wireZone('grn',     'grnZone',     'grnFile',     'grnStatus');
wireZone('invoice', 'invoiceZone', 'invoiceFile', 'invoiceStatus');

/* ── TOLERANCE SLIDERS ─────────────────────────────────────────── */
priceSlider.addEventListener('input', () => { priceTol = parseFloat(priceSlider.value); priceVal.textContent = priceSlider.value; renderTable(); });
qtySlider.addEventListener('input',   () => { qtyTol   = parseFloat(qtySlider.value);  qtyVal.textContent   = qtySlider.value;   renderTable(); });

/* ── FILTER PILLS ──────────────────────────────────────────────── */
const PILL_MAP = { all: filterAll, match: filterPerfect, within_tol: filterTolerance, variance: filterVariance, missing: filterMissing };

function setFilter(f) {
  activeFilter = f;
  Object.values(PILL_MAP).forEach(b => b.classList.remove('active'));
  (PILL_MAP[f] || filterAll).classList.add('active');
  renderTable();
}

filterAll.addEventListener('click',       () => setFilter('all'));
filterPerfect.addEventListener('click',   () => setFilter('match'));
filterTolerance.addEventListener('click', () => setFilter('within_tol'));
filterVariance.addEventListener('click',  () => setFilter('variance'));
filterMissing.addEventListener('click',   () => setFilter('missing'));
tableSearch.addEventListener('input', renderTable);

/* ── CSV EXPORT ────────────────────────────────────────────────── */
exportBtn.addEventListener('click', () => {
  const flagged = activeTransactions.filter(t => getStatus(t) !== 'match');
  if (!flagged.length) { showToast('No exceptions — all transactions are 100% perfect matches.', 'default'); return; }

  const rows = [['Transaction ID','Vendor','Status','PO Ref','GRN Ref','Invoice Ref',
    'PO Qty','GRN Qty','Invoice Qty','PO Unit Price','Invoice Unit Price',
    'Price Δ%','Qty Δ%','Note']];

  flagged.forEach(txn => {
    const st   = getStatus(txn);
    const pv   = (txn.has_po && txn.has_inv) ? priceVarPct(txn).toFixed(2) : '—';
    const qv   = (txn.has_po && txn.has_grn) ? qtyVarPct(txn).toFixed(2)   : '—';
    const note = discNote(txn);
    const stLabel = st === 'within_tol' ? 'Match within tolerance'
                  : st === 'variance'   ? 'Mismatch / Variance'
                  : 'Missing Document';
    rows.push([
      txn.transaction_id, txn.vendor || '',
      stLabel,
      txn.po_ref  || '—', txn.grn_ref || (txn.has_grn ? '—' : 'MISSING'), txn.inv_ref || '—',
      txn.po_qty  ?? '—', txn.grn_qty ?? (txn.has_grn ? '—' : 'MISSING'), txn.inv_qty ?? '—',
      txn.po_price  != null ? '$'+fmt(txn.po_price)  : '—',
      txn.inv_price != null ? '$'+fmt(txn.inv_price) : '—',
      pv, qv, note ? note.text : '',
    ]);
  });

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `exception_report_${new Date().toISOString().slice(0,10)}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exception report downloaded — ${flagged.length} item${flagged.length>1?'s':''}`, 'success');
});

/* ── MODAL ─────────────────────────────────────────────────────── */
const ICONS = {
  po:  () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  grn: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  inv: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
};

function vendorField(txnVendor, docVendor) {
  if (!docVendor) return esc(txnVendor || '—');
  const similar = vendorSimilar(txnVendor, docVendor);
  if (similar) return esc(docVendor);
  // Names differ meaningfully — show with warning
  return `<span class="mfv hi" title="Vendor name differs from other documents">${esc(docVendor)} ⚠</span>`;
}

const CARD_DEFS = [
  {
    key:'po',  label:'Purchase Order',      cls:'po',      icon:ICONS.po,
    present: t => t.has_po,
    fields: [
      ['Vendor',     t => vendorField(t.vendor, t.po_vendor)],
      ['Reference',  t => esc(t.po_ref   || '—')],
      ['Date',       t => fmtDate(t.po_date)],
      ['Line Item',  t => esc(t.po_line_item || '—')],
      ['Quantity',   t => fv(Number(t.po_qty).toLocaleString(),  isHi(t,'po','qty'))],
      ['Unit Price', t => fv('$'+fmt(t.po_price),               isHi(t,'po','price'))],
      ['Buyer',      t => esc(t.po_buyer || '—')],
      ['Line Total', t => '$'+fmt(t.po_total)],
    ],
  },
  {
    key:'grn', label:'Goods Received Note', cls:'grn',     icon:ICONS.grn,
    present: t => t.has_grn,
    fields: [
      ['Vendor',      t => vendorField(t.vendor, t.grn_vendor)],
      ['Reference',   t => esc(t.grn_ref || '—')],
      ['Date',        t => fmtDate(t.grn_date)],
      ['Line Item',   t => esc(t.grn_line_item || '—')],
      ['Quantity',    t => fv(Number(t.grn_qty).toLocaleString(), isHi(t,'grn','qty'))],
      ['Received By', t => esc(t.grn_received_by || '—')],
      ['Line Total',  t => '$'+fmt(t.grn_total)],
    ],
  },
  {
    key:'inv', label:'Supplier Invoice',    cls:'invoice', icon:ICONS.inv,
    present: t => t.has_inv,
    fields: [
      ['Vendor',     t => vendorField(t.vendor, t.inv_vendor)],
      ['Reference',  t => esc(t.inv_ref   || '—')],
      ['Date',       t => fmtDate(t.inv_date)],
      ['Line Item',  t => esc(t.inv_line_item || '—')],
      ['Quantity',   t => esc(String(t.inv_qty ?? '—'))],
      ['Unit Price', t => fv('$'+fmt(t.inv_price), isHi(t,'inv','price'))],
      ['Due Date',   t => fmtDate(t.inv_due_date)],
      ['Line Total', t => '$'+fmt(t.inv_total)],
    ],
  },
];

function fv(val, hi) {
  return hi ? `<span class="mfv hi">${val}</span>` : `<span class="mfv">${val}</span>`;
}

function buildCard(txn, def) {
  if (!def.present(txn)) {
    return `<div class="match-card">
      <div class="match-card-hdr">
        <div class="match-card-icon ${def.cls}">${def.icon()}</div>
        <span class="match-card-title">${def.label}</span>
      </div>
      <div class="match-missing-body">
        <div class="missing-emoji">📭</div>
        <div class="missing-txt">No ${def.label} uploaded for this transaction.</div>
      </div>
    </div>`;
  }
  const fields = def.fields.map(([lbl, fn]) => {
    const html = fn(txn);
    const wrapped = html.startsWith('<span') ? html : `<span class="mfv">${html}</span>`;
    return `<div class="mf"><div class="mf-label">${lbl}</div>${wrapped}</div>`;
  }).join('');
  return `<div class="match-card">
    <div class="match-card-hdr">
      <div class="match-card-icon ${def.cls}">${def.icon()}</div>
      <span class="match-card-title">${def.label}</span>
    </div>
    <div class="match-card-body">${fields}</div>
  </div>`;
}

function openModal(txnId) {
  const txn = activeTransactions.find(t => t.transaction_id === txnId);
  if (!txn) return;
  const st   = getStatus(txn);
  const note = discNote(txn);

  modalTxnId.textContent      = txn.transaction_id;
  modalVendor.textContent     = txn.vendor || '';
  modalStatusBadge.innerHTML  = badgeHtml(st);
  if (note) {
    const tagCls = note.type === 'missing' ? ' missing-tag' : note.type === 'tol' ? ' tol-tag' : '';
    modalDiscNote.innerHTML = `<span class="modal-disc-tag${tagCls}">${esc(note.text)}</span>`;
  } else {
    modalDiscNote.innerHTML = '';
  }

  matchCards.innerHTML = CARD_DEFS.map(def => buildCard(txn, def)).join('');
  detailOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() { detailOverlay.classList.add('hidden'); document.body.style.overflow = ''; }
modalClose.addEventListener('click', closeModal);
detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── INIT ──────────────────────────────────────────────────────── */
enableUploadZones(false);
renderTable();
