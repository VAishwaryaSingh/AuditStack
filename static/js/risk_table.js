// Risk Assessment table, session management, threshold controls
(function () {
  let currentSession = null;
  let allRows = [];
  let sortCol = 'account_code';
  let sortDir = 1;
  let activeFilter = 'all';
  let searchQuery = '';

  // ── Formatting helpers ──────────────────────────────────────
  function fmtMoney(val) {
    if (val === null || val === undefined) return '—';
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    const abs = Math.abs(n);
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? '(' + s + ')' : s;
  }

  function fmtPct(val) {
    if (val === null || val === undefined) return 'N/A';
    const n = parseFloat(val);
    if (isNaN(n)) return 'N/A';
    return n.toFixed(2) + '%';
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Stats ────────────────────────────────────────────────────
  function updateStats(rows) {
    const flagged = rows.filter(r => r.flagged);
    const explained = flagged.filter(r => (r.client_explanation || '').trim() !== '');
    const pending = flagged.length - explained.length;
    document.getElementById('statTotal').textContent = rows.length;
    document.getElementById('statFlagged').textContent = flagged.length;
    document.getElementById('statExplained').textContent = explained.length;
    document.getElementById('statPending').textContent = pending;
    document.getElementById('exportBtn').disabled = rows.length === 0;
  }

  // ── Table render ─────────────────────────────────────────────
  function applyFilterSort(rows) {
    let filtered = rows.slice();
    if (activeFilter === 'flagged') filtered = filtered.filter(r => r.flagged);
    else if (activeFilter === 'pending') filtered = filtered.filter(r => r.flagged && !(r.client_explanation || '').trim());
    else if (activeFilter === 'complete') filtered = filtered.filter(r => r.flagged && (r.client_explanation || '').trim());

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        (r.account_code || '').toLowerCase().includes(q) ||
        (r.account_name || '').toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    return filtered;
  }

  function renderTable(rows) {
    const tbody = document.getElementById('riskTableBody');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-title">No accounts found</div>
        <div class="empty-desc">Upload your Prior Year and Current Year trial balances to begin.</div>
      </div></td></tr>`;
      return;
    }

    const threshold = currentSession ? currentSession.materiality_threshold : 50000;
    const pctThreshold = currentSession ? currentSession.materiality_pct_threshold : 5;
    const cttLabel = currentSession
      ? '$' + Number(threshold).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' | ' + pctThreshold + '%'
      : '—';
    const displayed = applyFilterSort(rows);

    tbody.innerHTML = displayed.map(row => {
      const isFlagged = row.flagged;
      const isSevere = Math.abs(row.variance_amount || 0) >= threshold * 2;
      const hasExplanation = (row.client_explanation || '').trim() !== '';

      let rowClass = '';
      if (isSevere) rowClass = 'row-severe';
      else if (isFlagged) rowClass = 'row-flagged';

      let statusBadge;
      if (!isFlagged) {
        statusBadge = '<span class="badge badge-ok">✓ Within Threshold</span>';
      } else if (hasExplanation) {
        statusBadge = '<span class="badge badge-explained">✓ Explained</span>';
      } else if (isSevere) {
        statusBadge = '<span class="badge badge-severe">⚠ High Variance</span>';
      } else {
        statusBadge = '<span class="badge badge-flag">⚑ Requires Explanation</span>';
      }

      const varAmt = row.variance_amount;
      const varPct = row.variance_pct;
      const varAmtClass = varAmt > 0 ? 'text-success' : varAmt < 0 ? 'text-danger' : '';

      return `<tr class="${rowClass}" data-row-id="${row.id}">
        <td><code style="font-size:12px">${escHtml(row.account_code || '')}</code></td>
        <td>${escHtml(row.account_name || '')}</td>
        <td class="numeric">${fmtMoney(row.py_balance)}</td>
        <td class="numeric">${fmtMoney(row.cy_balance)}</td>
        <td class="numeric ${varAmtClass}">${fmtMoney(varAmt)}</td>
        <td class="numeric ${varAmtClass}">${fmtPct(varPct)}</td>
        <td>${statusBadge}</td>
        <td class="ctt-threshold-col">${escHtml(cttLabel)}</td>
        <td><textarea class="explanation-input" rows="1"
          data-row-id="${row.id}"
          placeholder="${isFlagged ? 'Enter explanation…' : ''}"
          ${!isFlagged ? 'style="pointer-events:none;color:#94a3b8"' : ''}
        >${escHtml(row.client_explanation || '')}</textarea></td>
      </tr>`;
    }).join('');

    // Auto-resize textareas
    tbody.querySelectorAll('.explanation-input').forEach(ta => {
      autoResize(ta);
      if (!ta.style.pointerEvents || ta.style.pointerEvents !== 'none') {
        ta.addEventListener('input', () => {
          autoResize(ta);
          debouncedSave(ta.dataset.rowId, ta.value, ta);
        });
      }
    });
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // ── Explanation save ─────────────────────────────────────────
  const saveTimers = {};

  function debouncedSave(rowId, text, ta) {
    clearTimeout(saveTimers[rowId]);
    saveTimers[rowId] = setTimeout(async () => {
      await fetch('/api/rows/' + rowId + '/explanation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explanation: text }),
      });
      // Update local cache
      const row = allRows.find(r => String(r.id) === String(rowId));
      if (row) {
        row.client_explanation = text;
        updateStats(allRows);
        // Flip badge in DOM without full re-render (badge is at cell index 6)
        const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (tr) {
          const badgeCell = tr.cells[6];
          const isFlagged = row.flagged;
          const isSevere = Math.abs(row.variance_amount || 0) >= (currentSession ? currentSession.materiality_threshold * 2 : 100000);
          if (isFlagged) {
            if (text.trim()) {
              badgeCell.innerHTML = '<span class="badge badge-explained">✓ Explained</span>';
            } else if (isSevere) {
              badgeCell.innerHTML = '<span class="badge badge-severe">⚠ High Variance</span>';
            } else {
              badgeCell.innerHTML = '<span class="badge badge-flag">⚑ Requires Explanation</span>';
            }
          }
        }
      }
    }, 500);
  }

  // ── Load session ─────────────────────────────────────────────
  async function loadSessionData(sessionId) {
    if (!sessionId) return;
    try {
      const resp = await fetch('/api/sessions/' + sessionId);
      const session = await resp.json();
      currentSession = session;
      allRows = session.rows || [];

      document.getElementById('thresholdAmt').value = session.materiality_threshold || 50000;
      document.getElementById('thresholdPct').value = session.materiality_pct_threshold || 5;
      document.getElementById('applyThresholdBtn').disabled = false;

      updateStats(allRows);
      renderTable(allRows);
      setUploadSessionId(sessionId);

      document.getElementById('exportBtn').disabled = allRows.length === 0;
    } catch (err) {
      showToast('Failed to load session: ' + err.message, 'error');
    }
  }

  window.loadSessionData = loadSessionData;

  // ── Session list ─────────────────────────────────────────────
  const sessionList = document.getElementById('sessionList');

  function activateSessionItem(item) {
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    if (item) item.classList.add('active');
  }

  function clearSession() {
    currentSession = null;
    allRows = [];
    activateSessionItem(null);
    document.getElementById('applyThresholdBtn').disabled = true;
    document.getElementById('exportBtn').disabled = true;
    updateStats([]);
    renderTable([]);
    setUploadSessionId(null);
  }

  sessionList && sessionList.addEventListener('click', (e) => {
    // Delete button
    const deleteBtn = e.target.closest('.session-delete-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const item = deleteBtn.closest('.session-item');
      if (!item) return;
      const sid = parseInt(item.dataset.sessionId);
      const sessionName = item.querySelector('.session-item-name').textContent;
      if (!confirm('Delete session "' + sessionName + '"? This cannot be undone.')) return;
      fetch('/api/sessions/' + sid, { method: 'DELETE' }).then(() => {
        item.remove();
        if (!sessionList.querySelector('.session-item')) {
          const msg = document.createElement('div');
          msg.className = 'session-empty-msg';
          msg.id = 'sessionEmptyMsg';
          msg.textContent = 'No sessions yet — create one to get started.';
          sessionList.appendChild(msg);
        }
        clearSession();
        showToast('Session deleted.', 'default');
      });
      return;
    }

    // Session item click
    const item = e.target.closest('.session-item');
    if (!item) return;
    const sid = parseInt(item.dataset.sessionId);
    if (!sid) return;
    activateSessionItem(item);
    loadSessionData(sid);
  });

  // ── New session modal ─────────────────────────────────────────
  const modal = document.getElementById('newSessionModal');
  document.getElementById('newSessionBtn').addEventListener('click', () => {
    document.getElementById('sessionNameInput').value = '';
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('sessionNameInput').focus(), 50);
  });

  document.getElementById('closeModal').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('cancelModal').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  document.getElementById('confirmModal').addEventListener('click', async () => {
    const name = document.getElementById('sessionNameInput').value.trim();
    if (!name) { showToast('Please enter a session name.', 'error'); return; }
    const resp = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json();
    modal.classList.add('hidden');

    // Remove empty-state message if present
    const emptyMsg = document.getElementById('sessionEmptyMsg');
    if (emptyMsg) emptyMsg.remove();

    // Build new session item
    const today = new Date().toISOString().slice(0, 10);
    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.sessionId = data.id;
    item.innerHTML =
      '<span class="session-dot"></span>' +
      '<div class="session-item-info">' +
        '<span class="session-item-name">' + escHtml(data.name) + '</span>' +
        '<span class="session-item-meta">' + today + '</span>' +
      '</div>' +
      '<button class="btn btn-danger btn-sm session-delete-btn">Delete</button>';
    sessionList.insertBefore(item, sessionList.firstChild);
    activateSessionItem(item);
    loadSessionData(data.id);
    showToast('Session "' + data.name + '" created.', 'success');
  });

  document.getElementById('sessionNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('confirmModal').click();
  });

  // ── Threshold apply ──────────────────────────────────────────
  document.getElementById('applyThresholdBtn').addEventListener('click', async () => {
    if (!currentSession) return;
    const amt = parseFloat(document.getElementById('thresholdAmt').value) || 50000;
    const pct = parseFloat(document.getElementById('thresholdPct').value) || 5;
    const resp = await fetch('/api/sessions/' + currentSession.id + '/threshold', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materiality_threshold: amt, materiality_pct_threshold: pct }),
    });
    const data = await resp.json();
    currentSession = data;
    allRows = data.rows || [];
    updateStats(allRows);
    renderTable(allRows);
    showToast('Threshold updated and flags recalculated.', 'success');
  });

  // ── Sort ─────────────────────────────────────────────────────
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = 1; }
      renderTable(allRows);
    });
  });

  // ── Filter chips ─────────────────────────────────────────────
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderTable(allRows);
    });
  });

  // ── Search ───────────────────────────────────────────────────
  const searchInput = document.getElementById('tableSearch');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      renderTable(allRows);
    }, 200);
  });

  // ── Export ───────────────────────────────────────────────────
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!currentSession) return;
    window.location.href = '/api/sessions/' + currentSession.id + '/export';
  });

  // ── Init ─────────────────────────────────────────────────────
  updateStats([]);
})();
