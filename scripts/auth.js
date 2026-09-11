/* ==========================================================================
   Quick Jobs — Central Auth & Session Verification Library
   Provides secure session checks, automatic token validation against SQLite,
   and clean logout handlers for all pages across QJS.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Auth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SESSION_KEY = 'lqj_session';
  const API_BASE = (window.location.port === '7777')
    ? window.location.origin
    : 'http://localhost:7777';

  const ENDPOINTS = {
    me: '/api/auth/me',
    logout: '/api/auth/logout',
    health: '/api/health'
  };

  const Auth = {
    API_BASE,
    SESSION_KEY,

    /**
     * Retrieve local session object if available.
     */
    getSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * Get active authentication token.
     */
    getToken() {
      const sess = this.getSession();
      return sess ? sess.token : null;
    },

    /**
     * Get active user profile.
     */
    getUser() {
      const sess = this.getSession();
      return sess ? sess.user : null;
    },

    /**
     * Synchronous check if token exists locally.
     */
    hasLocalSession() {
      return !!this.getToken();
    },

    /**
     * Authenticated fetch helper: automatically injects API_BASE and Authorization Bearer header.
     */
    async authFetch(url, options = {}) {
      const fullUrl = url.startsWith('http') ? url : (API_BASE + (url.startsWith('/') ? url : '/' + url));
      const headers = Object.assign({}, options.headers || {});
      const token = this.getToken();
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return fetch(fullUrl, { ...options, headers });
    },

    /**
     * Asynchronously verifies the session token against SQLite backend (/api/auth/me).
     * Automatically invalidates stale sessions and redirects unauthenticated users.
     */
    async checkSession(options = {}) {
      const {
        redirectToLogin = false,
        onAuthenticated = null,
        onUnauthenticated = null
      } = options;

      const token = this.getToken();
      if (!token) {
        if (redirectToLogin) {
          this.redirectToLogin();
        }
        if (typeof onUnauthenticated === 'function') {
          onUnauthenticated();
        }
        return null;
      }

      try {
        const res = await fetch(API_BASE + ENDPOINTS.me, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.user) {
            // Update cached user in storage
            const current = this.getSession() || {};
            current.user = data.user;
            localStorage.setItem(SESSION_KEY, JSON.stringify(current));

            // Populate any DOM elements wired with data-auth
            this.populateUserDOM(data.user);

            if (typeof onAuthenticated === 'function') {
              onAuthenticated(data.user);
            }
            return data.user;
          }
        }

        // Response not OK -> token expired, revoked or invalid
        this.clearLocalSession();
        if (redirectToLogin) {
          this.redirectToLogin();
        }
        if (typeof onUnauthenticated === 'function') {
          onUnauthenticated();
        }
        return null;

      } catch (err) {
        console.warn('[Auth] Server check failed:', err);
        // Fallback to local user if network fails temporarily, or redirect if strict
        const user = this.getUser();
        if (user) {
          this.populateUserDOM(user);
          return user;
        }
        if (redirectToLogin) {
          this.redirectToLogin();
        }
        return null;
      }
    },

    /**
     * Enforce authentication for protected pages.
     */
    async requireAuth(options = {}) {
      return this.checkSession({ redirectToLogin: true, ...options });
    },

    /**
     * Clear local session storage.
     */
    clearLocalSession() {
      localStorage.removeItem(SESSION_KEY);
    },

    /**
     * Redirects browser to login.html.
     */
    redirectToLogin() {
      const current = window.location.pathname;
      if (!current.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
    },

    /**
     * Logout active user: revokes session in SQLite and clears local storage.
     */
    async logout() {
      const token = this.getToken();
      if (token) {
        try {
          await fetch(API_BASE + ENDPOINTS.logout, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
        } catch (e) {
          console.warn('[Auth] Logout request error:', e);
        }
      }

      this.clearLocalSession();
      window.location.href = 'login.html';
    },

    /**
     * Check if active user is an administrator.
     */
    isAdmin() {
      const u = this.getUser();
      return !!(u && u.isAdmin);
    },

    escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    },

    /**
     * Returns HTML for the role icon (Student, Faculty, Admin)
     */
    getRoleBadgeHtml(role, isAdmin) {
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
     * Auto-populate elements decorated with data-auth attributes.
     * e.g. <span data-auth="name"></span>
     */
    populateUserDOM(user) {
      if (!user) return;
      const roleBadge = this.getRoleBadgeHtml(user.role, user.isAdmin);

      document.querySelectorAll('[data-auth="name"]').forEach(el => {
        el.innerHTML = `${this.escapeHtml(user.name || 'Student')} ${roleBadge}`;
      });
      document.querySelectorAll('[data-auth="role-badge"]').forEach(el => {
        el.innerHTML = roleBadge;
      });
      document.querySelectorAll('[data-auth="regNo"]').forEach(el => {
        el.textContent = user.regNo || '—';
      });
      document.querySelectorAll('[data-auth="email"]').forEach(el => {
        el.textContent = user.email || '—';
      });
      document.querySelectorAll('[data-auth="phone"]').forEach(el => {
        el.textContent = user.phone || '—';
      });
      document.querySelectorAll('[data-auth="initials"]').forEach(el => {
        const parts = (user.name || 'Student').trim().split(/\s+/);
        const initials = parts.length > 1
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : (user.name ? user.name[0].toUpperCase() : 'S');
        el.textContent = initials;
      });

      // Toggle admin-only elements
      document.querySelectorAll('[data-auth="admin-only"]').forEach(el => {
        el.hidden = !user.isAdmin;
      });
    },

    /**
     * Auto-wire logout buttons with data-auth="logout"
     */
    bindEvents() {
      document.querySelectorAll('[data-auth="logout"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.logout();
        });
      });
    }
  };

  // Auto-bind click handlers when DOM loads
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      Auth.bindEvents();
    });
  }

  return Auth;
});
