// public/admin-check.js
(function () {
  const openAdminBtn = document.getElementById('openAdmin');
  const openReportsBtn = document.getElementById('openReports'); // pode não existir se seu index não tiver
  const logoutBtn = document.getElementById('logoutBtn');
  const loginBtnDom = document.getElementById('loginBtn') || document.getElementById('loginBtnInline');

  async function fetchMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) {
        return null;
      }
      const j = await res.json();
      return j;
    } catch (err) {
      console.warn('[admin-check] erro fetch /api/me', err);
      return null;
    }
  }

  async function updateButtons() {
    const user = await fetchMe();

    // Admin (superadmin) button
    if (openAdminBtn) {
      if (user && user.role && String(user.role).toLowerCase() === 'superadmin') {
        openAdminBtn.style.display = 'inline-block';
        openAdminBtn.onclick = (e) => { e.preventDefault(); window.location.href = '/admin.html'; };
      } else {
        openAdminBtn.style.display = 'none';
        openAdminBtn.onclick = null;
      }
    }

    // Reports button: only for admin OR superadmin
    if (openReportsBtn) {
      if (user && user.role && (String(user.role).toLowerCase() === 'admin' || String(user.role).toLowerCase() === 'superadmin')) {
        openReportsBtn.style.display = 'inline-block';
        openReportsBtn.onclick = (e) => { e.preventDefault(); window.location.href = '/stats.html'; };
      } else {
        openReportsBtn.style.display = 'none';
        openReportsBtn.onclick = null;
      }
    }

    // login/logout display
    if (logoutBtn) logoutBtn.style.display = user ? 'inline-block' : 'none';
    if (loginBtnDom) loginBtnDom.style.display = user ? 'none' : 'inline-block';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateButtons);
  } else {
    updateButtons();
  }

  // checa periodicamente caso a sessão mude (login/logout sem reload)
  setInterval(updateButtons, 3000);

  // Expor util para debug
  window.__adminCheckFetchMe = fetchMe;
})();
