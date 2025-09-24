// public/superadmin-reports.js
(async () => {
  const $ = id => document.getElementById(id);
  const apiBase = p => `/api${p}`;

  // Charts
  let mainChart = null;

  // util: parse date strings robusto (suporta "YYYY-MM-DD HH:mm:ss" e ISO)
  function parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    let str = String(s);
    // troca ' ' por 'T' quando no formato SQL datetime
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) str = str.replace(' ', 'T');
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // retorna string YYYY-MM-DD
  function fmtDay(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // retorna YYYY-Www (ISO week)
  function getISOWeekKey(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Thursday in current week decides the year.
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
  }

  // retorna YYYY-MM
  function fmtMonth(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function hoursBetween(a,b) {
    if (!a || !b) return null;
    return (b.getTime() - a.getTime()) / (1000*60*60);
  }

  // groupByKey: 'day' | 'week' | 'month'
  function getGroupKeyForDate(d, groupBy) {
    if (!d) return '';
    if (groupBy === 'week') return getISOWeekKey(d);
    if (groupBy === 'month') return fmtMonth(d);
    return fmtDay(d);
  }

  // aggregation helpers
  function aggregateTimeseries(tickets, groupBy) {
    const counts = {}; // key: count
    const resTime = {}; // key: array of resolution hours
    tickets.forEach(t => {
      const created = parseDate(t.created_at);
      if (!created) return;
      const key = getGroupKeyForDate(created, groupBy);
      counts[key] = (counts[key]||0) + 1;

      // resolution time: between created and closed (fallback to updated_at or now)
      let closed = null;
      if (t.closed_at) closed = parseDate(t.closed_at);
      else if (t.updated_at) closed = parseDate(t.updated_at);
      else if (t.status === 'resolved' || t.status === 'closed') closed = parseDate(t.updated_at) || new Date(); // try updated_at; else fallback
      else closed = null;

      const end = closed || null;
      if (end) {
        const h = hoursBetween(created, end);
        if (h !== null && !Number.isNaN(h)) {
          (resTime[key] = resTime[key] || []).push(h);
        }
      }
    });
    // sort keys chronologically
    const sortedKeys = Object.keys(counts).sort((a,b)=>{
      // parse key to date approximation
      const pa = parseGroupKey(a); const pb = parseGroupKey(b);
      return pa - pb;
    });
    const labels = sortedKeys;
    const data = labels.map(k => counts[k]||0);
    const avgResHours = labels.map(k => {
      const arr = resTime[k] || [];
      if (!arr.length) return null;
      const sum = arr.reduce((s,x)=>s+x,0);
      return sum/arr.length;
    });
    return { labels, data, avgResHours };
  }

  function parseGroupKey(k) {
    // day: YYYY-MM-DD => Date
    if (!k) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return new Date(k + 'T00:00:00').getTime();
    if (/^\d{4}-W\d{2}$/.test(k)) {
      // approximate week -> first day of week
      const [y,w] = k.split('-W').map(Number);
      const d = new Date(y,0,1);
      const weekStart = new Date(d.getTime() + (w-1)*7*24*3600*1000);
      return weekStart.getTime();
    }
    if (/^\d{4}-\d{2}$/.test(k)) return new Date(k + '-01T00:00:00').getTime();
    return 0;
  }

  // compute KPIs and tech summary
  function computeKPIs(tickets, techs) {
    const total = tickets.length;
    const open = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
    const closed = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
    const techCount = (techs || []).length;

    // SLA: count tickets with resolution time <= 3 hours (only for tickets that have resolution info or approximate)
    let slaCount = 0, slaTotalConsidered = 0;
    let techSummary = {}; // id -> {id,name,count,avgHours}
    tickets.forEach(t => {
      const created = parseDate(t.created_at);
      if (!created) return;
      let closed = null;
      if (t.closed_at) closed = parseDate(t.closed_at);
      else if (t.updated_at) closed = parseDate(t.updated_at);
      else if (t.status === 'resolved' || t.status === 'closed') closed = parseDate(t.updated_at) || null;
      // only consider for SLA if we have a closed time, otherwise skip (open tickets are not counted in SLA numerator but can be flagged)
      if (closed) {
        const h = hoursBetween(created, closed);
        if (!Number.isNaN(h) && isFinite(h)) {
          slaTotalConsidered++;
          if (h <= 3) slaCount++;
        }
      }
      // tech summary
      const techKey = t.assigned_to ? String(t.assigned_to) : '__unassigned';
      if (!techSummary[techKey]) techSummary[techKey] = { id: techKey, name: t.assigned_name || (t.assigned_to? t.assigned_to : '—'), count:0, times:[] };
      techSummary[techKey].count++;
      if (closed) {
        const h = hoursBetween(created, closed);
        if (!Number.isNaN(h) && isFinite(h)) techSummary[techKey].times.push(h);
      }
    });
    // compute avg times
    const techArr = Object.values(techSummary).map(t=>{
      const avg = t.times.length ? (t.times.reduce((s,x)=>s+x,0)/t.times.length) : null;
      return { id: t.id, name: t.name, count: t.count, avgHours: avg };
    }).sort((a,b)=>b.count - a.count);
    const slaPercent = slaTotalConsidered ? Math.round((slaCount/slaTotalConsidered)*100) : 0;
    return { total, open, closed, techCount, slaPercent, techSummary: techArr };
  }

  // draw charts
  function renderCharts(labels, counts, avgResHours) {
    const ctx = $('chart').getContext('2d');
    if (mainChart) mainChart.destroy();
    mainChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type:'bar', label: 'Chamados', data: counts, backgroundColor: '#06b6d4' },
          { type:'line', label: 'Média resolução (h)', data: avgResHours.map(v => v===null? null: Number(v.toFixed(2))), borderColor:'#f97316', backgroundColor:'#f9731666', yAxisID:'y2', tension:0.25, spanGaps:true }
        ]
      },
      options: {
        responsive:true,
        interaction:{mode:'index', intersect:false},
        scales: {
          y: { beginAtZero:true, position:'left', title:{display:true, text:'Chamados'} },
          y2: { beginAtZero:true, position:'right', grid:{drawOnChartArea:false}, title:{display:true, text:'Horas'} }
        },
        plugins: {
          legend: { labels: { usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: function(context) {
                if (context.dataset.type === 'line') return `${context.dataset.label}: ${context.parsed.y !== null ? context.parsed.y + ' h' : '—'}`;
                return `${context.dataset.label}: ${context.parsed.y}`;
              }
            }
          }
        }
      }
    });

    // draw SLA horizontal line on the line scale by adding plugin
    const slaHour = 3;
    // We will overlay a horizontal line using plugin
    Chart.register({
      id: 'slaLine',
      afterDraw: chart => {
        const yScale = chart.scales['y2'];
        if (!yScale) return;
        const ctx = chart.ctx;
        const y = yScale.getPixelForValue(slaHour);
        ctx.save();
        ctx.strokeStyle = '#ff4d4d';
        ctx.setLineDash([6,4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, y);
        ctx.lineTo(chart.chartArea.right, y);
        ctx.stroke();
        ctx.fillStyle = '#ff4d4d';
        ctx.font = '12px Arial';
        ctx.fillText('SLA 3 h', chart.chartArea.right - 60, y - 6);
        ctx.restore();
      }
    });
  }

  // render table and tech summary
  function renderTableAndTech(tickets, techSummary) {
    const tbody = $('reports-body');
    tbody.innerHTML = '';
    tickets.sort((a,b)=> {
      const da = parseDate(a.created_at) || new Date(0);
      const db = parseDate(b.created_at) || new Date(0);
      return db - da;
    }).forEach(t => {
      const tr = document.createElement('tr');
      const created = parseDate(t.created_at);
      let closed = null;
      if (t.closed_at) closed = parseDate(t.closed_at);
      else if (t.updated_at) closed = parseDate(t.updated_at);
      else if (t.status === 'resolved' || t.status === 'closed') closed = parseDate(t.updated_at) || null;
      const hours = (created && closed) ? Number(hoursBetween(created, closed).toFixed(2)) : (created? Number(hoursBetween(created, new Date()).toFixed(2)): null);
      const hoursCell = hours !== null ? `${hours} h` : '—';
      tr.innerHTML = `<td>${t.id}</td>
                      <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.title||'—')}</td>
                      <td>${escapeHtml(t.status||'—')}</td>
                      <td>${escapeHtml(t.assigned_name||'-')}</td>
                      <td>${hoursCell}</td>
                      <td>${created? created.toLocaleString() : '-'}</td>`;
      tbody.appendChild(tr);
    });

    const summ = $('tech-summary');
    summ.innerHTML = '';
    techSummary.forEach(t => {
      const d = document.createElement('div');
      d.className = 'tech-row';
      d.innerHTML = `<div style="font-weight:600">${escapeHtml(t.name||'—')}</div><div>${t.count} chamados • ${t.avgHours !== null ? (t.avgHours.toFixed(2) + ' h') : '—'}</div>`;
      summ.appendChild(d);
    });
  }

  // CSV export
  function downloadCSV(rows, filename='relatorios.csv') {
    const headers = ['id','title','status','assigned_name','created_at','closed_at','duration_hours','in_sla'];
    const lines = [headers.join(',')];
    rows.forEach(r => {
      const esc = v => `"${String(v===null||v===undefined?'':v).replace(/"/g,'""')}"`;
      lines.push([
        esc(r.id),
        esc(r.title),
        esc(r.status),
        esc(r.assigned_name),
        esc(r.created_at),
        esc(r.closed_at || ''),
        esc(r.duration_hours!==null? r.duration_hours : ''),
        esc(r.in_sla? 'true' : 'false')
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // main loader
  async function loadReports(from, to, group) {
    try {
      // fetch tickets and technicians from existing APIs
      const q = (from||to) ? `?from=${encodeURIComponent(from||'')}&to=${encodeURIComponent(to||'')}` : '';
      // The /api/tickets endpoint probably ignores from/to on server; we fetch all and filter client-side
      const tickets = await fetch(apiBase('/tickets')).then(r=>r.ok? r.json(): []);
      const techs = await fetch(apiBase('/technicians')).then(r=>r.ok? r.json(): []);

      // filter by date if from/to provided (based on created_at)
      let filtered = tickets.slice();
      if (from) {
        const f = parseDate(from + 'T00:00:00');
        filtered = filtered.filter(t => {
          const c = parseDate(t.created_at);
          return c && c >= f;
        });
      }
      if (to) {
        // include all day of 'to'
        const tEnd = new Date(parseDate(to + 'T00:00:00').getTime() + 24*3600*1000 - 1);
        filtered = filtered.filter(t => {
          const c = parseDate(t.created_at);
          return c && c <= tEnd;
        });
      }

      // compute kpis
      const { total, open, closed, techCount, slaPercent, techSummary } = computeKPIs(filtered, techs);
      $('k-chamados').textContent = total;
      $('k-abertos').textContent = open;
      $('k-fechados').textContent = closed;
      $('k-techs').textContent = techCount;
      $('k-sla').textContent = slaPercent + '%';

      // timeseries
      const grouped = aggregateTimeseries(filtered, group);
      // render charts
      renderCharts(grouped.labels, grouped.data, grouped.avgResHours);

      // render table and tech summary
      renderTableAndTech(filtered, techSummary);

      // prepare CSV rows for export
      const csvRows = filtered.map(t => {
        const created = parseDate(t.created_at);
        let closed = null;
        if (t.closed_at) closed = parseDate(t.closed_at);
        else if (t.updated_at) closed = parseDate(t.updated_at);
        else if (t.status === 'resolved' || t.status === 'closed') closed = parseDate(t.updated_at) || null;
        const duration_hours = (created && closed) ? Number(hoursBetween(created, closed).toFixed(2)) : (created ? Number(hoursBetween(created, new Date()).toFixed(2)) : null);
        const in_sla = (duration_hours !== null) ? (duration_hours <= 3) : false;
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          assigned_name: t.assigned_name,
          created_at: t.created_at,
          closed_at: t.closed_at || t.updated_at || '',
          duration_hours,
          in_sla
        };
      });

      // attach CSV handler with prepared rows
      $('export-csv').onclick = () => downloadCSV(csvRows, 'relatorios.csv');

    } catch (err) {
      console.error('loadReports error', err);
      alert('Erro ao carregar relatórios — veja console');
    }
  }

  // UI wiring
  $('apply').addEventListener('click', async () => {
    const from = $('from').value || '';
    const to = $('to').value || '';
    const group = $('groupBy').value || 'day';
    await loadReports(from, to, group);
  });

  $('refresh').addEventListener('click', async () => {
    $('from').value = ''; $('to').value = ''; $('groupBy').value = 'day';
    await loadReports();
  });

  // initial load
  await loadReports();

})();
