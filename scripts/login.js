/* ==========================================================================
   Quick Jobs — Authentication & Login Logic
   Connects to the Golang SQLite backend on port 7777.
   Features strict session verification, zero guest mode fallbacks,
   real-time password rules validation, and automated session restoration.
   ========================================================================== */

(() => {
  'use strict';

  // Determine API base: use current origin if on backend port (7777) or has api, else default to localhost:7777
  const isDirectBackend = window.location.port === '7777' || window.location.hostname === 'localhost';
  const API_BASE = (window.location.port === '7777')
    ? window.location.origin
    : 'http://localhost:7777';

  const CONFIG = {
    API_BASE,
    ENDPOINTS: {
      ping: '/api/health',
      login: '/api/auth/login',
      signup: '/api/auth/signup',
      me: '/api/auth/me',
      logout: '/api/auth/logout'
    },
    TIMEOUT_MS: 5000,
    REDIRECT_URL: 'index.html',
    SESSION_KEY: 'lqj_session'
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    tabs: document.querySelector('.tabs'),
    tabLogin: $('tabLogin'),
    tabSignup: $('tabSignup'),
    panelLogin: $('panelLogin'),
    panelSignup: $('panelSignup'),
    formWrap: $('formWrap'),
    loginForm: $('loginForm'),
    signupForm: $('signupForm'),
    loginSubmit: $('loginSubmit'),
    signupSubmit: $('signupSubmit'),
    loginError: $('loginError'),
    signupError: $('signupError'),
    gotoSignup: $('gotoSignup'),
    switchHint: $('switchHint'),
    toastContainer: $('toastContainer'),
    heroWrap: $('hero'),
    floatIcons: $('floatIcons'),
    peekLogin: $('peekLogin'),
    peekSignup: $('peekSignup'),
    rememberMe: $('rememberMe')
  };

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let backendReachable = false;

  /* ---------------- fetch with timeout ---------------- */
  async function fetchWithTimeout(url, options = {}, timeout = CONFIG.TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  /* ---------------- backend health check & auto-session check ---------------- */
  async function checkBackend() {
    els.statusDot.className = 'status-dot checking';
    els.statusText.textContent = 'Checking server…';
    try {
      const res = await fetchWithTimeout(CONFIG.API_BASE + CONFIG.ENDPOINTS.ping, { method: 'GET' }, 3000);
      if (res.ok) {
        backendReachable = true;
        els.statusDot.className = 'status-dot online';
        els.statusText.textContent = 'Server connected';

        // Check if user already has an active authenticated session
        await verifyExistingSession();
      } else {
        throw new Error('Server returned unhealthy status');
      }
    } catch (err) {
      backendReachable = false;
      els.statusDot.className = 'status-dot offline';
      els.statusText.textContent = 'Server offline (start backend on :7777)';
    }
  }

  async function verifyExistingSession() {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    if (!raw) return;

    try {
      const sess = JSON.parse(raw);
      if (!sess || !sess.token) return;

      const res = await fetchWithTimeout(CONFIG.API_BASE + CONFIG.ENDPOINTS.me, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sess.token}`,
          'Content-Type': 'application/json'
        }
      }, 3000);

      if (res.ok) {
        const data = await res.json();
        // Update user data if changed
        if (data && data.user) {
          sess.user = data.user;
          localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(sess));
        }
        showToast(`Welcome back, ${sess.user?.name || 'Student'}! Redirecting…`, 'info');
        setTimeout(redirectToApp, 500);
      } else {
        // Session expired or invalid on server
        localStorage.removeItem(CONFIG.SESSION_KEY);
      }
    } catch (e) {
      // Ignore network errors during passive check
    }
  }

  /* ---------------- tabs ---------------- */
  function setHeight(target) {
    if (!target) return;
    els.formWrap.style.height = target.scrollHeight + 'px';
  }

  function switchTab(name) {
    const toSignup = name === 'signup';
    els.tabs.classList.toggle('signup-active', toSignup);
    els.tabLogin.classList.toggle('active', !toSignup);
    els.tabSignup.classList.toggle('active', toSignup);
    els.tabLogin.setAttribute('aria-selected', String(!toSignup));
    els.tabSignup.setAttribute('aria-selected', String(toSignup));

    const showEl = toSignup ? els.panelSignup : els.panelLogin;
    const hideEl = toSignup ? els.panelLogin : els.panelSignup;

    showEl.hidden = false;
    hideEl.hidden = true;
    setHeight(showEl);
    els.switchHint.style.display = toSignup ? 'none' : 'block';

    clearError(els.loginError);
    clearError(els.signupError);
  }

  els.tabLogin.addEventListener('click', () => switchTab('login'));
  els.tabSignup.addEventListener('click', () => switchTab('signup'));
  if (els.gotoSignup) {
    els.gotoSignup.addEventListener('click', () => switchTab('signup'));
  }

  /* ---------------- password peek ---------------- */
  function wirePeek(btn, inputId) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const input = $(inputId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('active');
    });
  }
  wirePeek(els.peekLogin, 'loginPassword');
  wirePeek(els.peekSignup, 'suPassword');

  /* ---------------- ripple ---------------- */
  document.querySelectorAll('.btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  });

  /* ---------------- parallax on hero ---------------- */
  if (!prefersReducedMotion && els.heroWrap && els.floatIcons) {
    els.heroWrap.addEventListener('mousemove', (e) => {
      const rect = els.heroWrap.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      els.floatIcons.style.transform = `translate(${px * 14}px, ${py * 14}px)`;
    });
    els.heroWrap.addEventListener('mouseleave', () => {
      els.floatIcons.style.transform = 'translate(0,0)';
    });
  }

  /* ---------------- toasts ---------------- */
  function showToast(message, type = 'info') {
    if (!els.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 320);
    }, 3800);
  }

  /* ---------------- inline errors ---------------- */
  function setError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    const visible = els.panelSignup.hidden ? els.panelLogin : els.panelSignup;
    setHeight(visible);
  }

  function clearError(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.remove('show');
    const visible = els.panelSignup.hidden ? els.panelLogin : els.panelSignup;
    setHeight(visible);
  }

  /* ---------------- button state ---------------- */
  function setLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('is-loading', loading);
    btn.disabled = loading;
  }

  function flashSuccess(btn) {
    if (!btn) return;
    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = 'Success';
  }

  /* ---------------- session handling ---------------- */
  function saveSession(session) {
    localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
      ...session,
      createdAt: Date.now()
    }));
  }

  function redirectToApp() {
    window.location.href = CONFIG.REDIRECT_URL;
  }

  /* ---------------- password rules live check ---------------- */
  function updatePasswordRules(password) {
    const isMinLength = password.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    const ruleLen = $('ruleLength');
    const ruleLet = $('ruleLetter');
    const ruleNum = $('ruleNumber');

    if (ruleLen) ruleLen.classList.toggle('valid', isMinLength);
    if (ruleLet) ruleLet.classList.toggle('valid', hasLetter);
    if (ruleNum) ruleNum.classList.toggle('valid', hasNumber);

    if (!els.panelSignup.hidden) {
      setHeight(els.panelSignup);
    }
  }

  const suPasswordEl = $('suPassword');
  if (suPasswordEl) {
    suPasswordEl.addEventListener('input', (e) => {
      updatePasswordRules(e.target.value);
    });
  }

  /* ---------------- validation ---------------- */
  function validateLogin(data) {
    if (!data.identifier.trim()) return 'Enter your email, registration number, or phone number.';
    if (!data.password || data.password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  function validateSignup(data) {
    if (!data.name.trim()) return 'Enter your full name.';
    if (!data.phone.trim()) return 'Enter your phone number.';
    if (!/^[0-9+\s-]{7,15}$/.test(data.phone.trim())) return 'Enter a valid phone number (7-15 digits).';
    if (!data.regNo.trim()) return 'Enter your registration number.';
    if (!/^\S+@\S+\.\S+$/.test(data.email.trim())) return 'Enter a valid email address.';
    if (!data.password || data.password.length < 6) return 'Password must be at least 6 characters.';
    if (!/[a-zA-Z]/.test(data.password)) return 'Password must contain at least one letter.';
    if (!/[0-9]/.test(data.password)) return 'Password must contain at least one number.';
    if (data.password !== data.confirm) return 'Passwords do not match.';
    return null;
  }

  /* ---------------- auth flow ---------------- */
  async function handleAuth({ type, endpoint, payload, submitBtn, errorEl }) {
    clearError(errorEl);

    // If backend is not known to be reachable, try pinging first
    if (!backendReachable) {
      setLoading(submitBtn, true);
      try {
        const pingRes = await fetchWithTimeout(CONFIG.API_BASE + CONFIG.ENDPOINTS.ping, {}, 2000);
        if (pingRes.ok) {
          backendReachable = true;
          els.statusDot.className = 'status-dot online';
          els.statusText.textContent = 'Server connected';
        } else {
          throw new Error('Server not ready');
        }
      } catch (err) {
        setLoading(submitBtn, false);
        setError(errorEl, 'Unable to connect to authentication server. Please ensure the backend is running.');
        showToast('Backend server is offline', 'error');
        return;
      }
    }

    setLoading(submitBtn, true);

    try {
      const res = await fetchWithTimeout(CONFIG.API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        // non-JSON
      }

      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || `${type === 'login' ? 'Log in' : 'Sign up'} failed. Check your details.`;
        setLoading(submitBtn, false);
        setError(errorEl, msg);
        showToast(msg, 'error');
        return;
      }

      if (!body || !body.token) {
        setLoading(submitBtn, false);
        setError(errorEl, 'Server returned an invalid session.');
        return;
      }

      // Save authenticated session token & profile
      saveSession({
        mode: 'authenticated',
        token: body.token,
        user: body.user,
        remember: !!payload.rememberMe
      });

      flashSuccess(submitBtn);
      showToast(type === 'login' ? `Welcome back, ${body.user?.name || 'Student'}!` : 'Account created successfully!', 'success');

      await sleep(400);
      redirectToApp();

    } catch (err) {
      setLoading(submitBtn, false);
      setError(errorEl, 'Network error. Could not contact the authentication server.');
      showToast('Connection to server failed', 'error');
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ---------------- form listeners ---------------- */
  els.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      identifier: $('loginId').value,
      password: $('loginPassword').value,
      rememberMe: els.rememberMe ? els.rememberMe.checked : false
    };
    const err = validateLogin(data);
    if (err) {
      setError(els.loginError, err);
      return;
    }

    handleAuth({
      type: 'login',
      endpoint: CONFIG.ENDPOINTS.login,
      payload: data,
      submitBtn: els.loginSubmit,
      errorEl: els.loginError
    });
  });

  els.signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: $('suName').value,
      phone: $('suPhone').value,
      regNo: $('suReg').value,
      email: $('suEmail').value,
      password: $('suPassword').value,
      confirm: $('suConfirm').value,
      role: ($('suRole') ? $('suRole').value : 'student')
    };
    const err = validateSignup(data);
    if (err) {
      setError(els.signupError, err);
      return;
    }

    handleAuth({
      type: 'signup',
      endpoint: CONFIG.ENDPOINTS.signup,
      payload: data,
      submitBtn: els.signupSubmit,
      errorEl: els.signupError
    });
  });

  /* ---------------- init ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    // Role selector interaction
    const roleGroup = $('roleSelectorGroup');
    const roleInput = $('suRole');
    if (roleGroup && roleInput) {
      roleGroup.querySelectorAll('.role-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          roleGroup.querySelectorAll('.role-select-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-checked', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-checked', 'true');
          roleInput.value = btn.getAttribute('data-role') || 'student';
        });
      });
    }

    setHeight(els.panelLogin);
    checkBackend();
  });

  window.addEventListener('resize', () => {
    const visible = els.panelSignup.hidden ? els.panelLogin : els.panelSignup;
    els.formWrap.style.height = visible.scrollHeight + 'px';
  });

})();