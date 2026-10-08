// Sidebar toggle
(function () {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  if (!sidebar || !toggle) return;

  const COLLAPSED_KEY = 'auditos_sidebar_collapsed';
  if (localStorage.getItem(COLLAPSED_KEY) === '1') {
    sidebar.classList.add('collapsed');
  }

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem(COLLAPSED_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
  });
})();

// Toast notifications
function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

window.showToast = showToast;

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'f') {
    const search = document.getElementById('tableSearch');
    if (search) { e.preventDefault(); search.focus(); }
  }
  if (e.key === 'Escape') {
    const modal = document.getElementById('newSessionModal');
    if (modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  }
});
