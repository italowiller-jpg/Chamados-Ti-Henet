// public/superadmin-reports.js
// Relatórios SuperAdmin — versão robusta e compatível com server.js fornecido
// Requisitos: Chart.js já carregado no HTML (por ex. <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>)

function el(id){ return document.getElementById(id); }
function show(msg, err=false){ const m = el('messages'); if(!m) return; m.style.color = err? '#c00':'#666'; m.innerText = msg; }
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g, (m)=>( {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] )); }

// api helper que retorna json ou lança erro com mensagem
async function api(path, opts={}) {
  const merged = { credentials:'include', ...opts };
  let res;
  try {
    res = await fetch(path, merged);
  } catch (err) {
    console.error('Network error', err);
    throw new Error('Network error');
  }
  // tratar 401/403 com mensagem clara (frontend precisa saber)
  if (res.status === 401 || res.status === 403) {
    const txt = await res.text().catch(()=>null);
    const normalized = txt && txt.length < 500 ? txt : null;
    throw new Error(normalized || `Unauthorized (${res.status})`);
  }
  const txt = await res.text();
  let body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch(e) { body = txt; }
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

let charts = {};
function destroyChart(id){
  try { if (charts[id]) { charts[id].destroy(); charts[id] = null; } } catch(e){ console.warn('destroyChart', e); }
}
function createOrUpdateChart(id, cfg) {
  const ctx = el(id);
  if (!ctx) return;
  // destroy existing
  destroyChart(id);
  charts[id] = new Chart(ctx, cfg);
}

/* ---------- UI rendering ---------- */
function renderSummary(rows){
  const wrap = el('summaryTable'); if(!wrap) return;
  let html = '<table class="table"><thead><tr><th>Técnico</th><th>Total</th><th>Concluídos</th><th>Em andamento</th><th>Tempo médio (h)</th></tr></thead><tbody>';
  (rows||[]).forEach(r=>{
    html += `<tr>
      <td>${escapeHtml(r.display_name||('Téc '+r.tech_id))}</td>
      <td>${r.total_tickets||0}</td>
      <td>${r.resolved_count||0}</td>
      <td>${r.in_progress_count||0}</td>
      <td>${(r.avg_resolution_hours !== null && r.avg_resolution_hours !== undefined) ? Number(r.avg_resolution_hours).toFixed(1) : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

/* ---------- Load helpers ---------- */
async function loadTechSelect(){
  try {
    const techs = await api('/api/technicians'); // public endpoint in server.js
    const sel = el('filterTech');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Todos —</option>';
    (techs||[]).forEach(t => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.display_name || t.user_name || t.email || ('Téc '+t.id);
      sel.appendChild(o);
    });
  } catch(err){
    console.warn('loadTechSelect error', err);
    show('Não foi possível carregar técnicos. (ver console)', true);
  }
}

async function loadSummaryAndDistribution(){
  show('Carregando resumo...');
  try {
    const summary = await api('/api/techs/summary');
    renderSummary(summary || []);
  } catch(err){
    console.error('loadSummaryAndDistribution error', err);
    show('Erro ao carregar resumo: ' + err.message, true);
    return;
  }

  // carregar distribuições via /api/stats
  try{
    const stats = await api('/api/stats');
    const byStatus = (stats.byStatus || []).map(s => ({ label: s.status, cnt: s.cnt }));
    const statusLabels = byStatus.map(s => (s.label === 'new' ? 'Novo' : (s.label === 'in_progress' ? 'Em andamento' : (s.label === 'resolved' ? 'Concluído' : s.label))));
    const statusData = byStatus.map(s => s.cnt || 0);

    createOrUpdateChart('chartStatus', {
      type: 'doughnut',
      data: { labels: statusLabels, datasets: [{ label: 'Status', data: statusData }] },
      options: { plugins:{legend:{position:'bottom'}} }
    });

    const byUrg = (stats.byUrgency || []).map(u => ({ label: u.urgency, cnt: u.cnt }));
    const urgLabels = byUrg.map(u => (u.label === 'low' ? 'Baixa' : (u.label === 'medium' ? 'Média' : (u.label === 'high' ? 'Alta' : (u.label === 'critical' ? 'Crítica' : u.label)))));
    const urgData = byUrg.map(u => u.cnt || 0);

    createOrUpdateChart('chartUrgency', {
      type: 'pie',
      data: { labels: urgLabels, datasets: [{ label:'Urgência', data: urgData }] },
      options: { plugins:{legend:{position:'bottom'}} }
    });

    show('');
  } catch(err){
    console.error('load distributions error', err);
    show('Resumo carregado, mas falha nas distribuições: ' + err.message, true);
  }
}

async function loadTimeSeries(techId, days){
  show('Carregando série temporal...');
  try {
    let labels = [], created = [], resolved = [];
    if (techId) {
      const r = await api(`/api/techs/${encodeURIComponent(techId)}/timeseries?days=${Number(days||30)}`);
      labels = (r.created||[]).map(x => x.day);
      created = (r.created||[]).map(x => x.cnt || 0);
      resolved = (r.resolved||[]).map(x => x.cnt || 0);
    } else {
      // fallback cliente: buscar tickets e agregar por dia (criados)
      const all = await api('/api/tickets'); // for admin, returns all
      const mapCreate = {};
      (all||[]).forEach(t => {
        const day = (t.created_at || '').slice(0,10) || null;
        if (!day) return;
        mapCreate[day] = (mapCreate[day] || 0) + 1;
      });
      labels = Object.keys(mapCreate).sort();
      created = labels.map(l => mapCreate[l] || 0);
      // resolved: best-effort by checking status === resolved and updated_at date
      const mapResolved = {};
      (all||[]).forEach(t => {
        if (t.status === 'resolved' && t.updated_at) {
          const day = (t.updated_at || '').slice(0,10);
          mapResolved[day] = (mapResolved[day] || 0) + 1;
        }
      });
      resolved = labels.map(l => mapResolved[l] || 0);
    }

    createOrUpdateChart('chartTimeseries', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Criados', data: created, tension: 0.2, fill:false },
          { label: 'Resolvidos', data: resolved, tension: 0.2, fill:false }
        ]
      },
      options: { plugins:{legend:{position:'bottom'}}, interaction:{mode:'index',intersect:false}, stacked:false }
    });

    show('');
  } catch(err){
    console.error('loadTimeSeries error', err);
    show('Erro ao carregar série temporal: ' + err.message, true);
  }
}

/* ---------- filters & exports ---------- */
function collectFilters(){
  return {
    tech: el('filterTech')?.value || '',
    status: el('filterStatus')?.value || '',
    urgency: el('filterUrgency')?.value || '',
    days: Number(el('filterDays')?.value || 30)
  };
}

async function fetchFilteredTickets(){
  const f = collectFilters();
  try {
    // server /api/tickets supports status & urgency filters
    const params = [];
    if (f.status) params.push('status=' + encodeURIComponent(f.status));
    if (f.urgency) params.push('urgency=' + encodeURIComponent(f.urgency));
    const url = '/api/tickets' + (params.length ? ('?' + params.join('&')) : '');
    const all = await api(url);
    const filtered = (all||[]).filter(t => {
      if (f.tech && String(t.assigned_to) !== String(f.tech)) return false;
      if (f.days) {
        const cutoff = new Date(Date.now() - f.days * 24*3600*1000);
        const created = t.created_at ? new Date(t.created_at) : null;
        if (!created) return false;
        if (created < cutoff) return false;
      }
      return true;
    });
    return filtered;
  } catch(err){
    console.error('fetchFilteredTickets error', err);
    throw err;
  }
}

function rowsToCSV(rows){
  if (!rows || !rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = v => { if (v===null||v===undefined) return ''; const s = String(v).replace(/"/g,'""'); return `"${s}"`; };
  let csv = keys.join(',') + '\n';
  csv += rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
  return csv;
}

async function exportCSV(){
  show('Preparando exportação...');
  try {
    const rows = await fetchFilteredTickets();
    const mapped = rows.map(r => ({
      id: r.id, title: r.title, requester: r.requester_name, assigned: r.assigned_name || r.assigned_to, status: r.status, urgency: r.urgency, created_at: r.created_at
    }));
    const csv = rowsToCSV(mapped);
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tickets_export.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    show('Exportado CSV');
  } catch(err){
    console.error('exportCSV error', err);
    show('Erro exportando CSV: ' + err.message, true);
  }
}

async function exportJSON(){
  show('Preparando exportação JSON...');
  try {
    const rows = await fetchFilteredTickets();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tickets_export.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    show('Exportado JSON');
  } catch(err){
    console.error('exportJSON error', err);
    show('Erro exportando JSON: ' + err.message, true);
  }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  el('backBtn')?.addEventListener('click', ()=> location.href = '/');
  el('openAdm')?.addEventListener('click', ()=> location.href = '/admin-edit.html');
  el('btnApply')?.addEventListener('click', async ()=> {
    const f = collectFilters();
    await loadTimeSeries(f.tech, f.days);
    await loadSummaryAndDistribution();
  });
  el('exportCSV')?.addEventListener('click', exportCSV);
  el('exportJSON')?.addEventListener('click', exportJSON);

  // initial load
  await loadTechSelect();
  // try to load reports (if not allowed, show message)
  try {
    await loadSummaryAndDistribution();
  } catch(e){
    console.warn('initial summary load failed', e);
  }
  try {
    await loadTimeSeries(el('filterTech')?.value || '', Number(el('filterDays')?.value || 30));
  } catch(e){
    console.warn('initial timeseries load failed', e);
  }
});
