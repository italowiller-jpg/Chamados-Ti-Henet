// public/app.js - versão robusta, segura e com atualização em tempo real via SSE
let currentUser = null;

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '<', '>': '>', '"': '&quot;', "'": '&#39;' }[m]));
}

const statusMap = { new: 'Novo', in_progress: 'Em andamento', resolved: 'Concluído', closed: 'Fechado' };
const urgencyMap = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

function statusClass(status) {
  if (!status) return 'status-new';
  return {
    new: 'status-new',
    in_progress: 'status-in_progress',
    resolved: 'status-resolved',
    closed: 'status-closed'
  }[status] || 'status-new';
}

function safeFormatDate(value) {
  if (!value && value !== 0) return '';
  try {
    let s = String(value);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T');
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  } catch (e) { return String(value); }
}

async function apiJSON(url, opts = {}) {
  const merged = { credentials: 'include', ...opts };
  let res;
  try { res = await fetch(url, merged); } catch (err) { console.error('fetch error', url, err); throw new Error('network'); }
  if (res.status === 401) { showLogin(); throw new Error('noauth'); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || `HTTP ${res.status}`;
    console.warn('API error', url, res.status, msg);
    const err = new Error(msg); err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

/* Remember-me restore (safe) */
(function () {
  try {
    const stored = localStorage.getItem('henet_remember');
    if (stored) {
      const o = JSON.parse(stored);
      if (o && o.email) {
        const emailEl = document.getElementById('email');
        if (emailEl) emailEl.value = o.email;
        const chk = document.getElementById('rememberMe');
        if (chk) chk.checked = !!o.remember;
      }
    }
  } catch (e) { }
})();

/* --- Função de atualização de visibilidade da navegação --- */
function updateNavVisibility() {
  const openAdmin = document.getElementById('openAdmin');
  const openReports = document.getElementById('openReports');
  if (openAdmin) openAdmin.style.display = (currentUser?.role === 'superadmin') ? 'inline-block' : 'none';
  if (openReports) openReports.style.display = (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') ? 'inline-block' : 'none';
}

/* --- Auth & UI flow --- */
async function checkMe() {
  try {
    const meRes = await fetch('/api/me', { credentials: 'include' });
    if (meRes.status === 401) { showLogin(); return; }
    const data = await meRes.json();
    if (data) { currentUser = data; showDashboard(); }
    else showLogin();
    updateNavVisibility();
  } catch (err) { console.warn('checkMe erro', err); showLogin(); }
}
window.checkMe = checkMe;

function showLogin() {
  const lc = document.getElementById('loginCard');
  const db = document.getElementById('dashboard');
  const lo = document.getElementById('logoutBtn');
  if (lc) lc.style.display = 'block';
  if (db) db.style.display = 'none';
  if (lo) lo.style.display = 'none';
}

function showDashboard() {
  const lc = document.getElementById('loginCard');
  const db = document.getElementById('dashboard');
  const lo = document.getElementById('logoutBtn');
  if (lc) lc.style.display = 'none';
  if (db) db.style.display = 'block';
  if (lo) lo.style.display = 'inline-block';
  loadTickets().catch(() => {});
  if (typeof startSSE === 'function') {
    try { startSSE(); } catch (e) { console.warn('startSSE failed', e); }
  }
}

/* login network */
async function loginRequest(email, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), credentials: 'include'
    });
    const txt = await res.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = txt; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) { console.error('login error', err); return { ok: false, status: 0, body: { error: 'network' } }; }
}

function afterLoginSave() {
  try {
    const remember = document.getElementById('rememberMe')?.checked;
    const email = document.getElementById('email')?.value || '';
    if (remember && email) localStorage.setItem('henet_remember', JSON.stringify({ email, remember: true }));
    else localStorage.removeItem('henet_remember');
  } catch (e) { }
}

async function doLoginHandler() {
  const emailEl = document.getElementById('email');
  const pwdEl = document.getElementById('password');
  const out = document.getElementById('loginResult');
  const email = emailEl ? emailEl.value.trim() : '';
  const password = pwdEl ? pwdEl.value : '';
  if (!email || !password) { if (out) out.innerText = 'Preencha email e senha'; return; }

  try {
    const r = await loginRequest(email, password);
    if (r.ok) {
      currentUser = r.body && r.body.user ? r.body.user : r.body;
      afterLoginSave();
      showDashboard();
      updateNavVisibility();
    } else {
      if (out) {
        if (r.status === 403 && r.body && r.body.error === 'awaiting_approval') out.innerText = 'Conta pendente de aprovação pelo administrador.';
        else out.innerText = (r.body && (r.body.error || r.body.message)) || 'Erro';
      }
    }
  } catch (err) {
    console.error('doLoginHandler err', err);
    if (out) out.innerText = 'Erro de rede';
  }
}

/* Register (public) */
async function doRegisterHandler() {
  const name = (document.getElementById('regName')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim();
  const pass = document.getElementById('regPassword')?.value || '';
  const pass2 = document.getElementById('regPassword2')?.value || '';
  const out = document.getElementById('registerResult');

  if (!name || !email || !pass) { if (out) { out.style.color = '#c00'; out.innerText = 'Preencha todos os campos'; } return; }
  if (pass.length < 6) { if (out) { out.style.color = '#c00'; out.innerText = 'Senha muito curta (min 6)'; } return; }
  if (pass !== pass2) { if (out) { out.style.color = '#c00'; out.innerText = 'Senhas não coincidem'; } return; }

  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: pass }), credentials: 'include' });
    const j = await res.json();
    if (!res.ok) {
      if (j && j.error === 'email_exists') { if (out) { out.style.color = '#c00'; out.innerText = 'E-mail já cadastrado'; } }
      else { if (out) { out.style.color = '#c00'; out.innerText = (j && (j.error || j.message)) || 'Erro'; } }
      return;
    }
    if (out) { out.style.color = '#059669'; out.innerText = j.message || 'Cadastro enviado. Aguarde aprovação do administrador.'; }
    // limpar form
    ['regName', 'regEmail', 'regPassword', 'regPassword2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    setTimeout(() => {
      const regCard = document.getElementById('registerCard');
      const loginCard = document.getElementById('loginCard');
      if (regCard) regCard.style.display = 'none';
      if (loginCard) loginCard.style.display = 'block';
    }, 900);
  } catch (e) {
    console.error('register err', e);
    if (out) { out.style.color = '#c00'; out.innerText = 'Erro de rede'; }
  }
}

/* --- Tickets UI --- */
async function loadTickets() {
  // Limpar seleção anterior
  document.querySelectorAll('.ticket-item.selected').forEach(el => el.classList.remove('selected'));

  const status = (document.getElementById('filterStatus')?.value) || '';
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  try {
    const tickets = await apiJSON('/api/tickets' + q);
    const container = document.getElementById('ticketsList');
    if (!container) return;
    container.innerHTML = '';
    if (!tickets || tickets.length === 0) {
      container.innerHTML = '<div class="small">Nenhum chamado.</div>';
      return;
    }
    tickets.forEach(t => {
      const div = document.createElement('div');
      div.className = 'ticket-item';
      div.setAttribute('data-id', t.id || t._id || '');
      div.setAttribute('data-status', t.status || '');
      if (t.urgency === 'critical' || t.urgency === 'high') div.classList.add('urgent');
      const statusText = statusMap[t.status] || ((t.status || 'new').replace('_', ' '));
      const displayNumber = (t.ticket_number !== undefined && t.ticket_number !== null) ? ('#' + t.ticket_number) : ('#' + (t.id || '—'));
      const titleText = t.title ? String(t.title) : '';
      const titleSafe = titleText ? escapeHtml(titleText) : displayNumber;
      const requesterSafe = t.requester_name ? escapeHtml(t.requester_name) : '';
      const created = safeFormatDate(t.created_at);

      div.innerHTML = `
        <div class="ticket-meta" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
          <div class="title" style="font-weight:600;font-size:15px;color:#072033;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayNumber} - ${titleSafe}</div>
          <div class="sub" style="font-size:12px;color:var(--muted)">${requesterSafe}${created ? ' • ' + created : ''}</div>
        </div>
        <div style="display:flex;align-items:flex-start">
          <div class="status-badge ${statusClass(t.status)}">${statusText}</div>
        </div>`;

      div.addEventListener('click', () => {
        document.querySelectorAll('.ticket-item.selected').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        showDetail(t.id).catch(() => {});
      });
      container.appendChild(div);
    });
    // auto-select first
    setTimeout(() => {
      const first = document.querySelector('#ticketsList .ticket-item');
      if (first) {
        first.classList.add('selected');
        first.click();
      }
    }, 100);
  } catch (e) {
    console.warn('loadTickets error', e);
    if (String(e.message) === 'noauth') { showLogin(); return; }
    const container = document.getElementById('ticketsList');
    if (container) container.innerHTML = '<div class="small">Erro ao carregar chamados.</div>';
  }
}

async function showDetail(id) {
  try {
    const t = await apiJSON('/api/tickets/' + id);
    if (!t) {
      const detail = document.getElementById('ticketDetail');
      if (detail) detail.innerHTML = '<div class="muted">Sem dados</div>';
      return;
    }
    const detail = document.getElementById('ticketDetail');
    if (!detail) return;

    const displayNumber = (t.ticket_number !== undefined && t.ticket_number !== null) ? ('#' + t.ticket_number) : ('#' + (t.id || '—'));
    const titleSafe = t.title ? escapeHtml(t.title) : displayNumber;
    const requester = t.requester_name ? escapeHtml(t.requester_name) : (t.requester_email ? escapeHtml(t.requester_email) : '');
    const created = safeFormatDate(t.created_at);

    const isOperator = !!(currentUser && currentUser.role === 'operator');
    const isSuperAdmin = !!(currentUser && currentUser.role === 'superadmin');

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><strong>${displayNumber} - ${titleSafe}</strong><div class="small">${requester}</div></div>
        <div class="small">${created}</div>
      </div>
      <div style="margin-top:10px">${escapeHtml(t.description || '')}</div>
    `;

    if (!isOperator) {
      html += `
        <div style="margin-top:12px">
          <label class="label">Status</label>
          <select id="statusSelect" class="input">
            <option value="new">Novo</option>
            <option value="in_progress">Em andamento</option>
            <option value="resolved">Concluído</option>
            <option value="closed">Fechado</option>
          </select>
          <label class="label" style="margin-top:8px">Atribuir técnico</label>
          <select id="assignSelect" class="input"><option value="">-- nenhum --</option></select>
          <label class="label" style="margin-top:8px">Urgência</label>
          <select id="urgencySelect" class="input">
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>

          <div style="margin-top:12px;text-align:right;display:flex;gap:8px;justify-content:flex-end;align-items:center">
            ${isSuperAdmin ? `<button id="deleteTicket" class="btn danger small">Excluir</button>` : ''}
            <button id="saveChanges" class="btn">Salvar</button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="margin-top:12px">
          <label class="label">Status atual</label>
          <div class="status-badge ${statusClass(t.status)}">${statusMap[t.status] || (t.status || '')}</div>
        </div>
      `;
    }

    html += `
      <div style="margin-top:12px">
        <h4>Comentários</h4>
        <div id="commentsArea">${(t.comments || []).map(c => 
          `<div class="comment"><div class="small">${escapeHtml(c.user_name || '')} • ${safeFormatDate(c.created_at)}</div><div>${escapeHtml(c.text)}</div></div>`
        ).join('')}</div>
        <textarea id="newComment" class="input" placeholder="Adicionar comentário"></textarea>
        <div style="text-align:right;margin-top:6px"><button id="sendComment" class="btn">Enviar</button></div>
      </div>
    `;
    detail.innerHTML = html;

    if (!isOperator) {
      const stEl = document.getElementById('statusSelect');
      if (stEl) stEl.value = t.status || 'new';
      const urEl = document.getElementById('urgencySelect');
      if (urEl) urEl.value = t.urgency || 'medium';

      try {
        let techs = [];
        try { techs = await apiJSON('/api/technicians'); } catch (e) { /* ignore */ }
        const sel = document.getElementById('assignSelect');
        if (sel) {
          sel.innerHTML = '<option value="">-- nenhum --</option>';
          if (Array.isArray(techs) && techs.length) {
            techs.forEach(tt => {
              const o = document.createElement('option');
              o.value = String(tt.id);
              o.textContent = tt.display_name || tt.email || ('Téc #' + tt.id);
              if (String(t.assigned_to) === String(tt.id)) o.selected = true;
              sel.appendChild(o);
            });
          }
        }
      } catch (e) { console.warn('Erro ao carregar técnicos', e); }

      document.getElementById('saveChanges')?.addEventListener('click', async () => {
        const newStatus = document.getElementById('statusSelect')?.value || 'new';
        const assignedVal = document.getElementById('assignSelect')?.value || '';
        const assigned_to = assignedVal === '' ? null : assignedVal;
        const urgencyVal = document.getElementById('urgencySelect')?.value || 'medium';
        const payload = { status: newStatus, assigned_to, urgency: urgencyVal };
        try {
          const upd = await fetch('/api/tickets/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'include'
          });
          const data = await upd.json();
          if (data && (data.ok || upd.status === 200 || upd.status === 204)) {
            alert('Atualizado');
            await loadTickets();
            await showDetail(id);
          } else {
            alert('Erro ao atualizar: ' + (data?.error || data?.message || upd.status));
          }
        } catch (err) {
          console.error('saveChanges error', err);
          alert('Erro ao atualizar chamado');
        }
      });

      document.getElementById('deleteTicket')?.addEventListener('click', async () => {
        if (!confirm('Confirmar exclusão do chamado? Esta ação é irreversível.')) return;
        try {
          const resp = await fetch('/api/tickets/' + id, { method: 'DELETE', credentials: 'include' });
          if (resp.ok) {
            alert('Chamado excluído');
            await loadTickets();
            const detailEl = document.getElementById('ticketDetail');
            if (detailEl) detailEl.innerHTML = '<div class="muted">Chamado removido.</div>';
          } else {
            let j = null;
            try { j = await resp.json(); } catch (e) {}
            alert('Erro ao excluir: ' + (j?.error || j?.message || resp.status));
          }
        } catch (err) {
          console.error('delete ticket err', err);
          alert('Erro de rede ao excluir chamado');
        }
      });
    }

    document.getElementById('sendComment')?.addEventListener('click', async () => {
      const text = document.getElementById('newComment')?.value.trim();
      if (!text) return alert('Comentário vazio');
      try {
        const res = await fetch('/api/tickets/' + id + '/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          credentials: 'include'
        });
        const data = await res.json();
        if (data && data.id) {
          alert('Comentário adicionado');
          await showDetail(id);
        } else {
          alert('Erro ao adicionar comentário: ' + (data?.error || data?.message || res.status));
        }
      } catch (err) {
        console.error('add comment error', err);
        alert('Erro ao adicionar comentário');
      }
    });

  } catch (err) {
    console.error('showDetail error', err);
    if (String(err.message) === 'noauth') {
      showLogin();
      return;
    }
    const detail = document.getElementById('ticketDetail');
    if (detail) detail.innerHTML = '<div class="muted">Erro ao carregar detalhe do chamado.</div>';
  }
}

/* SSE implementation */
function startSSE() {
  if (window.__henet_sse && window.__henet_sse.readyState !== EventSource.CLOSED) {
    return;
  }

  const urls = ['/api/stream', '/api/events', '/events', '/sse'];
  let idx = 0;
  let es = null;

  function tryNext() {
    if (es) {
      try { es.close(); } catch (e) {}
      es = null;
    }
    if (idx >= urls.length) {
      console.warn('SSE: nenhum endpoint disponível');
      return;
    }
    const url = urls[idx++];
    try {
      es = new EventSource(url);
      window.__henet_sse = es;

      es.addEventListener('open', () => {
        console.log('SSE conectado em', url);
      });

      es.addEventListener('ticket_update', (ev) => {
        console.log('SSE ticket_update recebido');
        handleTicketUpdate(ev.data);
      });

      es.onmessage = (ev) => {
        console.log('SSE mensagem genérica recebida');
        handleTicketUpdate(ev.data);
      };

      es.onerror = (err) => {
        console.warn('SSE erro em', url, err);
        try { es.close(); } catch (e) {}
        setTimeout(tryNext, 1000);
      };
    } catch (e) {
      console.warn('SSE falhou ao criar EventSource em', url, e);
      setTimeout(tryNext, 300);
    }
  }

  tryNext();
}

function handleTicketUpdate(data) {
  // Sempre recarrega a lista
  loadTickets().catch(() => {});

  // Recarrega detalhe se houver um selecionado
  const sel = document.querySelector('.ticket-item.selected');
  if (sel) {
    const selId = sel.getAttribute('data-id');
    if (selId) {
      showDetail(selId).catch(() => {});
    }
  }
}

// Garantir que SSE seja fechado ao sair da página
window.addEventListener('beforeunload', () => {
  if (window.__henet_sse) {
    window.__henet_sse.close();
    window.__henet_sse = null;
  }
});

/* DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  // Nav buttons
  document.getElementById('toSubmit')?.addEventListener('click', () => location.href = '/submit');
  document.getElementById('openPublic')?.addEventListener('click', () => location.href = '/submit');
  document.getElementById('openAdmin')?.addEventListener('click', () => location.href = '/admin');
  document.getElementById('openReports')?.addEventListener('click', () => location.href = '/superadmin-reports');

  // Login
  document.getElementById('loginBtn')?.addEventListener('click', () => {
    const lc = document.getElementById('loginCard');
    if (lc) lc.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('loginBtnInline')?.addEventListener('click', doLoginHandler);

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    currentUser = null;
    showLogin();
  });

  // Toggle password
  document.getElementById('togglePwd')?.addEventListener('click', () => {
    const p = document.getElementById('password');
    const btn = document.getElementById('togglePwd');
    if (!p) return;
    if (p.type === 'password') {
      p.type = 'text';
      if (btn) btn.textContent = '❌';
    } else {
      p.type = 'password';
      if (btn) btn.textContent = '✅';
    }
  });

  // Register
  document.getElementById('showRegisterBtn')?.addEventListener('click', () => {
    document.getElementById('registerCard') && (document.getElementById('registerCard').style.display = 'block');
    document.getElementById('loginCard') && (document.getElementById('loginCard').style.display = 'none');
    const rr = document.getElementById('registerResult'); if (rr) rr.innerText = '';
  });
  document.getElementById('cancelRegister')?.addEventListener('click', () => {
    document.getElementById('registerCard') && (document.getElementById('registerCard').style.display = 'none');
    document.getElementById('loginCard') && (document.getElementById('loginCard').style.display = 'block');
  });
  document.getElementById('registerSubmit')?.addEventListener('click', doRegisterHandler);

  // Filter & refresh
  document.getElementById('filterStatus')?.addEventListener('change', loadTickets);
  document.getElementById('refreshBtn')?.addEventListener('click', loadTickets);

  // Initial auth check
  try { checkMe(); } catch (e) { console.warn('checkMe fail', e); }
});