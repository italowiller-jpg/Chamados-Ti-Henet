// public/submit.js - versão com redirecionamento pós-envio
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    try { return await res.json(); } catch (e) { return null; }
  }
  try { return await res.json(); } catch (e) { return null; }
}

function showResult(msg, isError) {
  const el = document.getElementById('result');
  el.innerHTML = `<div class="card" style="padding:10px;margin:0;border-left:6px solid ${isError ? '#d33' : '#0f172a'}">${msg}</div>`;
}
function clearResult() { document.getElementById('result').innerHTML = ''; }

function setFileList(files) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.name} <span class="mini">(${Math.round(f.size/1024)} KB)</span></div>
      <div><button class="btn ghost small" data-idx="${i}">Remover</button></div>`;
    list.appendChild(item);
  }
  list.querySelectorAll('button[data-idx]').forEach(b => {
    b.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const input = document.getElementById('attachments');
      const dt = new DataTransfer();
      const cur = input.files;
      for (let i = 0; i < cur.length; i++) if (i !== idx) dt.items.add(cur[i]);
      input.files = dt.files;
      setFileList(input.files);
    };
  });
}

async function loadInit() {
  const sel = document.getElementById('category');
  sel.innerHTML = '<option value="">-- Selecionar tipo de solicitação --</option>';
  try {
    const cats = await fetchJSON('/api/categories');
    if (cats && Array.isArray(cats) && cats.length > 0) {
      cats.filter(c => c.active !== false).forEach(c => {
        const o = document.createElement('option'); o.value = c.id || c.name; o.textContent = c.name;
        sel.appendChild(o);
      });
    } else {
      ['Formatação/Instalação SO', 'Solicitação de equipamento', 'Suporte de rede', 'Acesso/Senha', 'Software/ERP', 'Outros']
        .forEach(name => { const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o); });
    }
  } catch (e) {
    ['Formatação/Instalação SO', 'Solicitação de equipamento', 'Suporte de rede', 'Acesso/Senha', 'Software/ERP', 'Outros']
      .forEach(name => { const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o); });
  }

  try {
    const s = await fetchJSON('/api/settings');
    if (s) {
      if (s.title) document.getElementById('siteTitle').innerText = s.title;
      if (s.subtitle) document.getElementById('siteSubtitle').innerText = s.subtitle;
    }
  } catch (e) { }

  try {
    const me = await fetch('/api/me', { credentials: 'include' });
    if (me.ok) {
      const user = await me.json();
      if (user) {
        if (user.name) document.getElementById('requester_name').value = user.name;
        if (user.email) document.getElementById('requester_email').value = user.email;
      }
    }
  } catch (e) { console.warn('Erro ao carregar usuário logado:', e); }
}
loadInit();

document.getElementById('attachments').addEventListener('change', (e) => {
  setFileList(e.target.files);
});

document.getElementById('submitBtn').addEventListener('click', async (ev) => {
  ev.preventDefault();
  clearResult();

  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const requester_name = document.getElementById('requester_name').value.trim();
  const requester_email = document.getElementById('requester_email').value.trim();
  const category_id = document.getElementById('category').value || null;
  const urgency = document.getElementById('urgency').value;
  const files = document.getElementById('attachments').files;

  if (!title) { showResult('Preencha o título do chamado.', true); return; }
  if (!description) { showResult('Descreva o problema.', true); return; }
  if (!requester_name) { showResult('Informe seu nome para contato.', true); return; }

  const form = new FormData();
  form.append('title', title);
  form.append('description', description);
  form.append('requester_name', requester_name);
  form.append('requester_email', requester_email);
  if (category_id) form.append('category_id', category_id);
  form.append('urgency', urgency);
  for (let i = 0; i < files.length; i++) form.append('attachments', files[i]);

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.innerText = 'Enviando...';

  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      body: form,
      credentials: 'include'
    });

    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }

    if (data && data.ok) {
      const protocolo = data.protocol || (data.ticket_number ? ('#' + data.ticket_number) : ('#' + (data.id || '—')));
      showResult(`✅ Chamado enviado! Protocolo: <strong>${protocolo}</strong><br>Você será redirecionado em 5 segundos...`, false);

      // limpa formulário
      document.getElementById('title').value = '';
      document.getElementById('description').value = '';
      document.getElementById('category').value = '';
      document.getElementById('urgency').value = 'medium';
      document.getElementById('attachments').value = '';
      setFileList([]);

      // aguarda 5s e decide destino
      setTimeout(async () => {
        try {
          const me = await fetch('/api/me', { credentials: 'include' });
          if (me.ok) {
            window.location.href = '/'; // monitoramento (dashboard)
          } else {
            window.location.href = '/'; // tela de login (index)
          }
        } catch (e) {
          window.location.href = '/';
        }
      }, 5000);

    } else {
      showResult((data && data.error) ? data.error : 'Erro ao enviar chamado', true);
    }
  } catch (err) {
    console.error(err);
    showResult(err.message || 'Erro de envio', true);
  } finally {
    btn.disabled = false; btn.innerText = 'Enviar Chamado';
  }
});
