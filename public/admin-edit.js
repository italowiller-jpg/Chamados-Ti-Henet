// public/admin-edit.js - adicionado suporte para aprovar/revogar usuários
document.addEventListener("DOMContentLoaded", () => {
  const tabs = {
    users: document.getElementById("tab-users"),
    techs: document.getElementById("tab-techs"),
  };
  const panes = {
    users: document.getElementById("pane-users"),
    techs: document.getElementById("pane-techs"),
  };
  const editor = {
    empty: document.getElementById("editorEmpty"),
    user: document.getElementById("editorUser"),
    tech: document.getElementById("editorTech"),
  };

  let selectedUser = null;
  let selectedTech = null;

  function switchTab(tab) {
    Object.keys(tabs).forEach(t => {
      tabs[t].classList.toggle("active", t === tab);
      panes[t].style.display = t === tab ? "block" : "none";
    });
    clearEditor();
  }
  if (tabs.users) tabs.users.addEventListener("click", () => switchTab("users"));
  if (tabs.techs) tabs.techs.addEventListener("click", () => switchTab("techs"));

  function clearEditor() {
    if (editor.empty) editor.empty.style.display = "block";
    if (editor.user) editor.user.style.display = "none";
    if (editor.tech) editor.tech.style.display = "none";
    selectedUser = null;
    selectedTech = null;
  }

  function openUserEditor(user) {
    if (!editor.user) return;
    if (editor.empty) editor.empty.style.display = "none";
    editor.user.style.display = "block";
    selectedUser = user;
    document.getElementById("editUserName").value = user.name;
    document.getElementById("editUserEmail").value = user.email;
    document.getElementById("editUserRole").value = user.role;
    document.getElementById("editUserPass").value = "";
    document.getElementById("editUserApproved").value = user.approved ? "true" : "false";
  }

  function openTechEditor(tech) {
    if (!editor.tech) return;
    if (editor.empty) editor.empty.style.display = "none";
    editor.user.style.display = "none";
    editor.tech.style.display = "block";
    selectedTech = tech;
    document.getElementById("editTechName").value = tech.display_name;
    document.getElementById("editTechEmail").value = tech.email || "";
    document.getElementById("editTechActive").value = String(tech.active);
  }

  async function loadUsers() {
    const res = await fetch("/api/users", { credentials: 'include' });
    if (!res.ok) return;
    const users = await res.json();
    const wrap = document.getElementById("usersTableWrap");
    let html = `<table class="table"><thead><tr>
      <th>Nome</th><th>Email</th><th>Role</th><th>Aprovado</th><th class="actions">Ações</th></tr></thead><tbody>`;
    users.forEach(u => {
      html += `<tr>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td><span class="badge">${u.role}</span></td>
        <td>${u.approved ? '<span class="approved-yes">Sim</span>' : '<span class="approved-no">Não</span>'}</td>
        <td class="actions">
          <button class="btn small" data-id="${u.id}" data-type="user" data-action="edit">Editar</button>
          <button class="btn" data-id="${u.id}" data-type="user" data-action="approve">${u.approved ? 'Revogar' : 'Aprovar'}</button>
          <button class="btn danger small" data-id="${u.id}" data-type="user" data-action="delete">Excluir</button>
        </td>
      </tr>`;
    });
    html += "</tbody></table>";
    if (wrap) wrap.innerHTML = html;
  }

  async function loadTechs() {
    const res = await fetch("/api/technicians", { credentials: 'include' });
    if (!res.ok) return;
    const techs = await res.json();
    const wrap = document.getElementById("techTableWrap");
    let html = `<table class="table"><thead><tr>
      <th>Nome</th><th>Email</th><th>Ativo</th><th class="actions">Ações</th></tr></thead><tbody>`;
    techs.forEach(t => {
      html += `<tr>
        <td>${t.display_name}</td><td>${t.email || "-"}</td><td>${t.active ? "✅" : "❌"}</td>
        <td class="actions">
          <button class="btn small" data-id="${t.id}" data-type="tech" data-action="edit">Editar</button>
          <button class="btn danger small" data-id="${t.id}" data-type="tech" data-action="delete">Excluir</button>
        </td>
      </tr>`;
    });
    html += "</tbody></table>";
    if (wrap) wrap.innerHTML = html;
  }

  const createUserBtn = document.getElementById("createUserBtn");
  if (createUserBtn) createUserBtn.addEventListener("click", async () => {
    const data = {
      name: document.getElementById("newUserName").value,
      email: document.getElementById("newUserEmail").value,
      password: document.getElementById("newUserPass").value,
      role: document.getElementById("newUserRole").value,
    };
    await fetch("/api/users", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    document.getElementById("newUserName").value = '';
    document.getElementById("newUserEmail").value = '';
    document.getElementById("newUserPass").value = '';
    await loadUsers();
  });

  const saveUserBtn = document.getElementById("saveUserBtn");
  if (saveUserBtn) saveUserBtn.addEventListener("click", async () => {
    if (!selectedUser) return;
    const data = {
      name: document.getElementById("editUserName").value,
      role: document.getElementById("editUserRole").value,
      approved: document.getElementById("editUserApproved").value === "true"
    };
    const newPass = document.getElementById("editUserPass").value;
    if (newPass) data.password = newPass;
    await fetch(`/api/users/${selectedUser.id}`, {
      method: "PUT",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await loadUsers();
    clearEditor();
  });

  const deleteUserBtn = document.getElementById("deleteUserBtn");
  if (deleteUserBtn) deleteUserBtn.addEventListener("click", async () => {
    if (!selectedUser) return;
    if (!confirm("Excluir este usuário?")) return;
    await fetch(`/api/users/${selectedUser.id}`, { method: "DELETE", credentials: 'include' });
    await loadUsers();
    clearEditor();
  });

  const createTechBtn = document.getElementById("createTechBtn");
  if (createTechBtn) createTechBtn.addEventListener("click", async () => {
    const data = {
      display_name: document.getElementById("newTechName").value,
      email: document.getElementById("newTechEmail").value,
    };
    await fetch("/api/technicians", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    document.getElementById("newTechName").value = '';
    document.getElementById("newTechEmail").value = '';
    await loadTechs();
  });

  const saveTechBtn = document.getElementById("saveTechBtn");
  if (saveTechBtn) saveTechBtn.addEventListener("click", async () => {
    if (!selectedTech) return;
    const data = {
      display_name: document.getElementById("editTechName").value,
      email: document.getElementById("editTechEmail").value,
      active: document.getElementById("editTechActive").value === "true",
    };
    await fetch(`/api/technicians/${selectedTech.id}`, {
      method: "PUT",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await loadTechs();
    clearEditor();
  });

  const deleteTechBtn = document.getElementById("deleteTechBtn");
  if (deleteTechBtn) deleteTechBtn.addEventListener("click", async () => {
    if (!selectedTech) return;
    if (!confirm("Excluir este técnico?")) return;
    await fetch(`/api/technicians/${selectedTech.id}`, { method: "DELETE", credentials: 'include' });
    await loadTechs();
    clearEditor();
  });

  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const type = btn.dataset.type;
    const action = btn.dataset.action;

    if (action === "edit") {
      if (type === "user") {
        const res = await fetch("/api/users", { credentials: 'include' });
        const all = await res.json();
        const user = all.find(u => u.id === id);
        if (user) openUserEditor(user);
      } else {
        const res = await fetch("/api/technicians", { credentials: 'include' });
        const all = await res.json();
        const tech = all.find(t => t.id === id);
        if (tech) openTechEditor(tech);
      }
    } else if (action === "delete") {
      if (type === "user") {
        if (!confirm("Excluir este usuário?")) return;
        await fetch(`/api/users/${id}`, { method: "DELETE", credentials: 'include' });
        await loadUsers();
      } else {
        if (!confirm("Excluir este técnico?")) return;
        await fetch(`/api/technicians/${id}`, { method: "DELETE", credentials: 'include' });
        await loadTechs();
      }
      clearEditor();
    } else if (action === "approve" && type === "user") {
      // toggle approve/revoke
      const res = await fetch("/api/users", { credentials: 'include' });
      const all = await res.json();
      const user = all.find(u => u.id === id);
      if (!user) return;
      const newApproved = !user.approved;
      if (!confirm(`${newApproved ? 'Aprovar' : 'Revogar'} usuário ${user.email}?`)) return;
      await fetch(`/api/users/${id}`, {
        method: "PUT", credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: newApproved })
      });
      await loadUsers();
      clearEditor();
    }
  });

  // Top buttons
  const backHomeBtn = document.getElementById("backHome");
  if (backHomeBtn) backHomeBtn.addEventListener("click", () => { window.location.href = "/index.html"; });
  const toReportsBtn = document.getElementById("toReports");
  if (toReportsBtn) toReportsBtn.addEventListener("click", () => { window.location.href = "/superadmin-reports.html"; });

  const logoutBtnDom = document.getElementById("logout");
  if (logoutBtnDom) logoutBtnDom.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: 'include' });
    } catch (e) { console.warn('logout erro', e); }
    window.location.href = "/index.html";
  });

  // Inicialização
  loadUsers();
  loadTechs();
  clearEditor();
});
