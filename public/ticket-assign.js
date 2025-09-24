// public/ticket-assign.js
// Snippet para página de detalhe do ticket (coloque <script src="/ticket-assign.js"></script> na página de detalhe)
// Requer um botão no HTML: <button id="assignToMeBtn" class="btn small" style="display:none">Atribuir a mim</button>
// E que o JS saiba o ticketId (var ticketId = '...') ou que você injete: window.TICKET_ID

async function setupAssignButtons(ticketId) {
  if (!ticketId) return;
  try {
    const meRes = await fetch('/api/me', { credentials: 'include' });
    if (!meRes.ok) return;
    const me = await meRes.json();
    if (!me) return;

    const myTechRes = await fetch('/api/technicians/me', { credentials: 'include' });
    if (!myTechRes.ok) return;
    const myTech = await myTechRes.json();
    const assignBtn = document.getElementById('assignToMeBtn');
    if (!assignBtn) return;

    if (myTech) {
      assignBtn.style.display = 'inline-block';
      assignBtn.onclick = async () => {
        try {
          const res = await fetch(`/api/tickets/${ticketId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigned_to: myTech.id })
          });
          if (res.ok) {
            // reload or update UI
            window.location.reload();
          } else {
            const j = await res.json().catch(()=>null);
            alert('Erro ao atribuir: ' + (j && j.error ? j.error : res.statusText));
          }
        } catch (e) {
          console.error('assign error', e);
          alert('Erro ao atribuir, veja console.');
        }
      };
    } else {
      assignBtn.style.display = 'none';
    }
  } catch (e) {
    console.warn('setupAssignButtons error', e);
  }
}

// if you set window.TICKET_ID in the page, auto-init:
if (typeof window !== 'undefined' && window.TICKET_ID) {
  document.addEventListener('DOMContentLoaded', () => setupAssignButtons(window.TICKET_ID));
}
