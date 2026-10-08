// Upload handler for PY and CY trial balance files
(function () {
  let currentSessionId = null;

  window.setUploadSessionId = function (sid) { currentSessionId = sid; };

  function setupZone(role) {
    const zone = document.getElementById('upload' + role.toUpperCase());
    const fileInput = document.getElementById('file' + role.toUpperCase());
    const browseBtn = document.getElementById('browse' + role.toUpperCase());
    const icon = document.getElementById('icon' + role.toUpperCase());
    const title = document.getElementById('title' + role.toUpperCase());
    const hint = document.getElementById('hint' + role.toUpperCase());
    const filenameEl = document.getElementById('filename' + role.toUpperCase());
    const errorEl = document.getElementById('error' + role.toUpperCase());

    if (!zone) return;

    function setIdle() {
      zone.className = 'upload-area';
      icon.textContent = '📂';
      title.textContent = 'Drop file here or browse';
      hint.textContent = 'CSV or Excel · Account Code, Account Name, Balance';
      filenameEl.classList.add('d-none');
      errorEl.classList.add('d-none');
      browseBtn.classList.remove('d-none');
    }

    function setUploading(filename) {
      zone.className = 'upload-area uploading';
      icon.innerHTML = '<div class="spinner"></div>';
      title.textContent = 'Parsing ' + filename + '…';
      hint.textContent = '';
      filenameEl.classList.add('d-none');
      errorEl.classList.add('d-none');
      browseBtn.classList.add('d-none');
    }

    function setSuccess(filename) {
      zone.className = 'upload-area success';
      icon.textContent = '✅';
      title.textContent = '✓ File uploaded';
      hint.textContent = '';
      filenameEl.textContent = '📄 ' + filename;
      filenameEl.classList.remove('d-none');
      errorEl.classList.add('d-none');
      browseBtn.textContent = 'Replace';
      browseBtn.classList.remove('d-none');
    }

    function setError(msg) {
      zone.className = 'upload-area error';
      icon.textContent = '❌';
      title.textContent = 'Upload failed';
      hint.textContent = '';
      errorEl.textContent = msg;
      errorEl.classList.remove('d-none');
      filenameEl.classList.add('d-none');
      browseBtn.textContent = 'Try again';
      browseBtn.classList.remove('d-none');
    }

    async function uploadFile(file) {
      if (!currentSessionId) {
        showToast('Please select or create a session first.', 'error');
        return;
      }
      setUploading(file.name);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('role', role);
      try {
        const resp = await fetch('/api/sessions/' + currentSessionId + '/upload', {
          method: 'POST',
          body: fd,
        });
        const data = await resp.json();
        if (!resp.ok) {
          setError(data.error || 'Unknown error');
          return;
        }
        setSuccess(file.name);
        if (data.status === 'merged') {
          showToast('Both files uploaded — variance analysis ready!', 'success');
          if (typeof loadSessionData === 'function') loadSessionData(currentSessionId);
        } else {
          showToast(role.toUpperCase() + ' file uploaded. Upload the ' + (role === 'py' ? 'CY' : 'PY') + ' file to generate analysis.', 'default');
        }
      } catch (err) {
        setError('Network error: ' + err.message);
      }
    }

    browseBtn.addEventListener('click', () => fileInput.click());
    zone.addEventListener('click', (e) => {
      if (e.target === zone || e.target === icon || e.target === title) fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) uploadFile(fileInput.files[0]);
    });

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    });
  }

  setupZone('py');
  setupZone('cy');
})();
