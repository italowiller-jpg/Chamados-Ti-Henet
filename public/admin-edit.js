// public/admin-edit.js
// Versão corrigida: api wrapper com ok/status/body, login inline e retry automático
// Mantém funcionalidades originais (CRUD users, technicians, settings)

function el(id){ return document.getElementById(id); }
function showMsg(txt, err=false){ const m = el('adminMessages'); if (!m) return; m.style.color = err? '#c00':'#111'; m.innerText = txt; }

// api helper que devolve { ok, status, body }
async function api(path, opts = {}) {
  const merged = Object.assign({ credentials: 'include' }, opts);
  try {
    const res = await fetch(path, merged);
    const txt = await res.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch(e){ body = txt; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: String(err) } };
  }
}

/* ---------- LOGIN INLINE (aparece se a ação requer auth) ---------- */
function createLoginBox() {
  let box = document.getElementById('adminLoginBox');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'adminLoginBox';
  box.style.position = 'fixed';
  box.style.right = '18px';
  box.style.top = '18px';
  box.style.background = '#fff';
  box.style.border = '1px solid #ddd';
  box.style.padding = '12px';
  box.style.borderRadius = '8px';
  box.style.boxShadow = '0 8px 24px rgba(0,0,0,.08)';
  box.style.zIndex = 9999;
  box.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">Login necessário</div>
    <input id="admin_inline_email" placeholder="email" style="width:220px;padding:8px;margin-bottom:6px;border:1px solid #eee;border-radius:6px;display:block">
    <input id="admin_inline_pass" placeholder="senha" type="password" style="width:220px;padding:8px;margin-bottom:6px;border:1px solid #eee;border-radius:6px;display:block">
    <div style="text-align:right"><button id="admin_inline_do" class="btn">Entrar</button> <button id="admin_inline_cancel" class="btn ghost">Fechar</button></div>
    <div id="admin_inline_msg" style="margin-top:8px;font-size:13px;color:#666"></div>
  `;
  document.body.appendChild(box);
  el('admin_inline_cancel').onclick = ()=> { box.remove(); };
  el('admin_inline_do').onclick = async () => {
    const email = el('admin_inline_email').value.trim();
    const pass = el('admin_inline_pass').value.trim();
    el('admin_inline_msg').innerText = 'Entrando...';
    const r = await api('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, password: pass }) });
    if (!r.ok) {
      el('admin_inline_msg').innerText = r.body && (r.body.error || r.body.message) ? (r.body.error || r.body.message) : ('Erro: ' + r.status);
      return;
    }
    el('admin_inline_msg').innerText = 'Login OK — prosseguindo...';
    setTimeout(()=> { try { box.remove(); } catch(e){} }, 600);
    window.dispatchEvent(new CustomEvent('admin_inline_loggedin'));
  };
  return box;
}

/* ---------- SETTINGS ---------- */
async function loadSettings(){
  const s = await api('/api/settings');
  if (!s.ok) { showMsg('Erro ao carregar settings: ' + (s.body && (s.body.error||s.body.message) || s.status), true); return; }
  const data = s.body || {};
  el('siteTitle').value = data.title || '';
  el('siteSubtitle').value = data.subtitle || '';
  el('homeHero').value = data.home_hero || '';
  el('labelTicketTitle').value = data.label_ticket_title || 'Título';
  el('labelTicketDesc').value = data.label_ticket_desc || 'Descrição';
  try {
    const raw = data.menu_items || '[]';
    renderMenu(JSON.parse(raw));
  } catch(e) { renderMenu([]); }
}
async function saveSite(){ 
  const updates = {
    title: el('siteTitle').value || '',
    subtitle: el('siteSubtitle').value || '',
    home_hero: el('homeHero').value || ''
  };
  const res = await api('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(updates) });
  showMsg(res.ok ? 'Conteúdo salvo' : (res.body && (res.body.error||res.body.message) || 'Erro'), !res.ok);
}
async function saveNaming(){
  const updates = {
    label_ticket_title: el('labelTicketTitle').value || 'Título',
    label_ticket_desc: el('labelTicketDesc').value || 'Descrição'
  };
  const res = await api('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(updates) });
  showMsg(res.ok ? 'Nomenclaturas salvas' : (res.body && (res.body.error||res.body.message) || 'Erro'), !res.ok);
}

/* ---------- MENU ---------- (mantido) */
function renderMenu(items){
  const box = el('menuList'); box.innerHTML = '';
  items.forEach((it, idx)=>{
    const row = document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.marginBottom='6px';
    const lbl = document.createElement('input'); lbl.className='input'; lbl.value = it.label || ''; const href = document.createElement('input'); href.className='input'; href.value = it.href || '';
    const up = document.createElement('button'); up.className='btn secondary'; up.textContent='↑'; up.onclick = ()=>{ if(idx>0){ [items[idx-1], items[idx]]=[items[idx], items[idx-1]]; renderMenu(items);} };
    const down = document.createElement('button'); down.className='btn secondary'; down.textContent='↓'; down.onclick = ()=>{ if(idx<items.length-1){ [items[idx+1], items[idx]]=[items[idx], items[idx+1]]; renderMenu(items);} };
    const del = document.createElement('button'); del.className='btn ghost'; del.textContent='Remover'; del.onclick = ()=>{ items.splice(idx,1); renderMenu(items); };
    lbl.oninput = ()=> items[idx].label = lbl.value; href.oninput = ()=> items[idx].href = href.value;
    row.appendChild(lbl); row.appendChild(href); row.appendChild(up); row.appendChild(down); row.appendChild(del);
    box.appendChild(row);
  });
  box.dataset.items = JSON.stringify(items);
}
el('addMenuItem')?.addEventListener('click', ()=>{ const list = el('menuList'); const cur = list.dataset.items ? JSON.parse(list.dataset.items) : []; cur.push({label: el('menuLabel').value || 'Novo', href: el('menuHref').value || '#'}); renderMenu(cur); });
el('saveMenu')?.addEventListener('click', async ()=>{ 
  const list = el('menuList'); 
  const rows = Array.from(list.querySelectorAll('div')).map(div=>{ const inputs = div.querySelectorAll('input'); return { label: inputs[0].value||'', href: inputs[1].value||''}; }).filter(i=>i.label||i.href); 
  const res = await api('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ menu_items: JSON.stringify(rows) }) }); 
  showMsg(res.ok ? 'Menu salvo' : (res.body && (res.body.error||res.body.message) || 'Erro'), !res.ok); 
});

/* ---------- USERS CRUD ---------- */
async function loadUsers(){
  const res = await api('/api/users');
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      showMsg('Autenticação necessária para carregar usuários. Abra o login...', true);
      createLoginBox();
      return;
    }
    showMsg('Erro ao carregar usuários: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
    return;
  }
  const users = res.body || [];
  const wrap = el('usersTableWrap'); wrap.innerHTML = '';
  if (!users || !users.length) { wrap.innerHTML = '<div class="muted">Nenhum usuário</div>'; return; }
  let html = '<table class="table"><thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Ações</th></tr></thead><tbody>';
  users.forEach(u => {
    html += `<tr><td>${escape(u.name)}</td><td>${escape(u.email)}</td><td>${escape(u.role)}</td>
      <td>
        <button class="btn secondary" data-edit="${u.id}">Editar</button>
        <button class="btn ghost" data-delete="${u.id}">Excluir</button>
      </td></tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('button[data-edit]').forEach(b => b.onclick = async (e)=>{
    const id = e.currentTarget.dataset.edit;
    const u = users.find(x=>String(x.id)===String(id));
    if (!u) return;
    const newName = prompt('Nome', u.name);
    const newRole = prompt('Role (operator/technician/admin/superadmin)', u.role);
    if (!newName) return;
    const res = await api('/api/users/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:newName, role:newRole }) });
    if (!res.ok) {
      if (res.status === 401) { createLoginBox(); showMsg('Faça login para editar usuário', true); return; }
      showMsg('Erro: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
    } else { showMsg('Usuário atualizado'); loadUsers(); }
  });

  wrap.querySelectorAll('button[data-delete]').forEach(b => b.onclick = async (e)=>{
    const id = e.currentTarget.dataset.delete;
    if (!confirm('Excluir usuário permanentemente?')) return;
    const res = await api('/api/users/' + id, { method:'DELETE' });
    if (!res.ok) {
      if (res.status === 401) { createLoginBox(); showMsg('Faça login para excluir', true); return; }
      showMsg('Erro: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
    } else { showMsg('Usuário excluído'); loadUsers(); }
  });
}

el('createUser')?.addEventListener('click', async ()=>{ 
  const name = el('userName').value.trim();
  const email = el('userEmail').value.trim();
  const password = el('userPass').value.trim();
  const role = el('userRole').value;
  if (!name || !email || !password) return alert('Preencha todos os campos');
  const res = await api('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, email, password, role }) });
  if (res.ok && res.body && res.body.id) { showMsg('Usuário criado'); el('userName').value=''; el('userEmail').value=''; el('userPass').value=''; loadUsers(); }
  else {
    if (res.status === 401) { createLoginBox(); showMsg('É necessário login para criar usuário', true); return; }
    showMsg('Erro ao criar usuário: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
  }
});

/* ---------- TECHNICIANS CRUD ---------- */
async function loadTechs(){
  const res = await api('/api/technicians');
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      showMsg('Autenticação necessária para carregar técnicos. Faça login.', true);
      createLoginBox();
      return;
    }
    showMsg('Erro ao carregar técnicos: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
    return;
  }
  const techs = res.body || [];
  const wrap = el('techTableWrap'); wrap.innerHTML = '';
  if (!techs || !techs.length) { wrap.innerHTML = '<div class="muted">Nenhum técnico</div>'; return; }
  let html = '<table class="table"><thead><tr><th>Nome</th><th>Email</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>';
  techs.forEach(t => {
    html += `<tr><td>${escape(t.display_name||t.user_name||'')}</td><td>${escape(t.email||'')}</td><td>${t.active? 'Sim':'Não'}</td>
      <td>
        <button class="btn secondary" data-edit="${t.id}">Editar</button>
        <button class="btn ghost" data-toggle="${t.id}" data-active="${t.active?0:1}">${t.active? 'Desativar':'Ativar'}</button>
        <button class="btn ghost" data-delete="${t.id}">Excluir</button>
      </td></tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  // attach events
  wrap.querySelectorAll('button[data-edit]').forEach(b=> b.onclick = async (e)=>{
    const id = e.currentTarget.dataset.edit;
    const t = techs.find(x=>String(x.id)===String(id));
    if (!t) return;
    const newName = prompt('Nome do técnico', t.display_name || '');
    if (!newName) return;
    // tentativa direta de PUT para renomear (se o servidor suportar)
    const res = await api('/api/technicians/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name: newName }) });
    if (!res.ok) {
      if (res.status === 401) { createLoginBox(); showMsg('Faça login para renomear técnico', true); return; }
      // fallback: criar novo + desativar antigo (se servidor não permitir PUT alterando nome)
      const createRes = await api('/api/technicians', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name: newName, user_id: t.user_id || null }) });
      if (createRes.ok && createRes.body && createRes.body.id) {
        await api('/api/technicians/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active:false }) });
        showMsg('Técnico renomeado (novo criado; antigo desativado).');
        loadTechs();
      } else {
        showMsg('Erro renomear técnico: ' + (createRes.body && (createRes.body.error||createRes.body.message) || createRes.status), true);
      }
    } else { showMsg('Técnico atualizado'); loadTechs(); }
  });

  wrap.querySelectorAll('button[data-toggle]').forEach(b=> b.onclick = async (e)=>{
    const id = e.currentTarget.dataset.toggle;
    const active = e.currentTarget.dataset.active === '1';
    const res = await api('/api/technicians/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active }) });
    if (!res.ok) {
      if (res.status === 401) { createLoginBox(); showMsg('Faça login para alterar técnico', true); return; }
      showMsg('Erro: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
    } else { showMsg('Atualizado'); loadTechs(); }
  });

  wrap.querySelectorAll('button[data-delete]').forEach(b=> b.onclick = async (e)=>{
    const id = e.currentTarget.dataset.delete;
    if (!confirm('Excluir técnico? (se servidor suportar DELETE)')) return;
    const res = await api('/api/technicians/' + id, { method:'DELETE' });
    if (!res.ok) {
      if (res.status === 401) { createLoginBox(); showMsg('Faça login para excluir técnico', true); return; }
      // fallback: desativar
      await api('/api/technicians/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active:false }) });
      showMsg('Servidor não permite DELETE; técnico foi desativado.');
      loadTechs();
    } else { showMsg('Técnico excluído'); loadTechs(); }
  });
}

el('createTech')?.addEventListener('click', async ()=>{
  const name = el('techName').value.trim();
  const email = el('techEmail').value.trim();
  if (!name) return alert('Informe nome');

  const tryCreate = async () => {
    let user_id = null;
    if (email) {
      const ru = await api('/api/users');
      if (ru.ok && ru.body) {
        const found = (ru.body||[]).find(u=>u.email === email);
        if (found) user_id = found.id;
      }
    }
    const res = await api('/api/technicians', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name: name, user_id, email: email || null }) });
    return res;
  };

  const res = await tryCreate();
  if (res.ok && res.body && res.body.id) {
    showMsg('Técnico criado');
    el('techName').value=''; el('techEmail').value=''; loadTechs();
    return;
  }

  if (res.status === 401 || res.status === 403) {
    showMsg('Login necessário para criar técnico. Faça login no box que abriu.', true);
    createLoginBox();
    const onLogin = async ()=> {
      window.removeEventListener('admin_inline_loggedin', onLogin);
      showMsg('Tentando criar técnico novamente...');
      const r2 = await tryCreate();
      if (r2.ok && r2.body && r2.body.id) { showMsg('Técnico criado'); loadTechs(); el('techName').value=''; el('techEmail').value=''; }
      else showMsg('Falha ao criar técnico: ' + (r2.body && (r2.body.error||r2.body.message) || r2.status), true);
    };
    window.addEventListener('admin_inline_loggedin', onLogin);
    return;
  }

  showMsg('Erro ao criar técnico: ' + (res.body && (res.body.error||res.body.message) || res.status), true);
});

/* ---------- util ---------- */
function escape(s=''){ return String(s).replace(/[&<>"']/g, (m)=>( {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] )); }

/* ---------- init ---------- */
async function init(){
  el('saveSite')?.addEventListener('click', saveSite);
  el('saveNaming')?.addEventListener('click', saveNaming);
  el('backHome')?.addEventListener('click', ()=> location.href = '/');
  el('logout')?.addEventListener('click', ()=> fetch('/api/logout',{method:'POST',credentials:'include'}).then(()=>location.href='/'));
  el('toReports')?.addEventListener('click', ()=> location.href = '/stats.html');

  await loadSettings();
  await loadUsers();
  await loadTechs();
}
document.addEventListener('DOMContentLoaded', init);
