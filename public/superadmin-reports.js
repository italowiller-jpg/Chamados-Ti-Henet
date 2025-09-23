// superadmin-reports.js
(async ()=> {
  const $ = id => document.getElementById(id);
  const api = p => `/api${p}`;

  let chart;
  function createChart(labels, data){
    const ctx = $('chart').getContext('2d');
    if(chart) chart.destroy();
    chart = new Chart(ctx, {
      type:'line',
      data:{labels, datasets:[{label:'Chamados', data, fill:true, tension:0.25}]},
      options:{scales:{y:{beginAtZero:true}}}
    });
  }

  async function loadReports(from,to,group){
    const q = `?from=${from||''}&to=${to||''}&group=${group||'day'}`;
    const res = await fetch(api('/reports'+q));
    const json = await res.json();
    // json expected: {kpis:{}, timeseries:{labels:[],data:[]}, list:[], techSummary:[]}
    $('k-chamados').textContent = json.kpis.total || 0;
    $('k-abertos').textContent = json.kpis.open || 0;
    $('k-fechados').textContent = json.kpis.closed || 0;
    $('k-techs').textContent = json.kpis.techs || 0;
    createChart(json.timeseries.labels || [], json.timeseries.data || []);
    const tbody = $('reports-body');
    tbody.innerHTML = '';
    (json.list || []).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.status}</td><td>${r.tech||'-'}</td><td>${(new Date(r.date)).toLocaleString()}</td>
        <td><button data-id="${r.id}" class="view">Ver</button></td>`;
      tbody.appendChild(tr);
    });
    const summ = $('tech-summary');
    summ.innerHTML = '';
    (json.techSummary||[]).forEach(t=>{
      const d = document.createElement('div');
      d.style.display='flex';d.style.justifyContent='space-between';d.style.padding='8px 0';
      d.innerHTML = `<div>${t.name}</div><div>${t.count} chamados</div>`;
      summ.appendChild(d);
    });
  }

  $('apply').addEventListener('click', async ()=>{
    const from = $('from').value;
    const to = $('to').value;
    const group = $('groupBy').value;
    await loadReports(from,to,group);
  });

  $('export-csv').addEventListener('click', async ()=>{
    const res = await fetch(api('/reports/export'));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'relatorios.csv'; a.click();
    URL.revokeObjectURL(url);
  });

  // initial load
  await loadReports();
})();
