/* ── STATE ─────────────────────────────────────────────────────── */
let activeSetId = null;
let activeSetData = null;

/* ── DOM REFS ──────────────────────────────────────────────────── */
const setList          = document.getElementById('setList');
const newSetBtn        = document.getElementById('newSetBtn');
const newSetForm       = document.getElementById('newSetForm');
const newSetName       = document.getElementById('newSetName');
const createSetBtn     = document.getElementById('createSetBtn');
const cancelSetBtn     = document.getElementById('cancelSetBtn');
const uploadArea       = document.getElementById('uploadArea');
const fileInput        = document.getElementById('fileInput');
const uploadTitle      = document.getElementById('uploadTitle');
const uploadStatus     = document.getElementById('uploadStatus');
const uploadSetLabel   = document.getElementById('uploadSetLabel');
const addMappingRowBtn = document.getElementById('addMappingRowBtn');
const saveMappingsBtn  = document.getElementById('saveMappingsBtn');
const mappingBody      = document.getElementById('mappingBody');
const statsBar         = document.getElementById('statsBar');
const statDocs         = document.getElementById('statDocs');
const statTypes        = document.getElementById('statTypes');
const exportBtn        = document.getElementById('exportBtn');
const emptyState       = document.getElementById('emptyState');
const tableWrapper     = document.getElementById('tableWrapper');
const tableHead        = document.getElementById('tableHead');
const tableBody        = document.getElementById('tableBody');
const editModal        = document.getElementById('editModal');
const editModalTitle   = document.getElementById('editModalTitle');
const editModalValue   = document.getElementById('editModalValue');
const editModalSave    = document.getElementById('editModalSave');
const editModalClose   = document.getElementById('editModalClose');
const editModalCancel  = document.getElementById('editModalCancel');

let editingFieldId = null;

// Start disabled
uploadArea.classList.add('upload-disabled');

/* ── SET LIST ──────────────────────────────────────────────────── */
newSetBtn.addEventListener('click', () => {
  newSetForm.style.display = newSetForm.style.display === 'none' ? 'block' : 'none';
  if (newSetForm.style.display !== 'none') newSetName.focus();
});
cancelSetBtn.addEventListener('click', () => {
  newSetForm.style.display = 'none';
  newSetName.value = '';
});
newSetName.addEventListener('keydown', e => { if (e.key === 'Enter') createSetBtn.click(); });

createSetBtn.addEventListener('click', async () => {
  const name = newSetName.value.trim();
  if (!name) return;
  createSetBtn.disabled = true;
  try {
    const res = await fetch('/api/doc-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const ds = await res.json();
    if (!res.ok) { toast(ds.error || 'Error creating set', 'error'); return; }
    appendSetItem(ds);
    newSetForm.style.display = 'none';
    newSetName.value = '';
    document.getElementById('noSetsMsg')?.remove();
    activateSet(ds.id, name);
  } finally {
    createSetBtn.disabled = false;
  }
});

function appendSetItem(ds) {
  const div = document.createElement('div');
  div.className = 'session-item';
  div.dataset.setId = ds.id;
  div.innerHTML = `
    <span class="session-dot"></span>
    <div class="session-item-info">
      <span class="session-item-name">${escHtml(ds.name)}</span>
    </div>
    <button class="btn btn-danger btn-sm session-delete-btn" data-set-id="${ds.id}">Delete</button>`;
  div.querySelector('.session-delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteSet(ds.id, ds.name, div);
  });
  div.addEventListener('click', () => activateSet(ds.id, ds.name));
  setList.prepend(div);
}

// Wire up items already on page from server render
document.querySelectorAll('.session-item[data-set-id]').forEach(el => {
  const id = parseInt(el.dataset.setId);
  const name = el.querySelector('.session-item-name')?.textContent || '';
  el.addEventListener('click', () => activateSet(id, name));
  el.querySelector('.session-delete-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteSet(id, name, el);
  });
});

async function confirmDeleteSet(id, name, el) {
  if (!confirm(`Delete "${name}" and all its documents?`)) return;
  await fetch(`/api/doc-sets/${id}`, { method: 'DELETE' });
  el.remove();
  if (activeSetId === id) {
    activeSetId = null;
    activeSetData = null;
    clearUI();
  }
  toast('Document set deleted');
  if (!setList.querySelector('.session-item[data-set-id]')) {
    const msg = document.createElement('div');
    msg.className = 'session-empty-msg';
    msg.id = 'noSetsMsg';
    msg.textContent = 'No sets yet — create one to get started.';
    setList.appendChild(msg);
  }
}

async function activateSet(id, name) {
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.session-item[data-set-id="${id}"]`)?.classList.add('active');
  activeSetId = id;
  uploadSetLabel.textContent = name;
  uploadArea.classList.remove('upload-disabled');
  uploadTitle.textContent = 'Drop a file or click to browse';
  addMappingRowBtn.disabled = false;
  saveMappingsBtn.disabled = false;
  await loadSetData(id);
}

async function loadSetData(id) {
  const res = await fetch(`/api/doc-sets/${id}`);
  activeSetData = await res.json();
  renderMappings(activeSetData.custom_mappings || []);
  renderTable(activeSetData.documents || []);
}

function clearUI() {
  uploadSetLabel.textContent = 'No set selected';
  uploadArea.classList.add('upload-disabled');
  uploadTitle.textContent = 'Select a document set first';
  addMappingRowBtn.disabled = true;
  saveMappingsBtn.disabled = true;
  mappingBody.innerHTML = `<tr id="noMappingRow"><td colspan="3" style="text-align:center;color:var(--color-text-muted);font-size:12px;padding:10px">No custom mappings yet</td></tr>`;
  statsBar.style.display = 'none';
  emptyState.style.display = '';
  tableWrapper.style.display = 'none';
}

/* ── UPLOAD ────────────────────────────────────────────────────── */
uploadArea.addEventListener('click', () => {
  if (uploadArea.classList.contains('upload-disabled')) return;
  fileInput.click();
});
uploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  if (!uploadArea.classList.contains('upload-disabled')) uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (uploadArea.classList.contains('upload-disabled')) return;
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleUpload(fileInput.files[0]);
  fileInput.value = '';
});

async function handleUpload(file) {
  if (!activeSetId) { toast('Select a document set first', 'error'); return; }

  uploadArea.classList.add('upload-disabled');
  uploadArea.classList.add('uploading');
  uploadStatus.style.display = 'block';
  uploadStatus.innerHTML = `<span class="spinner"></span> Extracting fields from <strong>${escHtml(file.name)}</strong>&hellip;`;

  const form = new FormData();
  form.append('file', file);

  try {
    const res = await fetch(`/api/doc-sets/${activeSetId}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      uploadArea.classList.add('error');
      uploadStatus.innerHTML = `<span style="color:#dc2626">&#x2715; ${escHtml(data.error || 'Upload failed')}</span>`;
      toast(data.error || 'Upload failed', 'error');
    } else {
      uploadArea.classList.add('success');
      uploadStatus.innerHTML = `<span style="color:#16a34a">&#x2713; ${escHtml(file.name)} extracted</span>`;
      toast(`"${file.name}" extracted`);
      await loadSetData(activeSetId);
    }
  } catch (err) {
    uploadStatus.innerHTML = `<span style="color:#dc2626">&#x2715; Network error</span>`;
    toast('Network error', 'error');
  } finally {
    uploadArea.classList.remove('uploading', 'upload-disabled', 'success', 'error');
    setTimeout(() => { uploadStatus.style.display = 'none'; }, 3500);
  }
}

/* ── CUSTOM MAPPINGS ───────────────────────────────────────────── */
function renderMappings(mappings) {
  mappingBody.innerHTML = '';
  if (!mappings.length) {
    mappingBody.innerHTML = `<tr id="noMappingRow"><td colspan="3" style="text-align:center;color:var(--color-text-muted);font-size:12px;padding:10px">No custom mappings yet</td></tr>`;
    return;
  }
  mappings.forEach(m => addMappingRow(m.field_label, m.source_label));
}

function addMappingRow(fieldLabel = '', sourceLabel = '') {
  document.getElementById('noMappingRow')?.remove();
  const tr = document.createElement('tr');
  tr.className = 'mapping-row';
  tr.innerHTML = `
    <td><input type="text" placeholder="Your field name" value="${escHtml(fieldLabel)}"></td>
    <td><input type="text" placeholder="Field on document" value="${escHtml(sourceLabel)}"></td>
    <td><button class="mapping-row-del" title="Remove row">&times;</button></td>`;
  tr.querySelector('.mapping-row-del').addEventListener('click', () => {
    tr.remove();
    if (!mappingBody.querySelectorAll('.mapping-row').length) {
      mappingBody.innerHTML = `<tr id="noMappingRow"><td colspan="3" style="text-align:center;color:var(--color-text-muted);font-size:12px;padding:10px">No custom mappings yet</td></tr>`;
    }
  });
  mappingBody.appendChild(tr);
  tr.querySelector('input').focus();
}

addMappingRowBtn.addEventListener('click', () => { if (!addMappingRowBtn.disabled) addMappingRow(); });

saveMappingsBtn.addEventListener('click', async () => {
  if (!activeSetId) return;
  const rows = mappingBody.querySelectorAll('.mapping-row');
  const mappings = [];
  rows.forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const fl = inputs[0].value.trim();
    const sl = inputs[1].value.trim();
    if (fl && sl) mappings.push({ field_label: fl, source_label: sl });
  });
  const res = await fetch(`/api/doc-sets/${activeSetId}/custom-mappings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  });
  const data = await res.json();
  if (res.ok) {
    toast(`${data.saved} mapping(s) saved — upload next file to apply`);
  } else {
    toast('Error saving mappings', 'error');
  }
});

/* ── TABLE RENDERING ───────────────────────────────────────────── */
const TYPE_LABELS = {
  check: 'Check', invoice: 'Invoice', agreement: 'Agreement',
  bank_statement: 'Bank Statement', receipt: 'Receipt', other: 'Other',
};

function renderTable(docs) {
  if (!docs.length) {
    statsBar.style.display = 'none';
    emptyState.style.display = '';
    tableWrapper.style.display = 'none';
    return;
  }

  // Collect all field labels in order (defaults first, custom last)
  const allLabels = [];
  docs.forEach(doc => {
    (doc.fields || []).forEach(f => {
      if (!allLabels.includes(f.field_label)) allLabels.push(f.field_label);
    });
  });

  // Stats
  const typeCounts = {};
  docs.forEach(d => { typeCounts[d.doc_type] = (typeCounts[d.doc_type] || 0) + 1; });
  const typeStr = Object.entries(typeCounts)
    .map(([t, n]) => `${n} ${TYPE_LABELS[t] || t}`)
    .join(', ');
  statDocs.textContent = docs.length;
  statTypes.textContent = typeStr;
  statsBar.style.display = 'flex';
  emptyState.style.display = 'none';
  tableWrapper.style.display = '';

  // Header row
  tableHead.innerHTML = '';
  const trHead = document.createElement('tr');
  ['File', 'Type', ...allLabels].forEach(lbl => {
    const th = document.createElement('th');
    th.textContent = lbl;
    trHead.appendChild(th);
  });
  tableHead.appendChild(trHead);

  // Data rows
  tableBody.innerHTML = '';
  docs.forEach(doc => {
    const tr = document.createElement('tr');
    const fieldMap = {};
    (doc.fields || []).forEach(f => { fieldMap[f.field_label] = f; });

    // Filename
    const tdFile = document.createElement('td');
    tdFile.textContent = doc.filename;
    tdFile.style.fontWeight = '500';
    tdFile.title = doc.filename;
    tr.appendChild(tdFile);

    // Type badge
    const tdType = document.createElement('td');
    const cls = `doc-type-badge badge-${doc.status === 'error' ? 'error' : doc.doc_type}`;
    const label = doc.status === 'error' ? 'Error' : (TYPE_LABELS[doc.doc_type] || doc.doc_type);
    tdType.innerHTML = `<span class="${cls}">${label}</span>`;
    tr.appendChild(tdType);

    // Field cells
    allLabels.forEach(lbl => {
      const td = document.createElement('td');
      const field = fieldMap[lbl];
      if (field) {
        td.textContent = field.field_value || '—';
        td.className = 'cell-editable';
        td.title = `Click to edit "${lbl}"`;
        td.addEventListener('click', () => openEditModal(field.id, field.field_label, field.field_value || ''));
      } else {
        td.textContent = '';
        td.style.color = 'var(--color-text-muted)';
      }
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
}

/* ── INLINE EDIT MODAL ─────────────────────────────────────────── */
function openEditModal(fieldId, label, value) {
  editingFieldId = fieldId;
  editModalTitle.textContent = `Edit: ${label}`;
  editModalValue.value = value;
  editModal.style.display = 'flex';
  editModalValue.focus();
}

function closeEditModal() {
  editModal.style.display = 'none';
  editingFieldId = null;
}

editModalClose.addEventListener('click', closeEditModal);
editModalCancel.addEventListener('click', closeEditModal);
editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });

editModalSave.addEventListener('click', async () => {
  if (!editingFieldId) return;
  const val = editModalValue.value;
  editModalSave.disabled = true;
  try {
    const res = await fetch(`/api/document-fields/${editingFieldId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: val }),
    });
    if (res.ok) {
      const cell = document.querySelector(`td[data-field-id="${editingFieldId}"]`) ||
        [...document.querySelectorAll('td.cell-editable')].find(td => td._fieldId === editingFieldId);
      // Re-render is simpler than finding the exact cell — reload data
      if (activeSetId) await loadSetData(activeSetId);
      toast('Field updated');
      closeEditModal();
    } else {
      toast('Error saving field', 'error');
    }
  } finally {
    editModalSave.disabled = false;
  }
});

/* ── EXPORT ────────────────────────────────────────────────────── */
exportBtn.addEventListener('click', () => {
  if (activeSetId) window.location.href = `/api/doc-sets/${activeSetId}/export`;
});

/* ── UTILS ─────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(msg, type);
  }
}
