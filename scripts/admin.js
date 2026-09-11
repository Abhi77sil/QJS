/* ==========================================================================
   Quick Jobs — Dedicated Admin Portal Controller
   Strict access enforcement, real-time Qc economy treasury management,
   task publishing & deletion, student wallet auditing, and ledger tracking.
   ========================================================================== */

(() => {
  'use strict';

  let currentAdmin = null;
  let allTasks = [];
  let allUsers = [];
  let allTransactions = [];

  const $ = (id) => document.getElementById(id);

  function toast(msg, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 1. Load Economy KPIs
  async function loadEconomyKPIs() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/admin/economy`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) throw new Error('Failed to fetch economy KPIs');
      const data = await res.json();

      $('kpiCirculatingQc').innerHTML = `<img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(data.circulatingQc || 0).toLocaleString('en-IN')} Qc`;
      $('kpiTotalUsers').textContent = data.totalUsers || 0;
      $('kpiTotalTasks').textContent = data.totalTasks || 0;
      $('kpiTotalVolume').textContent = `${Number(data.totalVolumeQc || 0).toLocaleString('en-IN')} Qc`;
      $('kpiAvgBalance').textContent = `₹${(data.averageBalanceQc || 0).toFixed(1)} / user`;
    } catch (e) {
      console.warn('[Admin] Failed loading economy KPIs:', e);
    }
  }

  // 2. Load Tasks
  async function loadTasks() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/tasks`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      allTasks = data.tasks || [];
      renderTasksTable();
    } catch (e) {
      console.warn('[Admin] Failed loading tasks:', e);
    }
  }

  function renderTasksTable() {
    const tbody = $('adminTasksTbody');
    if (!tbody) return;

    if (!allTasks.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-dim); padding:2rem;">No campus tasks created yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = allTasks.map(t => `
      <tr>
        <td style="font-weight:700;">${escapeHtml(t.title)}</td>
        <td><span style="background:var(--bg-card); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.8rem;">${escapeHtml(t.category)}</span></td>
        <td style="color:var(--primary); font-weight:800; font-family:var(--font-heading);"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(t.reward).toLocaleString('en-IN')} Qc</td>
        <td>${escapeHtml(t.difficulty || 'Medium')}</td>
        <td style="color:var(--text-dim); font-size:0.82rem;">${escapeHtml(t.createdBy || 'Admin')}</td>
        <td style="text-align:right;">
          <button type="button" class="btn-table-action btn-action-delete" data-delete-task="${t.id}">
            Delete
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-delete-task]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete-task');
        if (!confirm('Permanently remove this task from SQLite?')) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${Auth.API_BASE}/api/tasks?id=${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
          });
          if (!res.ok) throw new Error('Failed to delete task');
          toast('Task removed successfully', 'info');
          await loadTasks();
          await loadEconomyKPIs();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  // 3. Load Users & Wallets
  async function loadUsers() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) throw new Error('Failed to fetch student accounts');
      const data = await res.json();
      allUsers = data.users || [];
      renderUsersTable();
    } catch (e) {
      console.warn('[Admin] Failed loading users:', e);
    }
  }

  function renderUsersTable() {
    const tbody = $('adminUsersTbody');
    if (!tbody) return;

    if (!allUsers.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-dim); padding:2rem;">No registered students found.</td></tr>`;
      return;
    }

    tbody.innerHTML = allUsers.map(u => `
      <tr>
        <td style="font-weight:700;">${escapeHtml(u.name)} ${window.QJS ? window.QJS.getRoleIcon(u.role, u.isAdmin) : ''}</td>
        <td>${escapeHtml(u.email)}</td>
        <td style="color:var(--text-dim);">${escapeHtml(u.regNo)}</td>
        <td>${escapeHtml(u.phone)}</td>
        <td style="color:var(--teal); font-weight:800; font-family:var(--font-heading);"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(u.balance || 0).toLocaleString('en-IN')} Qc</td>
        <td style="text-align:right;">
          <button type="button" class="btn-table-action btn-action-adjust" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name)}" data-user-balance="${u.balance || 0}">
            Adjust Qc
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-user-id');
        const uname = btn.getAttribute('data-user-name');
        const ubal = btn.getAttribute('data-user-balance');
        openAdjustModal(uid, uname, ubal);
      });
    });
  }

  // 4. Load Transactions
  async function loadTransactions() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/transactions`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const data = await res.json();
      allTransactions = data.transactions || data || [];
      renderTransactionsTable();
    } catch (e) {
      console.warn('[Admin] Failed loading transactions:', e);
    }
  }

  function renderTransactionsTable() {
    const tbody = $('adminTxnTbody');
    if (!tbody) return;

    if (!allTransactions.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-dim); padding:2rem;">No transactions recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = allTransactions.map(tx => {
      let badgeClass = 'badge-topup';
      if (tx.type === 'ADMIN_ADJUST') badgeClass = 'badge-adjust';
      if (tx.type === 'TASK_REWARD') badgeClass = 'badge-reward';

      return `
        <tr>
          <td style="font-family:monospace; font-size:0.78rem; color:var(--text-dim);">${escapeHtml(tx.id)}</td>
          <td><span class="type-badge ${badgeClass}">${escapeHtml(tx.type)}</span></td>
          <td style="font-weight:700; color:${tx.amount >= 0 ? 'var(--teal)' : 'var(--danger)'};">
            ${tx.amount >= 0 ? '+' : ''}${tx.amount} Qc
          </td>
          <td style="color:var(--text-dim); font-size:0.82rem;">${tx.balanceAfter} Qc</td>
          <td>${escapeHtml(tx.description || '—')}</td>
          <td style="color:var(--text-dim); font-size:0.78rem;">${new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
        </tr>
      `;
    }).join('');
  }

  // 5. Balance Adjustment Modal
  function openAdjustModal(userId, userName, currentBalance) {
    const modal = $('adjustModalBackdrop');
    $('adjustTargetUser').textContent = `${userName} (Current: ${currentBalance} Qc)`;
    $('adjustUserId').value = userId;
    $('adjustAmount').value = '';
    $('adjustReason').value = '';
    modal.classList.add('show');
  }

  function setupAdjustModal() {
    const modal = $('adjustModalBackdrop');
    const closeBtn = $('closeAdjustModal');
    const form = $('adjustWalletForm');

    closeBtn.addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('submitAdjustBtn');
      const userId = $('adjustUserId').value;
      const amount = parseInt($('adjustAmount').value, 10);
      const reason = $('adjustReason').value.trim();

      if (!amount) {
        toast('Enter a valid amount (positive to credit, negative to debit)', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating…';

      try {
        const res = await fetch(`${Auth.API_BASE}/api/admin/wallet/adjust`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Auth.getToken()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userId, amount, reason })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Adjustment failed');

        toast(data.message, 'success');
        modal.classList.remove('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Adjustment';

        await loadUsers();
        await loadEconomyKPIs();
        await loadTransactions();
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Adjustment';
      }
    });
  }

  // 6. Task Creation Form
  function setupTaskForm() {
    const form = $('adminTaskForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('submitNewTaskBtn');

      const payload = {
        title: $('taskTitle').value.trim(),
        category: $('taskCategory').value,
        reward: parseInt($('taskReward').value, 10),
        difficulty: $('taskDifficulty').value,
        estimatedHours: parseFloat($('taskHours').value) || 1.0,
        description: $('taskDesc').value.trim()
      };

      if (!payload.title || !payload.reward || !payload.description) {
        toast('Please fill in all required fields.', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Publishing…';

      try {
        const res = await fetch(`${Auth.API_BASE}/api/tasks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Auth.getToken()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to publish task');

        toast('Task published to campus taskboard!', 'success');
        form.reset();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Publish Task (in Qc)';

        await loadTasks();
        await loadEconomyKPIs();
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Publish Task (in Qc)';
      }
    });
  }

  // 7. Navigation Tabs
  function setupTabs() {
    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab-target');

        document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));

        btn.classList.add('active');
        const targetSection = $(targetId);
        if (targetSection) targetSection.classList.add('active');
      });
    });
  }

  // 8. Initialization & Security Gate
  document.addEventListener('DOMContentLoaded', async () => {
    currentAdmin = await Auth.requireAuth();
    if (!currentAdmin) return;

    if (!currentAdmin.isAdmin) {
      alert('Access Denied: Only administrators listed in admin.txt can access this portal.');
      window.location.href = 'index.html';
      return;
    }

    $('adminEmailDisplay').textContent = currentAdmin.email;

    setupTabs();
    setupTaskForm();
    setupAdjustModal();

    await Promise.all([
      loadEconomyKPIs(),
      loadTasks(),
      loadUsers(),
      loadTransactions()
    ]);
  });

})();
