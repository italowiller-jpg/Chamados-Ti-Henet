// main.js - controla UI de botão SuperADM, login/logout e carregamento básico
(async function () {
  // ---------- Helpers ----------
  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // DOM elems
  const btnSuper = document.getElementById('btn-superadmin');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const userArea = document.getElementById('user-area');
  const userNameEl = document.getElementById('user-name');
  const btnOpenTicket = document.getElementById('btn-open-ticket');

  // ---------- Init ----------
  async function initSuperAdminButton(){
    try {
      const user = await apiGet('/api/me');
      if (!user) {
        // não logado: mostra botão de login
        btnLogin.style.display = 'inline-block';
        userArea.style.display = 'none';
        return;
      }

      // logado: mostra user area
      btnLogin.style.display = 'none';
      userArea.style.display = 'flex';
      userNameEl.textContent = user.name ? user.name : (user.email || 'Usuário');

      // Se for superadmin, exibe o botão
      if (user.role && user.role.toLowerCase() === 'superadmin') {
        btnSuper.style.display = 'inline-block';
        btnSuper.onclick = () => { window.location.href = '/admin.html'; };
      } else {
        btnSuper.style.display = 'none';
      }
    } catch (err) {
      console.warn('Não foi possível verificar usuário:', err.message || err);
      btnLogin.style.display = 'inline-block';
      userArea.style.display = 'none';
    }
  }

  // login - redireciona para página de login (supondo que exista)
  btnLogin.addEventListener('click', () => {
    // Se seu app tem um modal de login, abra-o aqui. Por simplicidade, redirecionamos para /login
    window.location.href = '/login.html';
  });

  // logout (POST /api/logout)
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await apiPost('/api/logout', {});
        // reload para atualizar UI
        window.location.reload();
      } catch (err) {
        console.error('Erro no logout', err);
        alert('Erro ao sair. Tente novamente.');
      }
    });
  }

  // abrir chamado - redireciona para a página de abertura
  if (btnOpenTicket) {
    btnOpenTicket.addEventListener('click', () => {
      window.location.href = '/open-ticket.html'; // ajuste se sua rota for diferente
    });
  }

  // Inicializa a checagem assim que possível
  initSuperAdminButton();

  // (opcional) atualizar periodicamente a sessão/master
  // setInterval(initSuperAdminButton, 60 * 1000); // a cada minuto

  // Carregamento básico de tickets (placeholder)
  async function loadTickets() {
    try {
      const tickets = await apiGet('/api/tickets').catch(() => []);
      const list = document.getElementById('tickets-list');
      const noTickets = document.getElementById('no-tickets');
      if (!tickets || tickets.length === 0) {
        noTickets && (noTickets.style.display = 'block');
        return;
      }
      noTickets && (noTickets.style.display = 'none');
      list.innerHTML = '';
      tickets.forEach(t => {
        const el = document.createElement('div');
        el.className = 'card';
        el.style.marginBottom = '10px';
        el.innerHTML = `<strong>${escapeHtml(t.title || 'Sem título')}</strong>
                        <div style="font-size:13px;color:#6b7280;margin-top:6px">${escapeHtml(t.requester_name || t.requester_email || '')}</div>`;
        el.addEventListener('click', () => showDetails(t.id));
        list.appendChild(el);
      });
    } catch (err) {
      console.warn('Erro carregando chamados:', err);
    }
  }

  async function showDetails(id) {
    try {
      const d = await apiGet('/api/tickets/' + id);
      const container = document.getElementById('ticket-details');
      container.innerHTML = `<h3>${escapeHtml(d.title)}</h3>
        <p>${escapeHtml(d.description || '—')}</p>
        <p style="color:var(--muted);font-size:13px">Status: ${escapeHtml(d.status || '')} — Categoria: ${escapeHtml(d.category_name || '')}</p>`;
    } catch (err) {
      console.warn('Erro carregando detalhes:', err);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  // carrega tickets ao iniciar
  loadTickets();

})();
