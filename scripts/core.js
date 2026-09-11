/* ==========================================================================
   Quick Jobs — Core System Utilities & Universal Navbar Controller
   Coordinates authentication, live Qc wallet sync, profile dropdown,
   navigation animations, and the universal top-up modal across all pages.
   ========================================================================== */

(function (root) {
  'use strict';

  // Helper selector
  const $ = (id) => document.getElementById(id);

  window.QJS = {
    _heartbeatInterval: null,
    _unreadInterval: null,
    userWallet: null,

    /**
     * Returns HTML for the role icon (Student, Faculty, Admin)
     */
    getRoleIcon(role, isAdmin) {
      if (window.Auth && typeof window.Auth.getRoleBadgeHtml === 'function') {
        return window.Auth.getRoleBadgeHtml(role, isAdmin);
      }
      const r = (isAdmin ? 'admin' : (role || 'student')).toLowerCase();
      let icon = 'icons/student.png';
      let title = 'Student';
      if (r === 'admin') {
        icon = 'icons/admin.png';
        title = 'Campus Administrator';
      } else if (r === 'faculty') {
        icon = 'icons/faculty.png';
        title = 'Faculty Member';
      }
      return `<img src="${icon}" class="role-icon" title="${title}" alt="${title}">`;
    },

    /**
     * Returns HTML for the new QC coin icon
     */
    getQcIconHtml(extraClass = '') {
      return `<img src="icons/qc.png" class="qc-icon ${extraClass}" alt="Qc">`;
    },

    /**
     * Initializes universal navigation bar, user session, and live wallet.
     */
    async init() {
      if (!window.Auth) return;

      // 1. Populate initial user details if available locally
      const localUser = window.Auth.getUser();
      if (localUser) {
        window.Auth.populateUserDOM(localUser);
        this.updateAdminVisibility(localUser);
      }

      // 2. Highlight active navigation link
      this.highlightActiveNavLink();

      // 3. Bind navbar profile dropdown
      this.bindUserDropdown();

      // 4. Bind Top-up trigger buttons
      this.bindTopupTriggers();

      // 5. Verify session and load live wallet balance
      if (window.Auth.hasLocalSession()) {
        try {
          const user = await window.Auth.checkSession({ redirectToLogin: false });
          if (user) {
            this.updateAdminVisibility(user);
            await this.refreshWallet();
          }
        } catch (e) {
          console.warn('[QJS] Session check error:', e);
        }
      }

      // 6. Bind in-app notifications & presence heartbeat
      this.bindNotifications();
      this.startPresenceHeartbeat();
      this.startUnreadPolling();
    },

    /**
     * Highlights active navigation link based on current page URL.
     */
    highlightActiveNavLink() {
      const currentPath = window.location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.navbar .nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        const target = href.split('/').pop().split('#')[0];
        if (target === currentPath || (currentPath === '' && target === 'index.html')) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
    },

    /**
     * Toggles admin-specific elements depending on user role.
     */
    updateAdminVisibility(user) {
      const isAdmin = window.Auth.isAdmin(user);
      document.querySelectorAll('[data-auth="admin-only"]').forEach(el => {
        el.hidden = !isAdmin;
        if (isAdmin && el.style.display === 'none') {
          el.style.display = '';
        }
      });
    },

    /**
     * Binds user menu profile dropdown toggle and click-away handler.
     */
    bindUserDropdown() {
      const menuBtn = $('userMenuBtn');
      const dropdown = $('userDropdown');

      if (!menuBtn || !dropdown) return;
      if (menuBtn.dataset.boundUserDropdown) return;
      menuBtn.dataset.boundUserDropdown = 'true';

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle('show');
        menuBtn.classList.toggle('active', isOpen);
      });

      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !menuBtn.contains(e.target)) {
          dropdown.classList.remove('show');
          menuBtn.classList.remove('active');
        }
      });
    },

    /**
     * Fetches live wallet from SQLite backend (/api/wallet) and updates all Qc displays.
     */
    async refreshWallet() {
      if (!window.Auth || !window.Auth.hasLocalSession()) return null;

      try {
        const token = window.Auth.getToken();
        const apiBase = window.Auth.API_BASE || 'http://localhost:7777';
        const res = await fetch(`${apiBase}/api/wallet`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) return null;
        const data = await res.json();
        this.userWallet = data;

        const balance = Number(data.balance || 0);
        const formatted = balance.toLocaleString('en-IN');

        // Update navigation bar pill
        const navDisplay = $('navQcDisplay');
        if (navDisplay) navDisplay.textContent = formatted;

        // Update dropdown balance
        const dropdownDisplay = $('dropdownQcDisplay');
        if (dropdownDisplay) dropdownDisplay.textContent = `${formatted} Qc`;

        // Update other registered display elements
        document.querySelectorAll('[data-qc-balance]').forEach(el => {
          el.textContent = formatted;
        });

        // Trigger custom event so page components can react
        window.dispatchEvent(new CustomEvent('qjs:wallet-updated', { detail: data }));

        return data;
      } catch (err) {
        console.warn('[QJS] Error refreshing wallet:', err);
        return null;
      }
    },

    /**
     * Binds Top-up trigger buttons to open top-up modal.
     */
    bindTopupTriggers() {
      const triggers = document.querySelectorAll('#navTopupBtn, #dropdownTopupBtn, [data-open-topup]');
      triggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openTopupModal();
        });
      });
    },

    /**
     * Opens the Top Up modal (injecting it if not already present on page).
     */
    openTopupModal() {
      let modal = $('topupModal');
      if (!modal) {
        this.injectTopupModal();
        modal = $('topupModal');
      }

      if (modal) {
        modal.classList.add('open');
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
      }

      // Close dropdown if open
      const dropdown = $('userDropdown');
      if (dropdown) dropdown.classList.remove('show');
    },

    /**
     * Injects the standard Top-up modal markup if missing from page.
     */
    injectTopupModal() {
      const div = document.createElement('div');
      div.id = 'topupModal';
      div.className = 'modal-backdrop';
      div.innerHTML = `
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <h3 class="modal-title">Top Up Quick Coins</h3>
              <p class="modal-sub">1 Quick Coin (Qc) = ₹1.00 INR</p>
            </div>
            <button type="button" class="modal-close" data-close-modal>&times;</button>
          </div>
          <form id="globalTopupForm" class="modal-body">
            <div class="topup-presets">
              <button type="button" class="preset-pill" data-amt="100">100 Qc</button>
              <button type="button" class="preset-pill active" data-amt="250">250 Qc</button>
              <button type="button" class="preset-pill" data-amt="500">500 Qc</button>
              <button type="button" class="preset-pill" data-amt="1000">1,000 Qc</button>
            </div>

            <div class="form-group mt-3">
              <label for="globalTopupInput">Amount in Qc (₹)</label>
              <div class="input-with-prefix">
                <span class="prefix">₹</span>
                <input type="number" id="globalTopupInput" min="10" max="50000" value="250" required />
              </div>
              <small class="hint">Min: 10 Qc • Max: 50,000 Qc per transaction</small>
            </div>

            <div class="form-group mt-3">
              <label>Payment Method</label>
              <div class="payment-method-chip">
                <span>⚡ Instant UPI (GPay, PhonePe, Paytm, BHIM)</span>
              </div>
            </div>

            <div class="modal-footer mt-4">
              <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
              <button type="submit" class="btn btn-primary" id="btnGlobalTopupSubmit">Proceed to Pay</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(div);

      // Bind close handlers
      div.querySelectorAll('[data-close-modal]').forEach(b => {
        b.addEventListener('click', () => {
          div.classList.remove('open');
          div.hidden = true;
        });
      });

      div.addEventListener('click', (e) => {
        if (e.target === div) {
          div.classList.remove('open');
          div.hidden = true;
        }
      });

      // Bind preset buttons
      const input = div.querySelector('#globalTopupInput');
      div.querySelectorAll('.preset-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          div.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (input) input.value = btn.dataset.amt;
        });
      });

      // Bind submit
      const form = div.querySelector('#globalTopupForm');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amt = parseInt(input.value, 10);
        if (isNaN(amt) || amt < 10) {
          alert('Minimum topup amount is 10 Qc');
          return;
        }

        const submitBtn = div.querySelector('#btnGlobalTopupSubmit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing…';

        try {
          const token = window.Auth.getToken();
          const apiBase = window.Auth.API_BASE || 'http://localhost:7777';
          const res = await fetch(`${apiBase}/api/wallet/topup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount: amt, method: 'UPI' })
          });

          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to top up');
          }

          div.classList.remove('open');
          div.hidden = true;

          // Refresh wallet
          await QJS.refreshWallet();

          if (typeof window.showToast === 'function') {
            window.showToast(`Successfully added ₹${amt} Qc to your wallet!`, 'success');
          } else {
            alert(`Successfully added ${amt} Qc to your wallet!`);
          }
        } catch (err) {
          alert(err.message || 'Top up failed');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Proceed to Pay';
        }
      });
    },

    /**
     * Binds notification bell toggle, click away, and mark-read handlers
     */
    bindNotifications() {
      const notifBtn = $('navNotifBtn');
      const dropdown = $('notifDropdown');
      const markAllBtn = $('markAllNotifsReadBtn');

      if (!notifBtn || !dropdown) return;
      if (notifBtn.dataset.boundNotif) return;
      notifBtn.dataset.boundNotif = 'true';

      notifBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle('show');
        notifBtn.classList.toggle('active', isOpen);
        if (isOpen) {
          if ($('userDropdown')) $('userDropdown').classList.remove('show');
          await this.loadNotificationsList();
        }
      });

      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !notifBtn.contains(e.target)) {
          dropdown.classList.remove('show');
          notifBtn.classList.remove('active');
        }
      });

      if (markAllBtn) {
        markAllBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await window.Auth.authFetch('/api/notifications/read', { method: 'POST' });
            await this.refreshUnread();
            await this.loadNotificationsList();
          } catch (err) {
            console.warn('[QJS] Mark notifications read error:', err);
          }
        });
      }
    },

    /**
     * Loads notifications into the notification dropdown
     */
    async loadNotificationsList() {
      const listEl = $('notifList');
      if (!listEl) return;
      try {
        const res = await window.Auth.authFetch('/api/notifications');
        if (!res.ok) return;
        const data = await res.json();
        const notifs = data.notifications || [];

        if (!notifs.length) {
          listEl.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
          return;
        }

        listEl.innerHTML = notifs.map(n => {
          const timeStr = new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const unreadClass = n.isRead ? '' : 'unread';
          const href = n.link || '#';

          return `
            <a href="${href}" class="notif-item ${unreadClass}">
              <div class="notif-item-title">${this.escapeHtml(n.title)}</div>
              <div class="notif-item-body">${this.escapeHtml(n.body)}</div>
              <div class="notif-item-time">${timeStr}</div>
            </a>
          `;
        }).join('');
      } catch (err) {
        console.warn('[QJS] Load notifications error:', err);
      }
    },

    /**
     * Starts presence heartbeat every 25s
     */
    startPresenceHeartbeat() {
      if (!window.Auth || !window.Auth.hasLocalSession()) return;
      window.Auth.authFetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {});

      if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = setInterval(() => {
        if (window.Auth && window.Auth.hasLocalSession()) {
          window.Auth.authFetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {});
        }
      }, 25000);
    },

    /**
     * Polls unread summary every 5s and updates navigation badges
     */
    startUnreadPolling() {
      if (!window.Auth || !window.Auth.hasLocalSession()) return;
      this.refreshUnread();

      if (this._unreadInterval) clearInterval(this._unreadInterval);
      this._unreadInterval = setInterval(() => {
        if (window.Auth && window.Auth.hasLocalSession()) {
          this.refreshUnread();
        }
      }, 5000);
    },

    /**
     * Refreshes unread counts for bell & navbar links
     */
    async refreshUnread() {
      if (!window.Auth || !window.Auth.hasLocalSession()) return;
      try {
        const res = await window.Auth.authFetch('/api/unread/summary');
        if (!res.ok) return;
        const data = await res.json();
        const summary = data.summary;
        if (!summary) return;

        // 1. Update notification bell badge
        const notifBadge = $('navNotifBadge');
        if (notifBadge) {
          const count = summary.totalUnreadNotifications || 0;
          if (count > 0) {
            notifBadge.textContent = count > 99 ? '99+' : count;
            notifBadge.hidden = false;
          } else {
            notifBadge.hidden = true;
          }
        }

        // 2. Update navbar "My Tasks & Chat" link badge
        const taskNavLinks = document.querySelectorAll('.nav-links a[href*="tasks.html"]');
        taskNavLinks.forEach(link => {
          let badge = link.querySelector('.nav-link-badge');
          const unreadMsgs = summary.totalUnreadMessages || 0;
          if (unreadMsgs > 0) {
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'nav-link-badge';
              link.appendChild(badge);
            }
            badge.textContent = unreadMsgs > 99 ? '99+' : unreadMsgs;
            badge.hidden = false;
          } else if (badge) {
            badge.hidden = true;
          }
        });

        // Broadcast summary to task page if listener registered
        if (typeof window.onQjsUnreadSummary === 'function') {
          window.onQjsUnreadSummary(summary);
        }

      } catch (e) {
        // Silent fail
      }
    },

    escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
  };

  root.QJS = QJS;

  // Auto-init on DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => QJS.init());
    } else {
      QJS.init();
    }
  }

})(typeof window !== 'undefined' ? window : this);
