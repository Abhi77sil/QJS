/* ==========================================================================
   LPU Quick Jobs — Student Economy & Wallet Client
   Real student utilities: earnings summary, peer-to-peer transfers,
   real INR withdrawals, and SQLite transaction ledger.
   ========================================================================== */

(function () {
  'use strict';

  // Core State
  let currentUser = null;
  let currentBalance = 0;
  let allTransactions = [];
  let currentFilter = 'ALL';
  let searchQuery = '';

  // DOM Elements
  const el = {
    // Navigation & User
    navQcDisplay: document.getElementById('navQcDisplay'),
    dropdownQcDisplay: document.getElementById('dropdownQcDisplay'),
    userSubtext: document.getElementById('userSubtext'),

    // Metric Cards
    statBalance: document.getElementById('statBalance'),
    statEarned: document.getElementById('statEarned'),
    statSpent: document.getElementById('statSpent'),
    statWithdrawn: document.getElementById('statWithdrawn'),

    // Quick Transfer Form
    quickTransferForm: document.getElementById('quickTransferForm'),
    transferRecipient: document.getElementById('transferRecipient'),
    transferAmount: document.getElementById('transferAmount'),
    transferNote: document.getElementById('transferNote'),
    transferAvailBal: document.getElementById('transferAvailBal'),
    btnSubmitTransfer: document.getElementById('btnSubmitTransfer'),

    // Quick Withdraw Form
    quickWithdrawForm: document.getElementById('quickWithdrawForm'),
    withdrawDetails: document.getElementById('withdrawDetails'),
    withdrawDetailsLabel: document.getElementById('withdrawDetailsLabel'),
    withdrawHint: document.getElementById('withdrawHint'),
    withdrawAmount: document.getElementById('withdrawAmount'),
    withdrawAvailBal: document.getElementById('withdrawAvailBal'),
    btnSubmitWithdraw: document.getElementById('btnSubmitWithdraw'),

    // Transaction History Table & Filters
    txnFilterPills: document.getElementById('txnFilterPills'),
    txnSearchInput: document.getElementById('txnSearchInput'),
    txnTableBody: document.getElementById('txnTableBody'),
    emptyTxnState: document.getElementById('emptyTxnState'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),

    // Modals
    transferModal: document.getElementById('transferModal'),
    withdrawModal: document.getElementById('withdrawModal'),

    openTransferModalBtn: document.getElementById('openTransferModalBtn'),
    openWithdrawModalBtn: document.getElementById('openWithdrawModalBtn'),

    modalTransferForm: document.getElementById('modalTransferForm'),
    modalRecipient: document.getElementById('modalRecipient'),
    modalAmount: document.getElementById('modalAmount'),
    modalNote: document.getElementById('modalNote'),
    modalAvailBal: document.getElementById('modalAvailBal'),
    btnConfirmTransfer: document.getElementById('btnConfirmTransfer'),

    modalWithdrawForm: document.getElementById('modalWithdrawForm'),
    modalWithdrawDetails: document.getElementById('modalWithdrawDetails'),
    modalDetailsLabel: document.getElementById('modalDetailsLabel'),
    modalWithdrawAmount: document.getElementById('modalWithdrawAmount'),
    modalWithdrawAvailBal: document.getElementById('modalWithdrawAvailBal'),
    btnConfirmWithdraw: document.getElementById('btnConfirmWithdraw'),

    toastContainer: document.getElementById('toastContainer')
  };

  /* ─────────── INITIALIZATION ─────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    if (!window.Auth) {
      console.error('[Economy] Auth library not loaded');
      return;
    }

    // Require student authentication
    currentUser = await window.Auth.requireAuth({ redirectToLogin: true });
    if (!currentUser) return;

    // Setup hero subtext
    if (el.userSubtext) {
      const name = currentUser.name || 'Student';
      const reg = currentUser.regNo ? `Reg: ${currentUser.regNo}` : 'Campus Member';
      const roleBadge = window.QJS ? window.QJS.getRoleIcon(currentUser.role, currentUser.isAdmin) : '';
      el.userSubtext.innerHTML = `Account: <strong>${escapeHtml(name)}</strong> ${roleBadge} (${escapeHtml(reg)}) • Quick Coin Economy (1 Qc = ₹1.00 INR)`;
    }

    // Register Event Listeners
    initEvents();

    // Load Economy Data from SQLite
    await loadEconomyData();

    // Listen for global wallet updates (e.g. from topup in navbar)
    window.addEventListener('qjs:wallet-updated', (e) => {
      if (e.detail) {
        currentBalance = e.detail.balance || 0;
        updateBalanceDisplays(currentBalance);
        loadEconomyData();
      }
    });
  });

  /* ─────────── DATA FETCHING ─────────── */
  async function loadEconomyData() {
    try {
      const token = window.Auth ? window.Auth.getToken() : null;
      if (!token) return;

      const apiBase = window.Auth.API_BASE || 'http://localhost:7777';
      const res = await fetch(`${apiBase}/api/student/economy`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load wallet summary`);
      }

      const data = await res.json();
      currentBalance = data.balance || 0;

      // Update Nav balance and Metric displays
      updateBalanceDisplays(currentBalance);

      if (el.statEarned) el.statEarned.textContent = (data.totalEarned || 0).toLocaleString('en-IN');
      if (el.statSpent) el.statSpent.textContent = (data.totalSpent || 0).toLocaleString('en-IN');
      if (el.statWithdrawn) el.statWithdrawn.textContent = (data.totalWithdrawn || 0).toLocaleString('en-IN');

      // Update Transaction list
      allTransactions = data.transactions || [];
      renderTransactions();

    } catch (err) {
      console.error('[Economy] Database sync error:', err);
      showToast('Could not sync with wallet database. Retrying…', 'error');
    }
  }

  function updateBalanceDisplays(bal) {
    const formatted = bal.toLocaleString('en-IN');

    if (el.navQcDisplay) el.navQcDisplay.textContent = formatted;
    if (el.dropdownQcDisplay) el.dropdownQcDisplay.textContent = `${formatted} Qc`;
    if (el.statBalance) el.statBalance.textContent = formatted;

    if (el.transferAvailBal) el.transferAvailBal.textContent = formatted;
    if (el.withdrawAvailBal) el.withdrawAvailBal.textContent = formatted;
    if (el.modalAvailBal) el.modalAvailBal.textContent = formatted;
    if (el.modalWithdrawAvailBal) el.modalWithdrawAvailBal.textContent = formatted;
  }

  /* ─────────── TRANSACTION RENDERING & FILTERING ─────────── */
  function renderTransactions() {
    if (!el.txnTableBody) return;

    let filtered = allTransactions.filter(txn => {
      // 1. Category Filter
      if (currentFilter === 'EARNED') {
        if (txn.amount <= 0 || txn.type === 'TOPUP') return false;
      } else if (currentFilter === 'TRANSFER_OUT') {
        if (txn.type !== 'TRANSFER_OUT') return false;
      } else if (currentFilter === 'WITHDRAWAL') {
        if (txn.type !== 'WITHDRAWAL') return false;
      } else if (currentFilter === 'TOPUP') {
        if (txn.type !== 'TOPUP') return false;
      }

      // 2. Search Query Filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const ref = (txn.reference || '').toLowerCase();
        const desc = (txn.description || '').toLowerCase();
        const type = (txn.type || '').toLowerCase();
        if (!ref.includes(q) && !desc.includes(q) && !type.includes(q)) {
          return false;
        }
      }

      return true;
    });

    if (filtered.length === 0) {
      el.txnTableBody.innerHTML = '';
      if (el.emptyTxnState) el.emptyTxnState.style.display = 'flex';
      return;
    }

    if (el.emptyTxnState) el.emptyTxnState.style.display = 'none';

    el.txnTableBody.innerHTML = filtered.map(txn => {
      const isPositive = txn.amount > 0;
      const amtDisplay = (isPositive ? '+₹' : '-₹') + Math.abs(txn.amount).toLocaleString('en-IN');
      const amtClass = isPositive ? 'positive' : 'negative';
      
      const { catClass, catLabel } = getCategoryMeta(txn.type);
      const dateObj = new Date(txn.createdAt);
      const dateFormatted = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeFormatted = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      return `
        <tr>
          <td><span class="txn-ref-badge">${escapeHtml(txn.reference || txn.id.slice(0, 10))}</span></td>
          <td>
            <div class="txn-date-time">
              <span class="txn-date">${dateFormatted}</span>
              <span class="txn-time">${timeFormatted}</span>
            </div>
          </td>
          <td>
            <span class="txn-category-badge ${catClass}">${catLabel}</span>
          </td>
          <td>${escapeHtml(txn.description || 'Transaction')}</td>
          <td class="text-right">
            <span class="txn-amount-val ${amtClass}">${amtDisplay}</span>
          </td>
          <td class="text-right">
            <span class="txn-balance-val">₹${(txn.balanceAfter || 0).toLocaleString('en-IN')} Qc</span>
          </td>
          <td class="text-center">
            <span class="txn-status-badge">${escapeHtml(txn.status || 'COMPLETED')}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function getCategoryMeta(type) {
    switch (type) {
      case 'TOPUP':
        return { catClass: 'cat-topup', catLabel: 'Wallet Top-up' };
      case 'TRANSFER_IN':
        return { catClass: 'cat-transfer-in', catLabel: 'Received Transfer' };
      case 'TRANSFER_OUT':
        return { catClass: 'cat-transfer-out', catLabel: 'Sent Transfer' };
      case 'WITHDRAWAL':
        return { catClass: 'cat-withdrawal', catLabel: 'Withdrawal' };
      case 'TASK_REWARD':
        return { catClass: 'cat-reward', catLabel: 'Task Earnings' };
      case 'ADMIN_ADJUST':
        return { catClass: 'cat-admin', catLabel: 'Admin Adjustment' };
      default:
        return { catClass: 'cat-topup', catLabel: type || 'General' };
    }
  }

  /* ─────────── EVENT LISTENERS ─────────── */
  function initEvents() {
    // Filter pills
    if (el.txnFilterPills) {
      el.txnFilterPills.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill');
        if (!btn) return;

        el.txnFilterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter || 'ALL';
        renderTransactions();
      });
    }

    // Search input
    if (el.txnSearchInput) {
      el.txnSearchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderTransactions();
      });
    }

    // Reset filter
    if (el.resetFilterBtn) {
      el.resetFilterBtn.addEventListener('click', () => {
        currentFilter = 'ALL';
        searchQuery = '';
        if (el.txnSearchInput) el.txnSearchInput.value = '';
        el.txnFilterPills.querySelectorAll('.pill').forEach(p => {
          p.classList.toggle('active', p.dataset.filter === 'ALL');
        });
        renderTransactions();
      });
    }

    // Radio method toggles for Quick Withdrawal Form
    document.querySelectorAll('input[name="withdrawMethod"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateWithdrawInputUI(e.target.value, el.withdrawDetailsLabel, el.withdrawDetails, el.withdrawHint);
      });
    });

    // Radio method toggles for Modal Withdrawal Form
    document.querySelectorAll('input[name="modalWithdrawMethod"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateWithdrawInputUI(e.target.value, el.modalDetailsLabel, el.modalWithdrawDetails, null);
      });
    });

    // Modal Triggers
    if (el.openTransferModalBtn) el.openTransferModalBtn.addEventListener('click', () => openModal(el.transferModal));
    if (el.openWithdrawModalBtn) el.openWithdrawModalBtn.addEventListener('click', () => openModal(el.withdrawModal));

    // Modal Close Buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) closeModal(modal);
      });
    });

    // Close on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });

    // Form Submissions
    if (el.quickTransferForm) {
      el.quickTransferForm.addEventListener('submit', (e) => handleTransferSubmit(e, el.transferRecipient, el.transferAmount, el.transferNote, el.btnSubmitTransfer));
    }
    if (el.modalTransferForm) {
      el.modalTransferForm.addEventListener('submit', (e) => handleTransferSubmit(e, el.modalRecipient, el.modalAmount, el.modalNote, el.btnConfirmTransfer, el.transferModal));
    }

    if (el.quickWithdrawForm) {
      el.quickWithdrawForm.addEventListener('submit', (e) => handleWithdrawSubmit(e, 'input[name="withdrawMethod"]:checked', el.withdrawDetails, el.withdrawAmount, el.btnSubmitWithdraw));
    }
    if (el.modalWithdrawForm) {
      el.modalWithdrawForm.addEventListener('submit', (e) => handleWithdrawSubmit(e, 'input[name="modalWithdrawMethod"]:checked', el.modalWithdrawDetails, el.modalWithdrawAmount, el.btnConfirmWithdraw, el.withdrawModal));
    }
  }

  function updateWithdrawInputUI(method, labelEl, inputEl, hintEl) {
    if (method === 'UPI') {
      if (labelEl) labelEl.innerHTML = 'UPI ID <span class="req">*</span>';
      if (inputEl) inputEl.placeholder = 'username@okhdfcbank';
      if (hintEl) hintEl.textContent = 'Funds will be credited directly to this UPI VPA.';
    } else {
      if (labelEl) labelEl.innerHTML = 'Bank Details (Acc No &amp; IFSC) <span class="req">*</span>';
      if (inputEl) inputEl.placeholder = 'A/C 5010042819283, HDFC0000240';
      if (hintEl) hintEl.textContent = 'NEFT/IMPS will be initiated to this campus bank account.';
    }
  }

  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('open');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ─────────── FORM ACTIONS ─────────── */

  // 1. Peer Transfer
  async function handleTransferSubmit(e, recipientInput, amountInput, noteInput, submitBtn, modalToClose) {
    e.preventDefault();

    const recipient = recipientInput.value.trim();
    const amount = parseInt(amountInput.value, 10);
    const note = noteInput ? noteInput.value.trim() : '';

    if (!recipient) {
      showToast('Please enter recipient email, registration number, or phone', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      showToast('Transfer amount must be at least 1 Qc', 'error');
      return;
    }

    if (amount > currentBalance) {
      showToast(`Insufficient balance. You have ${currentBalance} Qc available.`, 'error');
      return;
    }

    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Processing…';

    try {
      const token = window.Auth ? window.Auth.getToken() : null;
      const apiBase = window.Auth.API_BASE || 'http://localhost:7777';

      const res = await fetch(`${apiBase}/api/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipient: recipient,
          amount: amount,
          note: note
        })
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Transfer failed');
      }

      showToast(`Successfully transferred ₹${amount} Qc to ${result.recipient?.name || recipient}!`, 'success');

      recipientInput.value = '';
      amountInput.value = '';
      if (noteInput) noteInput.value = '';

      if (modalToClose) closeModal(modalToClose);

      // Refresh data locally & globally
      await loadEconomyData();
      if (window.QJS) await window.QJS.refreshWallet();

    } catch (err) {
      showToast(err.message || 'Transfer failed. Please check recipient details.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }

  // 2. Withdrawal Request
  async function handleWithdrawSubmit(e, methodRadioSelector, detailsInput, amountInput, submitBtn, modalToClose) {
    e.preventDefault();

    const methodRadio = document.querySelector(methodRadioSelector);
    const method = methodRadio ? methodRadio.value : 'UPI';
    const details = detailsInput.value.trim();
    const amount = parseInt(amountInput.value, 10);

    if (!details) {
      showToast('Please provide your UPI ID or Bank Details', 'error');
      return;
    }

    if (isNaN(amount) || amount < 50) {
      showToast('Minimum withdrawal amount is 50 Qc (₹50)', 'error');
      return;
    }

    if (amount > currentBalance) {
      showToast(`Insufficient balance. You have ${currentBalance} Qc available.`, 'error');
      return;
    }

    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Processing…';

    try {
      const token = window.Auth ? window.Auth.getToken() : null;
      const apiBase = window.Auth.API_BASE || 'http://localhost:7777';

      const res = await fetch(`${apiBase}/api/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payoutMethod: method,
          payoutDetails: details,
          amount: amount
        })
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Withdrawal request failed');
      }

      showToast(`Withdrawal of ₹${amount} requested! Funds will be credited to ${details}.`, 'success');

      amountInput.value = '';
      if (modalToClose) closeModal(modalToClose);

      // Refresh data locally & globally
      await loadEconomyData();
      if (window.QJS) await window.QJS.refreshWallet();

    } catch (err) {
      showToast(err.message || 'Withdrawal request failed.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }

  /* ─────────── TOAST NOTIFICATIONS ─────────── */
  function showToast(message, type = 'info') {
    if (!el.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <strong>${type === 'error' ? 'Error' : 'Notification'}</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    `;

    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  window.showToast = showToast;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();