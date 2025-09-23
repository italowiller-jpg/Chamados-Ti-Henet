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
  tabs.users.addEventListener("click", () => switchTab("users"));
  tabs.techs.addEventListener("click", () => switchTab("techs"));

  function clearEditor() {
    editor.empty.style.display = "block";
    editor.user.style.display = "none";
    editor.tech.style.display = "none";
    selectedUser = null;
    selectedTech = null;
  }

  function openUserEditor(user) {
    editor.empty.style.display = "none";
    editor.user.style.display = "block";
    editor.tech.style.display = "none";
    selectedUser = user;
    document.getElementById("editUserName").value = user.name;
    document.getElementById("editUserEmail").value = user.email;
    document.getElementById("editUserRole").value = user.role;
    document.getElementById("editUserPass").value = "";
  }

  function openTechEditor(tech) {
    editor.empty.style.display = "none";
    editor.user.style.display = "none";
    editor.tech.style.display = "block";
    selectedTech = tech;
    document.getElementById("editTechName").value = tech.display_name;
    document.getElementById("editTechEmail").value = tech.email || "";
    document.getElementById("editTechActive").value = String(tech.active);
  }

  async function loadUsers() {
    const res = await fetch("/api/users");
    const users = await res.json();
    const wrap = document.getElementById("usersTableWrap");
    let html = `<table class="table"><thead><tr>
      <th>Nome</th><th>Email</th><th>Role</th><th class="actions">Ações</th></tr></thead><tbody>`;
    users.forEach(u => {
      html += `<tr>
        <td>${u.name}</td><td>${u.email}</td><td><span class="badge">${u.role}</span></td>
        <td class="actions">
          <button class="btn small" data-id="${u.id}" data-type="user" data-action="edit">Editar</button>
          <button class="btn danger small" data-id="${u.id}" data-type="user" data-action="delete">Excluir</button>
        </td>
      </tr>`;
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
  }

  async function loadTechs() {
    const res = await fetch("/api/technicians");
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
    wrap.innerHTML = html;
  }

  document.getElementById("createUserBtn").addEventListener("click", async () => {
    const data = {
      name: document.getElementById("newUserName").value,
      email: document.getElementById("newUserEmail").value,
      password: document.getElementById("newUserPass").value,
      role: document.getElementById("newUserRole").value,
    };
    await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    loadUsers();
  });

  document.getElementById("saveUserBtn").addEventListener("click", async () => {
    if (!selectedUser) return;
    const data = {
      name: document.getElementById("editUserName").value,
      role: document.getElementById("editUserRole").value,
    };
    const newPass = document.getElementById("editUserPass").value;
    if (newPass) {
      data.password = newPass;
    }
    await fetch(`/api/users/${selectedUser.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    loadUsers();
    clearEditor();
  });

  document.getElementById("deleteUserBtn").addEventListener("click", async () => {
    if (!selectedUser) return;
    if (!confirm("Excluir este usuário?")) return;
    await fetch(`/api/users/${selectedUser.id}`, { method: "DELETE" });
    loadUsers();
    clearEditor();
  });

  document.getElementById("createTechBtn").addEventListener("click", async () => {
    const data = {
      display_name: document.getElementById("newTechName").value,
      email: document.getElementById("newTechEmail").value,
    };
    await fetch("/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    loadTechs();
  });

  document.getElementById("saveTechBtn").addEventListener("click", async () => {
    if (!selectedTech) return;
    const data = {
      display_name: document.getElementById("editTechName").value,
      email: document.getElementById("editTechEmail").value,
      active: document.getElementById("editTechActive").value === "true",
    };
    await fetch(`/api/technicians/${selectedTech.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    loadTechs();
    clearEditor();
  });

  document.getElementById("deleteTechBtn").addEventListener("click", async () => {
    if (!selectedTech) return;
    if (!confirm("Excluir este técnico?")) return;
    await fetch(`/api/technicians/${selectedTech.id}`, { method: "DELETE" });
    loadTechs();
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
        const res = await fetch("/api/users");
        const all = await res.json();
        const user = all.find(u => u.id === id);
        if (user) openUserEditor(user);
      } else {
        const res = await fetch("/api/technicians");
        const all = await res.json();
        const tech = all.find(t => t.id === id);
        if (tech) openTechEditor(tech);
      }
    } else if (action === "delete") {
      if (type === "user") {
        if (!confirm("Excluir este usuário?")) return;
        await fetch(`/api/users/${id}`, { method: "DELETE" });
        loadUsers();
      } else {
        if (!confirm("Excluir este técnico?")) return;
        await fetch(`/api/technicians/${id}`, { method: "DELETE" });
        loadTechs();
      }
      clearEditor();
    }
  });

  // Botões do topo
  document.getElementById("backHome").addEventListener("click", () => {
    window.location.href = "/index.html";
  });
  document.getElementById("toReports").addEventListener("click", () => {
    window.location.href = "/superadmin-reports.html";
  });
  document.getElementById("logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });

  // Inicialização
  loadUsers();
  loadTechs();
  clearEditor();
});
