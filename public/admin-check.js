// public/admin-check.js
// controla exibição dos botões ADM / Relatórios / Logout conforme role
(function () {
  // tenta vários possíveis ids para compatibilidade entre páginas
  const openAdminBtn = document.getElementById('openAdmin') || document.getElementById('openAdminBtn') || document.getElementById('openAdminLink');
  const openReportsBtn = document.getElementById('openReports') || document.getElementById('openReportsBtn') || document.getElementById('toReports');
  const logoutBtn = document.getElementById('logout') || document.getElementById('logoutBtn');
  const loginBtnDom = document.getElementById('loginBtn') || document.getElementById('loginBtnInline');

  async function fetchMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return null;
      const j = await res.json();
      return j;
    } catch (err) {
      console.warn('[admin-check] erro fetch /api/me', err);
      return null;
    }
  }

  async function updateButtons() {
    const user = await fetchMe();

    // Botão ADM: visível para admin ou superadmin
    if (openAdminBtn) {
      if (user && (String(user.role).toLowerCase() === 'admin' || String(user.role).toLowerCase() === 'superadmin')) {
        openAdminBtn.style.display = 'inline-block';
        openAdminBtn.onclick = (e) => { e.preventDefault(); window.location.href = '/admin-edit.html'; };
      } else {
        openAdminBtn.style.display = 'none';
        openAdminBtn.onclick = null;
      }
    }

    // Botão Relatórios: visível apenas para superadmin
    if (openReportsBtn) {
      if (user && String(user.role).toLowerCase() === 'superadmin') {
        openReportsBtn.style.display = 'inline-block';
        openReportsBtn.onclick = (e) => { e.preventDefault(); window.location.href = '/superadmin-reports.html'; };
      } else {
        openReportsBtn.style.display = 'none';
        openReportsBtn.onclick = null;
      }
    }

    // login/logout display
    if (logoutBtn) logoutBtn.style.display = user ? 'inline-block' : 'none';
    if (loginBtnDom) loginBtnDom.style.display = user ? 'none' : 'inline-block';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateButtons); else updateButtons();

  // checa periodicamente caso a sessão mude (login/logout sem reload)
  setInterval(updateButtons, 3000);

  // expor para debug
  window.__adminCheckFetchMe = fetchMe;
})();
