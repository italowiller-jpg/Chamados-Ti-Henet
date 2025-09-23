// reports.js
// Versão modular (ESM). Ajuste endpoints conforme sua API.
import { saveAs } from "https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js";

const API_BASE = '/api';
const REPORTS_ENDPOINT = `${API_BASE}/chamados`;   // em vez de /reports
const USERS_ENDPOINT = `${API_BASE}/usuarios`;     // em vez de /users


// Util: cabecalhos de auth (se usar token, defina aqui)
function authHeaders() {
  // Se você usa token localStorage:
  // const token = localStorage.getItem('token');
  // return token ? { 'Authorization': 'Bearer ' + token } : {};
  return { 'Content-Type': 'application/json' }; // cookies de sessão não precisam
}

// Estado
let table = null;
let chart = null;
let currentData = [];

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  initDateRange();
  initTable();
  loadUsers();
  attachEventHandlers();
  fetchAndRender(); // renderiza com filtros default
});

function initDateRange() {
  flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "Y-m-d",
    locale: "pt",
    onClose: function(selectedDates, dateStr) { /* opcional */ }
  });
}

function attachEventHandlers() {
  document.getElementById('btnApply').addEventListener('click', fetchAndRender);
  document.getElementById('btnReset').addEventListener('click', () => {
    document.getElementById('dateRange').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterPriority').value = '';
    document.getElementById('filterUser').value = '';
    fetchAndRender();
  });
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportPDF').addEventListener('click', exportPDF);
}

async function loadUsers() {
  try {
    const res = await fetch(`${USERS_ENDPOINT}`, { headers: authHeaders() });
    if(!res.ok) throw new Error('Erro ao carregar técnicos');
    const users = await res.json();
    const sel = document.getElementById('filterUser');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.username || u.email || ''})`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.warn('loadUsers:', err);
  }
}

function buildQueryFromFilters() {
  const dateRange = document.getElementById('dateRange').value;
  const [start, end] = dateRange ? dateRange.split(' to ').map(s => s.trim()) : [null, null];
  const status = document.getElementById('filterStatus').value;
  const priority = document.getElementById('filterPriority').value;
  const user = document.getElementById('filterUser').value;

  const params = new URLSearchParams();
  if (start) params.append('start_date', start);
  if (end) params.append('end_date', end);
  if (status) params.append('status', status);
  if (priority) params.append('priority', priority);
  if (user) params.append('user_id', user);

  // paginação / limit pode ser adicionado
  params.append('limit', '1000'); // ajustar; servidor deve suportar
  return params.toString();
}

async function fetchAndRender() {
  const q = buildQueryFromFilters();
  const url = `${REPORTS_ENDPOINT}?${q}`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const json = await res.json();
    // Estrutura esperada: { data: [ {id, title, requester, assignee, priority, status, opened_at, hours_spent, ...}], meta: {...} }
    const data = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    currentData = data;
    renderKpis(data);
    renderChart(data);
    populateTable(data);
  } catch (err) {
    console.error('fetchAndRender', err);
    alert('Falha ao carregar relatórios. Veja console para detalhes.');
  }
}

function renderKpis(data) {
  document.getElementById('kpi_total').textContent = data.length;
}

function renderChart(data) {
  // Exemplo: chamdos por dia
  const countsByDate = {};
  data.forEach(r => {
    const d = r.opened_at ? r.opened_at.slice(0,10) : 'Sem data';
    countsByDate[d] = (countsByDate[d]||0) + 1;
  });
  const labels = Object.keys(countsByDate).sort();
  const values = labels.map(l => countsByDate[l]);

  const ctx = document.getElementById('chartArea').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Chamados abertos',
        data: values,
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13,110,253,0.15)',
        fill: true,
        tension: 0.2,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { title: { display: false } },
        y: { beginAtZero: true }
      }
    }
  });
}

function initTable() {
  // Usando DataTables (jQuery dependência já carregada via CDN DataTables)
  // Note: se não quiser jQuery, pode implementar tabela manual.
  $(document).ready(function() {
    table = $('#reportsTable').DataTable({
      columns: [
        { data: 'id' },
        { data: 'title' },
        { data: 'requester' },
        { data: 'assignee' },
        { data: 'priority' },
        { data: 'status' },
        { data: 'opened_at' },
        { data: 'hours_spent' },
        { data: null, orderable: false }
      ],
      order: [[6, 'desc']],
      pageLength: 15,
      language: {
        url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/Portuguese-Brasil.json'
      },
      createdRow: function(row, data) {
        // ações
        const actionsCell = $('td', row).eq(8);
        const btn = $('<button class="btn btn-sm btn-primary">Ver</button>');
        btn.on('click', () => openDetailModal(data.id));
        actionsCell.empty().append(btn);
      }
    });
  });
}

function populateTable(data) {
  if (!table) return setTimeout(() => populateTable(data), 100); // aguarda DataTables init
  table.clear();
  // formata algumas colunas
  const rows = data.map(r => ({
    id: r.id,
    title: r.title || r.subject || '(sem título)',
    requester: r.requester_name || r.requester || r.client || '-',
    assignee: r.assignee_name || r.assignee || '-',
    priority: formatPriority(r.priority),
    status: formatStatus(r.status),
    opened_at: r.opened_at ? new Date(r.opened_at).toLocaleString('pt-BR') : '-',
    hours_spent: r.hours_spent ?? r.time_spent ?? '-',
    raw: r
  }));
  table.rows.add(rows).draw();
}

function formatPriority(p) {
  if(!p) return '-';
  const map = { low: 'Baixa', medium: 'Média', high: 'Alta' };
  return map[p] || String(p);
}
function formatStatus(s) {
  if(!s) return '-';
  const map = { open: '<span class="badge bg-warning text-dark">Aberto</span>', in_progress: '<span class="badge bg-info text-dark">Em Andamento</span>', closed: '<span class="badge bg-success">Fechado</span>' };
  return map[s] || s;
}

async function openDetailModal(id) {
  // Busca detalhe do chamado
  try {
    const res = await fetch(`${REPORTS_ENDPOINT}/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Erro ao buscar detalhe');
    const r = await res.json();
    showModalDetail(r);
  } catch (err) {
    console.error('openDetailModal', err);
    alert('Falha ao carregar detalhe do chamado');
  }
}

function showModalDetail(data) {
  const modal = new bootstrap.Modal(document.getElementById('modalDetail'));
  document.getElementById('modalTitle').textContent = `#${data.id} — ${data.title || data.subject || 'Detalhes'}`;
  const body = document.getElementById('modalBody');
  body.innerHTML = `
    <dl class="row">
      <dt class="col-sm-3">Solicitante</dt><dd class="col-sm-9">${data.requester_name || data.requester || '-'}</dd>
      <dt class="col-sm-3">Técnico</dt><dd class="col-sm-9">${data.assignee_name || data.assignee || '-'}</dd>
      <dt class="col-sm-3">Prioridade</dt><dd class="col-sm-9">${formatPriority(data.priority)}</dd>
      <dt class="col-sm-3">Status</dt><dd class="col-sm-9">${data.status}</dd>
      <dt class="col-sm-3">Abertura</dt><dd class="col-sm-9">${data.opened_at ? new Date(data.opened_at).toLocaleString('pt-BR') : '-'}</dd>
      <dt class="col-sm-3">Descrição</dt><dd class="col-sm-9"><div>${(data.description || '').replace(/\n/g,'<br>')}</div></dd>
    </dl>
    <hr />
    <h6>Atividades / Logs</h6>
    <div>${renderActivities(data.activities || data.logs || [])}</div>
  `;
  modal.show();
}

function renderActivities(acts) {
  if (!acts.length) return '<div class="small-muted">Nenhuma atividade registrada</div>';
  return '<ul class="list-group">' + acts.map(a => `<li class="list-group-item"><small class="text-muted">${new Date(a.date || a.created_at).toLocaleString('pt-BR')}</small><div>${a.note || a.text || a.description}</div></li>`).join('') + '</ul>';
}

// Export CSV usando SheetJS
function exportCSV() {
  if (!currentData.length) return alert('Sem dados para exportar');
  const ws_data = [
    ['ID','Título','Solicitante','Técnico','Prioridade','Status','Abertura','Horas']
  ];
  currentData.forEach(r => {
    ws_data.push([
      r.id,
      r.title || r.subject,
      r.requester_name || r.requester,
      r.assignee_name || r.assignee,
      r.priority,
      r.status,
      r.opened_at,
      r.hours_spent ?? ''
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, 'Relatórios');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout],{type:"application/octet-stream"}), `relatorios_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// Export PDF básico via jsPDF (simplificado)
async function exportPDF() {
  if (!currentData.length) return alert('Sem dados para exportar');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(12);
  doc.text('Relatório de Chamados', 14, 16);
  const headers = [['ID','Título','Solicitante','Técnico','Prioridade','Status','Abertura']];
  const rows = currentData.map(r => [
    r.id,
    (r.title || r.subject || '').substring(0,40),
    r.requester_name || r.requester || '',
    r.assignee_name || r.assignee || '',
    r.priority || '',
    r.status || '',
    r.opened_at ? new Date(r.opened_at).toLocaleString('pt-BR') : ''
  ]);
  doc.autoTable({
    head: headers,
    body: rows,
    startY: 22,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [13,110,253] }
  });
  doc.save(`relatorio_${new Date().toISOString().slice(0,10)}.pdf`);
}

// Nota: jsPDF autoTable plugin normalmente necessário; se não existir, exportPDF pode usar uma alternativa (ex: imprimir a tabela html)
