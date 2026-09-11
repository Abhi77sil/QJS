/* ==========================================================================
   Quick Jobs — Campus Dashboard & Qc Currency Controller
   Handles live tasks, Qc wallet balances, student top-up flow,
   profile popover, and dedicated Admin Portal access.
   ========================================================================== */

(() => {
  'use strict';

  let allTasks = [];
  let currentUser = null;
  let userWallet = { balance: 0, currency: 'Qc' };
  const appliedTaskIds = new Set(JSON.parse(localStorage.getItem('qjs_applied_tasks') || '[]'));

  const $ = (id) => document.getElementById(id);

  // Toast notification helper
  function showToast(msg, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  // Category Icon helper
  function getCategoryIcon(cat) {
    const icons = {
      Design: '🎨',
      Academic: '📚',
      Development: '💻',
      Delivery: '📦',
      Photography: '📷',
      Tutoring: '🧮',
      Writing: '✍️',
      Event: '🎉',
      General: '📋'
    };
    return icons[cat] || '📋';
  }

  // Fetch active user's Qc wallet
  async function loadWallet() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/wallet`, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) throw new Error('Failed to load wallet');
      const data = await res.json();
      userWallet = data;
      updateWalletUI();
    } catch (e) {
      console.warn('[Dashboard] Could not load wallet:', e);
    }
  }

  function updateWalletUI() {
    const formatted = Number(userWallet.balance || 0).toLocaleString('en-IN');
    const navDisplay = $('navQcDisplay');
    const dropdownDisplay = $('dropdownQcDisplay');

    if (navDisplay) navDisplay.textContent = formatted;
    if (dropdownDisplay) dropdownDisplay.textContent = `${formatted} Qc`;
  }

  // Fetch tasks from Go backend
  async function loadTasks() {
    const grid = $('tasksGrid');
    const emptyState = $('emptyState');
    const countBadge = $('tasksCountBadge');

    try {
      const res = await fetch(`${Auth.API_BASE}/api/tasks`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      allTasks = data.tasks || [];
      renderTasks();
    } catch (err) {
      console.warn('[Dashboard] Could not load tasks:', err);
      if (grid) grid.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
    }
  }

  // Filter and render tasks with Qc currency rewards
  function renderTasks() {
    const grid = $('tasksGrid');
    const emptyState = $('emptyState');
    const countBadge = $('tasksCountBadge');
    if (!grid) return;

    const query = ($('taskSearch')?.value || '').trim().toLowerCase();
    const category = $('categoryFilter')?.value || 'all';

    let filtered = allTasks.filter(t => {
      const matchesQuery = !query ||
        t.title.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query);
      const matchesCat = category === 'all' || t.category.toLowerCase() === category.toLowerCase();
      return matchesQuery && matchesCat;
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} task${filtered.length === 1 ? '' : 's'}`;
    }

    if (!filtered.length) {
      grid.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    grid.innerHTML = filtered.map(task => {
      const isApplied = appliedTaskIds.has(task.id);
      const diffClass = `diff-${(task.difficulty || 'medium').toLowerCase()}`;

      return `
        <article class="task-card" data-id="${task.id}">
          <div>
            <div class="task-card-header">
              <span class="task-cat-badge">
                ${getCategoryIcon(task.category)} ${escapeHtml(task.category)}
              </span>
              <span class="task-reward-pill"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(task.reward).toLocaleString('en-IN')} Qc</span>
            </div>

            <h3 class="task-title">${escapeHtml(task.title)}</h3>
            <p class="task-desc">${escapeHtml(task.description)}</p>
          </div>

          <div>
            <div class="task-meta-row">
              <span>⏱ ${task.estimatedHours || 1}h est.</span>
              <span class="task-diff-pill ${diffClass}">${escapeHtml(task.difficulty || 'Medium')}</span>
              <span>By ${escapeHtml(task.createdBy || 'Campus Staff')} ${window.QJS ? window.QJS.getRoleIcon(task.creatorRole || 'admin') : ''}</span>
            </div>

            <button type="button" class="btn-apply ${isApplied ? 'applied' : ''}" data-action="apply" data-id="${task.id}">
              ${isApplied ? '✓ Applied' : 'Apply for Task'}
            </button>
          </div>
        </article>
      `;
    }).join('');

    // Wire apply buttons
    grid.querySelectorAll('[data-action="apply"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.getAttribute('data-id');
        if (appliedTaskIds.has(taskId)) {
          showToast('You have already applied for this task. Manage it under Tasks.', 'info');
          return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Applying…';

        try {
          const res = await Auth.authFetch('/api/tasks/apply', {
            method: 'POST',
            body: JSON.stringify({ taskId, note: 'Applied via campus dashboard' })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Failed to apply');
          }

          appliedTaskIds.add(taskId);
          localStorage.setItem('qjs_applied_tasks', JSON.stringify([...appliedTaskIds]));
          btn.classList.add('applied');
          btn.textContent = '✓ Applied';
          btn.disabled = false;
          showToast('Application submitted! Track status & chat with poster under Tasks.', 'success');
        } catch (err) {
          showToast(err.message || 'Could not submit application', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Load student applications to mark already applied tasks
  async function loadUserApplications() {
    try {
      const res = await Auth.authFetch('/api/student/applications');
      if (res.ok) {
        const data = await res.json();
        if (data.applications) {
          data.applications.forEach(app => {
            if (app.status !== 'WITHDRAWN') {
              appliedTaskIds.add(app.taskId);
            }
          });
        }
      }
    } catch (e) {
      console.warn('[Dashboard] Could not preload applications:', e);
    }
  }

  // Setup Top-up Modal
  function setupTopupModal() {
    const navTopupBtn = $('navTopupBtn');
    const profileTopupBtn = $('profileTopupBtn');
    const modal = $('topupModalBackdrop');
    const closeBtn = $('closeTopupModal');
    const form = $('topupForm');
    const amountInput = $('topupAmount');

    function openModal() {
      if ($('userDropdown')) $('userDropdown').classList.remove('show');
      if ($('userMenuBtn')) $('userMenuBtn').classList.remove('active');
      modal.classList.add('show');
      amountInput.focus();
    }

    if (navTopupBtn) navTopupBtn.addEventListener('click', openModal);
    if (profileTopupBtn) profileTopupBtn.addEventListener('click', openModal);

    if (closeBtn) {
      closeBtn.addEventListener('click', () => modal.classList.remove('show'));
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    }

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        amountInput.value = btn.getAttribute('data-amt');
      });
    });

    // Form submission
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = $('submitTopupBtn');
        const amount = parseInt(amountInput.value, 10);
        const method = $('topupMethod')?.value || 'UPI';

        if (!amount || amount < 10) {
          showToast('Minimum top-up amount is 10 Qc.', 'error');
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing Payment…';

        try {
          const res = await fetch(`${Auth.API_BASE}/api/wallet/topup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Auth.getToken()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount, method })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to top up wallet');

          userWallet.balance = data.balance;
          updateWalletUI();

          showToast(`Added ${amount} Qc to your wallet!`, 'success');
          modal.classList.remove('show');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirm & Add Quick Coins';

        } catch (err) {
          showToast(err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirm & Add Quick Coins';
        }
      });
    }
  }

  // Setup Profile Dropdown & Search
  function setupUI() {
    const taskSearch = $('taskSearch');
    const categoryFilter = $('categoryFilter');

    // Search and Filter Listeners
    if (taskSearch) {
      taskSearch.addEventListener('input', renderTasks);
    }
    if (categoryFilter) {
      categoryFilter.addEventListener('change', renderTasks);
    }

    setupTopupModal();
  }

  // Initialization
  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await Auth.requireAuth();
    if (!currentUser) return;

    setupUI();
    await Promise.all([
      loadWallet(),
      loadUserApplications(),
      loadTasks()
    ]);
  });

})();