// public/app.js - versão ajustada (exibe ticket_number e envia assigned_to como string)
let currentUser = null;

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, (m)=>( {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] ));
}

const statusMap = { new: 'Novo', in_progress: 'Em andamento', resolved: 'Concluído', closed: 'Fechado' };
const urgencyMap = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

function statusClass(status){
  if (!status) return 'status-new';
  return { new: 'status-new', in_progress: 'status-in_progress', resolved: 'status-resolved', closed: 'status-closed' }[status] || 'status-new';
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

async function apiJSON(url, opts={}) {
  const merged = { credentials: 'include', ...opts };
  let res;
  try { res = await fetch(url, merged); } catch (err) { console.error('fetch error', url, err); throw new Error('network'); }
  if (res.status === 401) { try { showLogin(); } catch(e){}; throw new Error('noauth'); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch(e) { body = text; }
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || `HTTP ${res.status}`;
    console.warn('API error', url, res.status, msg);
    throw new Error(msg);
  }
  return body;
}

/* Remember-me */
(function(){
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
  } catch(e){}
})();

async function checkMe() {
  try {
    const meRes = await fetch('/api/me', { credentials: 'include' });
    if (meRes.status === 401) { showLogin(); return; }
    const data = await meRes.json();
    if (data) { currentUser = data; showDashboard(); } else showLogin();
    try {
      const openAdmin = document.getElementById('openAdmin');
      const openReports = document.getElementById('openReports');
      if (openAdmin) openAdmin.style.display = (currentUser && currentUser.role === 'superadmin') ? 'inline-block' : 'none';
      if (openReports) openReports.style.display = (currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) ? 'inline-block' : 'none';
    } catch(e){}
  } catch (err) { console.warn('checkMe erro', err); showLogin(); }
}
checkMe();

function showLogin(){ const lc = document.getElementById('loginCard'); const db = document.getElementById('dashboard'); const lo = document.getElementById('logoutBtn'); if (lc) lc.style.display = 'block'; if (db) db.style.display = 'none'; if (lo) lo.style.display = 'none'; }
function showDashboard(){ const lc = document.getElementById('loginCard'); const db = document.getElementById('dashboard'); const lo = document.getElementById('logoutBtn'); if (lc) lc.style.display = 'none'; if (db) db.style.display = 'block'; if (lo) lo.style.display = 'inline-block'; loadTickets(); }

async function login(email, password) {
  try {
    const res = await fetch('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password }), credentials: 'include'
    });
    const txt = await res.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch(e) { body = txt; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) { console.error('login error', err); return { ok: false, status: 0, body: { error: 'network' } }; }
}

function afterLoginSave() {
  try {
    const remember = document.getElementById('rememberMe')?.checked;
    const email = document.getElementById('email')?.value || '';
    if (remember && email) localStorage.setItem('henet_remember', JSON.stringify({ email, remember:true }));
    else localStorage.removeItem('henet_remember');
  } catch(e){}
}

/* login handlers */
async function doLoginHandler() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    const out = document.getElementById('loginResult'); if (out) out.innerText = 'Preencha email e senha';
    return;
  }
  const r = await login(email, password);
  if (r.ok) {
    currentUser = r.body && r.body.user ? r.body.user : r.body;
    afterLoginSave();
    showDashboard();
    try {
      const openAdmin = document.getElementById('openAdmin');
      const openReports = document.getElementById('openReports');
      if (openAdmin) openAdmin.style.display = (currentUser.role === 'superadmin') ? 'inline-block' : 'none';
      if (openReports) openReports.style.display = (currentUser.role === 'admin' || currentUser.role === 'superadmin') ? 'inline-block' : 'none';
    } catch(e){}
  } else {
    const out = document.getElementById('loginResult'); if (out) out.innerText = (r.body && (r.body.error || r.body.message)) || 'Erro';
  }
}

document.getElementById('loginBtn')?.addEventListener('click', async () => {
  const lc = document.getElementById('loginCard');
  if (lc) lc.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
document.getElementById('loginBtnInline')?.addEventListener('click', doLoginHandler);
document.getElementById('logoutBtn')?.addEventListener('click', async () => { try { await fetch('/api/logout', { method:'POST', credentials:'include' }); } catch(e){} location.reload(); });

document.getElementById('toSubmit')?.addEventListener('click', ()=> location.href = '/submit');
document.getElementById('openAdmin')?.addEventListener('click', ()=> location.href = '/admin');
document.getElementById('openReports')?.addEventListener('click', ()=> location.href = '/superadmin-reports');
document.getElementById('filterStatus')?.addEventListener('change', loadTickets);
document.getElementById('refreshBtn')?.addEventListener('click', loadTickets);

document.getElementById('togglePwd')?.addEventListener('click', ()=>{
  const pwd = document.getElementById('password');
  const btn = document.getElementById('togglePwd');
  if (!pwd) return;
  if (pwd.type === 'password') { pwd.type = 'text'; if (btn) btn.textContent = '🙈'; }
  else { pwd.type = 'password'; if (btn) btn.textContent = '👁️'; }
});

async function loadTickets() {
  const status = (document.getElementById('filterStatus') && document.getElementById('filterStatus').value) || '';
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  try {
    const tickets = await apiJSON('/api/tickets' + q);
    const container = document.getElementById('ticketsList');
    if (!container) return;
    container.innerHTML = '';
    if (!tickets || tickets.length === 0) { container.innerHTML = '<div class="small">Nenhum chamado.</div>'; return; }
    tickets.forEach(t => {
      const div = document.createElement('div');
      div.className = 'ticket';
      if (t.urgency === 'critical' || t.urgency === 'high') div.classList.add('urgent');
      const lvl = urgencyMap[t.urgency] || (t.urgency ? (t.urgency.charAt(0).toUpperCase()+t.urgency.slice(1)) : 'Média');
      const statusText = statusMap[t.status] || ((t.status||'new').replace('_',' '));
      const displayNumber = (t.ticket_number !== undefined && t.ticket_number !== null) ? ('#' + t.ticket_number) : ('#' + (t.id || '—'));
      const titleSafe = t.title ? escapeHtml(t.title) : (displayNumber);
      const requesterSafe = t.requester_name ? escapeHtml(t.requester_name) : '';
      const created = safeFormatDate(t.created_at);
      const assignedName = t.assigned_name ? escapeHtml(t.assigned_name) : 'Sem técnico';
      div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="max-width:70%"><div style="font-weight:700">${displayNumber} - ${titleSafe}</div><div class="meta">${requesterSafe}${created? ' • ' + created : ''}</div></div>
        <div style="text-align:right"><div class="status-pill ${statusClass(t.status)}">${statusText}</div><div class="meta" style="margin-top:8px">${lvl}<div style="font-weight:600">${assignedName}</div></div></div>
      </div>`;
      div.addEventListener('click', ()=> showDetail(t.id));
      container.appendChild(div);
    });
  } catch (err) {
    console.warn('loadTickets err', err);
    if (String(err.message) === 'noauth') { showLogin(); return; }
    const container = document.getElementById('ticketsList');
    if (container) container.innerHTML = '<div class="small">Erro ao carregar chamados.</div>';
  }
}

async function showDetail(id) {
  try {
    const t = await apiJSON('/api/tickets/' + id);
    if (!t) { document.getElementById('ticketDetail') && (document.getElementById('ticketDetail').innerHTML = '<div class="muted">Sem dados</div>'); return; }
    const detail = document.getElementById('ticketDetail');
    if (!detail) return;
    const displayNumber = (t.ticket_number !== undefined && t.ticket_number !== null) ? ('#' + t.ticket_number) : ('#' + (t.id || '—'));
    const titleSafe = t.title ? escapeHtml(t.title) : (displayNumber);
    const requester = t.requester_name ? escapeHtml(t.requester_name) : (t.requester_email ? escapeHtml(t.requester_email) : '');
    const created = safeFormatDate(t.created_at);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><strong>${displayNumber} - ${titleSafe}</strong><div class="small">${requester}</div></div>
        <div class="small">${created}</div>
      </div>
      <div style="margin-top:10px">${escapeHtml(t.description || '')}</div>
      <div style="margin-top:12px">
        <label class="label">Status</label>
        <select id="statusSelect" class="input">
          <option value="new">Novo</option><option value="in_progress">Em andamento</option>
          <option value="resolved">Concluído</option><option value="closed">Fechado</option>
        </select>
        <label class="label" style="margin-top:8px">Atribuir técnico</label>
        <select id="assignSelect" class="input"><option value="">-- nenhum --</option></select>
        <label class="label" style="margin-top:8px">Urgência</label>
        <select id="urgencySelect" class="input">
          <option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option>
        </select>

        <div style="margin-top:12px;text-align:right">
          <button id="saveChanges" class="btn">Salvar</button>
        </div>
      </div>

      <div style="margin-top:12px">
        <h4>Comentários</h4>
        <div id="commentsArea">${(t.comments || []).map(c=>`<div class="comment"><div class="small">${escapeHtml(c.user_name||'')} • ${safeFormatDate(c.created_at)}</div><div>${escapeHtml(c.text)}</div></div>`).join('')}</div>
        <textarea id="newComment" class="input" placeholder="Adicionar comentário"></textarea>
        <div style="text-align:right;margin-top:6px"><button id="sendComment" class="btn">Enviar</button></div>
      </div>
    `;
    detail.innerHTML = html;

    document.getElementById('statusSelect').value = t.status || 'new';
    document.getElementById('urgencySelect').value = t.urgency || 'medium';

    // carregar técnicos
    let techs = [];
    try { const techsBody = await apiJSON('/api/technicians'); if (Array.isArray(techsBody)) techs = techsBody; } catch (err) { if (String(err.message) === 'noauth') return; console.warn('Erro carregando técnicos', err); }
    const sel = document.getElementById('assignSelect');
    if (sel) {
      sel.innerHTML = '<option value="">-- nenhum --</option>';
      if (techs.length) {
        techs.forEach(tt => {
          const o = document.createElement('option'); o.value = String(tt.id);
          o.textContent = tt.display_name || tt.email || ('Téc #' + tt.id);
          // IMPORTANT: servidor agora retorna assigned_to como string; compara corretamente
          if (String(t.assigned_to) === String(tt.id)) o.selected = true;
          sel.appendChild(o);
        });
      }
    }

    // salvar alterações
    const saveBtn = document.getElementById('saveChanges');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const newStatus = document.getElementById('statusSelect')?.value || 'new';
        const assignedVal = document.getElementById('assignSelect')?.value || '';
        const assigned_to = assignedVal === '' ? null : assignedVal; // send string ObjectId
        const urgencyVal = document.getElementById('urgencySelect')?.value || 'medium';
        const payload = { status: newStatus, assigned_to: assigned_to, urgency: urgencyVal };
        try {
          const upd = await fetch('/api/tickets/' + id, {
            method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload), credentials: 'include'
          });
          const data = await upd.json();
          if (data && data.ok) { alert('Atualizado'); await loadTickets(); await showDetail(id); }
          else alert('Erro ao atualizar: ' + (data && (data.error||data.message) || upd.status));
        } catch (err) { console.error('saveChanges error', err); alert('Erro ao atualizar chamado'); }
      };
    }

    // Adiciona botão Excluir apenas para superadmin
    (function addDeleteButtonIfAllowed(){
      const saveContainer = document.getElementById('saveChanges')?.parentElement;
      if (!saveContainer) return;
      const existing = document.getElementById('deleteTicket');
      if (existing) existing.remove();

      const delBtn = document.createElement('button');
      delBtn.id = 'deleteTicket';
      delBtn.className = 'btn';
      delBtn.style.marginRight = '8px';
      delBtn.style.background = '#e05353';
      delBtn.style.color = '#fff';
      delBtn.textContent = 'Excluir';
      // por padrão escondido; só mostra se for superadmin
      delBtn.style.display = 'none';
      saveContainer.prepend(delBtn);

      if (currentUser && currentUser.role === 'superadmin') {
        delBtn.style.display = 'inline-block';
        delBtn.onclick = async () => {
          if (!confirm('Confirma exclusão deste chamado? Essa ação não pode ser desfeita.')) return;
          delBtn.disabled = true;
          try {
            const res = await fetch('/api/tickets/' + id, { method: 'DELETE', credentials: 'include' });
            if (res.ok) {
              alert('Chamado excluído');
              await loadTickets();
              detail.innerHTML = '<div class="small">Chamado excluído.</div>';
            } else {
              const body = await res.json().catch(()=>null);
              alert('Erro ao excluir: ' + (body && (body.error||body.message) || res.status));
              delBtn.disabled = false;
            }
          } catch (err) {
            console.error('deleteTicket error', err);
            alert('Erro ao excluir chamado');
            delBtn.disabled = false;
          }
        };
      }
    })();

    const sendBtn = document.getElementById('sendComment');
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const text = document.getElementById('newComment')?.value.trim();
        if (!text) return alert('Comentário vazio');
        try {
          const res = await fetch('/api/tickets/' + id + '/comments', {
            method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }), credentials: 'include'
          });
          const data = await res.json();
          if (data && data.id) { alert('Comentário adicionado'); await showDetail(id); }
          else alert('Erro ao adicionar comentário: ' + (data && (data.error||data.message) || res.status));
        } catch (err) { console.error('add comment error', err); alert('Erro ao adicionar comentário'); }
      };
    }

  } catch (err) {
    console.error('showDetail error', err);
    if (String(err.message) === 'noauth') return;
    const detail = document.getElementById('ticketDetail');
    if (detail) detail.innerHTML = '<div class="muted">Erro ao carregar detalhe do chamado.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newBtn')?.addEventListener('click', ()=> location.href = '/submit.html');
  document.getElementById('reloadBtn')?.addEventListener('click', ()=> loadTickets());
  if (!document.getElementById('dashboard') || document.getElementById('dashboard').style.display !== 'none') {
    loadTickets().catch(()=>{/* ignore */});
  }
});
