/* ==========================================================================
   Quick Jobs — Dedicated Task Management & Real-Time Task Chat Controller
   Coordinates My Applications (with withdrawal & chat), Published Tasks
   (with applicant accept/reject & chat), and Browse Tasks.
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  // State
  let currentUser = null;
  let myApplications = [];
  let publishedTasks = [];
  let allBrowseTasks = [];
  let activeTab = 'applications'; // 'applications' | 'published' | 'explore'
  let unreadSummary = null;

  // Chat State
  let activeChat = {
    taskId: null,
    peerId: null,
    peerName: null,
    taskTitle: null,
    pollTimer: null,
    isOpen: false,
    peerPresence: null
  };

  // Withdraw Modal State
  let pendingWithdraw = {
    appId: null,
    taskId: null
  };

  /**
   * Main Initialization
   */
  async function init() {
    currentUser = await Auth.requireAuth();
    if (!currentUser) return;

    setupTabs();
    setupChatDrawer();
    setupWithdrawModal();
    setupExploreFilters();

    // Hook unread updates from core.js
    window.onQjsUnreadSummary = (summary) => {
      unreadSummary = summary;
      renderApplications();
      renderPublishedTasks();
    };

    // Initial Data Fetch
    await reloadData();
  }

  /**
   * Reload all task datasets from Go backend
   */
  async function reloadData() {
    await Promise.all([
      fetchApplications(),
      fetchPublishedTasks(),
      fetchBrowseTasks()
    ]);
    updateKPICounters();
  }

  /**
   * Fetch applications submitted by student
   */
  async function fetchApplications() {
    const listEl = $('applicationsList');
    if (listEl) listEl.innerHTML = `<div class="empty-state">Loading your applications…</div>`;

    try {
      const res = await Auth.authFetch('/api/student/applications');
      if (!res.ok) throw new Error('Failed to load applications');
      const data = await res.json();
      myApplications = data.applications || [];
      renderApplications();
    } catch (err) {
      console.warn('[Tasks] Applications fetch error:', err);
      if (listEl) listEl.innerHTML = `<div class="empty-state">Failed to load applications. Please try again.</div>`;
    }
  }

  /**
   * Fetch tasks published by student
   */
  async function fetchPublishedTasks() {
    const listEl = $('publishedList');
    if (listEl) listEl.innerHTML = `<div class="empty-state">Loading your published tasks…</div>`;

    try {
      const res = await Auth.authFetch('/api/student/published-tasks');
      if (!res.ok) throw new Error('Failed to load published tasks');
      const data = await res.json();
      publishedTasks = data.tasks || [];
      renderPublishedTasks();
    } catch (err) {
      console.warn('[Tasks] Published tasks fetch error:', err);
      if (listEl) listEl.innerHTML = `<div class="empty-state">Failed to load published tasks.</div>`;
    }
  }

  /**
   * Fetch all campus tasks for explore tab
   */
  async function fetchBrowseTasks() {
    try {
      const res = await fetch(`${Auth.API_BASE}/api/tasks`);
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json();
      allBrowseTasks = data.tasks || [];
      renderBrowseTasks();
    } catch (err) {
      console.warn('[Tasks] Browse tasks fetch error:', err);
    }
  }

  /**
   * Update top KPI summary numbers
   */
  function updateKPICounters() {
    const activeApps = myApplications.filter(a => a.status === 'APPLIED' || a.status === 'ACCEPTED');
    const totalPotentialQc = activeApps.reduce((sum, a) => sum + (Number(a.taskReward) || 0), 0);

    if ($('kpiActiveApps')) $('kpiActiveApps').textContent = activeApps.length;
    if ($('kpiPublished')) $('kpiPublished').textContent = publishedTasks.length;
    if ($('kpiPotentialQc')) $('kpiPotentialQc').innerHTML = `<img src="icons/qc.png" class="qc-icon" alt="Qc"> ${totalPotentialQc.toLocaleString('en-IN')} Qc`;

    if ($('badgeAppCount')) $('badgeAppCount').textContent = myApplications.length;
    if ($('badgePubCount')) $('badgePubCount').textContent = publishedTasks.length;
  }

  /**
   * Render student's applications
   */
  function renderApplications() {
    const listEl = $('applicationsList');
    if (!listEl) return;

    if (!myApplications.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size:2.5rem; margin-bottom:0.75rem;">📋</div>
          <h3 style="font-family:'Space Grotesk',sans-serif; color:#fff; margin-bottom:0.4rem;">No Applications Submitted</h3>
          <p style="color:var(--text-secondary); max-width:400px; margin:0 auto 1.25rem;">You haven't applied for any campus gigs yet. Explore live gigs and start earning Quick Coins!</p>
          <button class="btn btn-primary" onclick="window.TaskPage.switchTab('explore')">Browse Available Gigs</button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = myApplications.map(app => {
      const statusClass = `status-${app.status.toLowerCase()}`;
      const isWithdrawn = app.status === 'WITHDRAWN';
      const isRejected = app.status === 'REJECTED';
      const canWithdraw = !isWithdrawn && !isRejected;

      const initials = (app.publisherName || 'Poster').slice(0, 2).toUpperCase();
      const unreadCount = (unreadSummary && unreadSummary.unreadByTask) ? (unreadSummary.unreadByTask[app.taskId] || 0) : 0;

      return `
        <article class="app-card" data-app-id="${app.id}">
          <div class="app-card-top">
            <div class="app-card-title-group">
              <div class="app-badges-row" style="margin-bottom:0.4rem;">
                <span class="badge-category">${escapeHtml(app.taskCategory || 'General')}</span>
                <span class="badge-reward"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(app.taskReward || 0).toLocaleString('en-IN')} Qc</span>
                <span class="badge-category">⏱ ${app.taskHours || 1}h est.</span>
                ${unreadCount > 0 ? `<span class="task-unread-badge">💬 ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}</span>` : ''}
              </div>
              <h3 class="app-task-title">${escapeHtml(app.taskTitle)}</h3>
              <p class="app-task-desc">${escapeHtml(app.taskDesc || '')}</p>
            </div>
            <span class="status-pill ${statusClass}">${escapeHtml(app.status)}</span>
          </div>

          ${app.note ? `
            <div class="app-pitch-box">
              <div class="app-pitch-label">Your Application Pitch:</div>
              <div>${escapeHtml(app.note)}</div>
            </div>
          ` : ''}

          <div class="app-card-footer">
            <div class="app-publisher-meta">
              <div class="publisher-avatar">${initials}</div>
              <div class="publisher-details">
                <span class="publisher-name">${escapeHtml(app.publisherName || 'Campus Staff')} ${window.QJS ? window.QJS.getRoleIcon(app.publisherRole || 'admin') : ''}</span>
                <span class="publisher-sub">${escapeHtml(app.publisherEmail || 'Task Publisher')}</span>
              </div>
            </div>

            <div class="app-actions-group">
              <button type="button" class="btn-chat-action" 
                onclick="window.TaskPage.openChat('${app.taskId}', '${app.publisherId}', '${escapeHtml(app.publisherName || 'Task Poster')}', '${escapeHtml(app.taskTitle)}', '${escapeHtml(app.publisherRole || 'admin')}')">
                💬 Chat with Poster ${unreadCount > 0 ? `<span style="background:#ef4444; color:#fff; border-radius:999px; padding:0.05rem 0.4rem; font-size:0.7rem; font-weight:700;">${unreadCount}</span>` : ''}
              </button>

              ${canWithdraw ? `
                <button type="button" class="btn-withdraw-action" 
                  onclick="window.TaskPage.requestWithdraw('${app.id}', '${app.taskId}', '${escapeHtml(app.taskTitle)}')">
                  ✕ Withdraw
                </button>
              ` : `
                <span style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">
                  ${isWithdrawn ? 'Application Withdrawn' : 'Application Closed'}
                </span>
              `}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  /**
   * Render tasks published by the student with applicant management
   */
  function renderPublishedTasks() {
    const listEl = $('publishedList');
    if (!listEl) return;

    if (!publishedTasks.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size:2.5rem; margin-bottom:0.75rem;">📢</div>
          <h3 style="font-family:'Space Grotesk',sans-serif; color:#fff; margin-bottom:0.4rem;">No Published Tasks</h3>
          <p style="color:var(--text-secondary); max-width:420px; margin:0 auto 1.25rem;">You haven't posted any gigs yet. If you are an administrator, you can create tasks from the Admin Portal.</p>
          <a href="admin.html" class="btn btn-primary" data-auth="admin-only" style="text-decoration:none;">Go to Admin Portal</a>
        </div>
      `;
      return;
    }

    listEl.innerHTML = publishedTasks.map(task => {
      const applicants = task.applicants || [];
      const applicantCount = applicants.length;
      const taskUnread = (unreadSummary && unreadSummary.unreadByTask) ? (unreadSummary.unreadByTask[task.id] || 0) : 0;

      return `
        <article class="app-card" data-task-id="${task.id}">
          <div class="app-card-top">
            <div class="app-card-title-group">
              <div class="app-badges-row" style="margin-bottom:0.4rem;">
                <span class="badge-category">${escapeHtml(task.category || 'General')}</span>
                <span class="badge-reward"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(task.reward || 0).toLocaleString('en-IN')} Qc</span>
                <span class="badge-category">⏱ ${task.estimatedHours || 1}h</span>
                ${taskUnread > 0 ? `<span class="task-unread-badge">💬 ${taskUnread} unread</span>` : ''}
              </div>
              <h3 class="app-task-title">${escapeHtml(task.title)}</h3>
              <p class="app-task-desc">${escapeHtml(task.description || '')}</p>
            </div>
            <span class="badge-category" style="background:rgba(232,184,75,0.12); color:var(--gold); border-color:rgba(232,184,75,0.3); font-weight:700;">
              ${applicantCount} Applicant${applicantCount === 1 ? '' : 's'}
            </span>
          </div>

          <div class="applicants-drawer">
            <div class="applicants-header">
              <span>👥 Student Applicants (${applicantCount})</span>
            </div>

            ${!applicantCount ? `
              <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; padding:0.5rem 0;">
                No students have applied for this task yet.
              </div>
            ` : applicants.map(app => {
              const appInitials = (app.applicantName || 'Student').slice(0, 2).toUpperCase();
              const isApplied = app.status === 'APPLIED';
              const peerUnread = (unreadSummary && unreadSummary.unreadByPeer) ? (unreadSummary.unreadByPeer[app.userId] || 0) : 0;

              return `
                <div class="applicant-row-card">
                  <div class="applicant-info-block">
                    <div class="applicant-avatar">${appInitials}</div>
                    <div>
                      <div class="applicant-name">${escapeHtml(app.applicantName || 'Student')} ${window.QJS ? window.QJS.getRoleIcon(app.applicantRole || 'student') : ''}</div>
                      <div class="applicant-reg">${escapeHtml(app.applicantEmail || '')} · Reg: ${escapeHtml(app.applicantRegNo || 'N/A')}</div>
                      ${app.note ? `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.25rem;"><em>"${escapeHtml(app.note)}"</em></div>` : ''}
                    </div>
                  </div>

                  <div class="applicant-actions-group">
                    <span class="status-pill status-${app.status.toLowerCase()}">${escapeHtml(app.status)}</span>

                    <button type="button" class="btn-chat-action" 
                      onclick="window.TaskPage.openChat('${task.id}', '${app.userId}', '${escapeHtml(app.applicantName || 'Applicant')}', '${escapeHtml(task.title)}', '${escapeHtml(app.applicantRole || 'student')}')">
                      💬 Chat ${peerUnread > 0 ? `<span style="background:#ef4444; color:#fff; border-radius:999px; padding:0.05rem 0.4rem; font-size:0.7rem; font-weight:700; margin-left:0.25rem;">${peerUnread}</span>` : ''}
                    </button>

                    ${isApplied ? `
                      <button type="button" class="btn-status-accept" 
                        onclick="window.TaskPage.updateStatus('${app.id}', 'ACCEPTED')">
                        ✓ Accept
                      </button>
                      <button type="button" class="btn-status-reject" 
                        onclick="window.TaskPage.updateStatus('${app.id}', 'REJECTED')">
                        ✕ Reject
                      </button>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </article>
      `;
    }).join('');
  }

  /**
   * Render browse tasks grid
   */
  function renderBrowseTasks() {
    const grid = $('exploreTasksGrid');
    if (!grid) return;

    const query = ($('exploreSearch')?.value || '').trim().toLowerCase();
    const category = $('exploreCategory')?.value || 'all';

    const appliedIds = new Set(myApplications.filter(a => a.status !== 'WITHDRAWN').map(a => a.taskId));

    const filtered = allBrowseTasks.filter(t => {
      const matchQ = !query || t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query);
      const matchC = category === 'all' || (t.category || '').toLowerCase() === category.toLowerCase();
      return matchQ && matchC;
    });

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No tasks match your filter.</div>`;
      return;
    }

    grid.innerHTML = filtered.map(task => {
      const isApplied = appliedIds.has(task.id);

      return `
        <article class="app-card" data-task-id="${task.id}">
          <div class="app-card-top">
            <div class="app-card-title-group">
              <div class="app-badges-row" style="margin-bottom:0.4rem;">
                <span class="badge-category">${escapeHtml(task.category || 'General')}</span>
                <span class="badge-reward"><img src="icons/qc.png" class="qc-icon" alt="Qc"> ${Number(task.reward).toLocaleString('en-IN')} Qc</span>
              </div>
              <h3 class="app-task-title">${escapeHtml(task.title)}</h3>
              <p class="app-task-desc">${escapeHtml(task.description)}</p>
            </div>
          </div>

          <div class="app-card-footer">
            <span style="font-size:0.8rem; color:var(--text-muted);">⏱ ${task.estimatedHours || 1}h · ${escapeHtml(task.difficulty || 'Medium')}</span>
            
            <button type="button" class="btn-apply ${isApplied ? 'applied' : ''}" 
              ${isApplied ? 'disabled' : ''} 
              onclick="window.TaskPage.applyFromExplore('${task.id}', this)">
              ${isApplied ? '✓ Applied' : 'Apply for Task'}
            </button>
          </div>
        </article>
      `;
    }).join('');
  }

  /**
   * Quick Apply from Explore tab
   */
  async function applyFromExplore(taskId, btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const res = await Auth.authFetch('/api/tasks/apply', {
        method: 'POST',
        body: JSON.stringify({ taskId, note: 'Applied via dedicated task manager' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit application');

      btn.classList.add('applied');
      btn.textContent = '✓ Applied';
      Auth.showToast('Application sent! You can now track and chat with the poster.', 'success');

      // Reload applications and published stats
      await fetchApplications();
      updateKPICounters();

    } catch (err) {
      Auth.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Apply for Task';
    }
  }

  /**
   * Open confirmation dialog for withdrawing an application
   */
  function requestWithdraw(appId, taskId, taskTitle) {
    pendingWithdraw = { appId, taskId };
    const modal = $('withdrawModalBackdrop');
    const titleEl = $('withdrawTaskTitle');
    if (titleEl) titleEl.textContent = `"${taskTitle}"`;
    if (modal) modal.classList.add('show');
  }

  /**
   * Execute application withdrawal
   */
  async function confirmWithdrawAction() {
    const modal = $('withdrawModalBackdrop');
    const confirmBtn = $('confirmWithdrawBtn');

    if (!pendingWithdraw.appId && !pendingWithdraw.taskId) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Withdrawing…';

    try {
      const res = await Auth.authFetch('/api/tasks/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          applicationId: pendingWithdraw.appId,
          taskId: pendingWithdraw.taskId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to withdraw application');

      Auth.showToast('Application successfully withdrawn.', 'success');
      if (modal) modal.classList.remove('show');

      // Refresh applications
      await fetchApplications();
      updateKPICounters();

    } catch (err) {
      Auth.showToast(err.message, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Yes, Withdraw Application';
      pendingWithdraw = { appId: null, taskId: null };
    }
  }

  /**
   * Publisher accepts or rejects applicant
   */
  async function updateStatus(appId, status) {
    try {
      const res = await Auth.authFetch('/api/tasks/application-status', {
        method: 'POST',
        body: JSON.stringify({ applicationId: appId, status })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update applicant status');

      Auth.showToast(`Applicant marked as ${status}`, 'success');
      await fetchPublishedTasks();
      updateKPICounters();
    } catch (err) {
      Auth.showToast(err.message, 'error');
    }
  }

  /**
   * Open Sliding Task Chat Drawer
   */
  async function openChat(taskId, peerId, peerName, taskTitle, peerRole = 'student') {
    activeChat = {
      taskId,
      peerId,
      peerName,
      taskTitle,
      peerRole,
      pollTimer: null,
      isOpen: true,
      peerPresence: null
    };

    const drawer = $('chatDrawerBackdrop');
    const nameEl = $('chatPeerName');
    const contextEl = $('chatTaskContext');
    const avatarEl = $('chatPeerAvatar');

    if (nameEl) nameEl.innerHTML = `${escapeHtml(peerName)} ${window.QJS ? window.QJS.getRoleIcon(peerRole) : ''}`;
    if (contextEl) contextEl.textContent = `Regarding: ${taskTitle}`;
    if (avatarEl) avatarEl.textContent = (peerName || '?').slice(0, 2).toUpperCase();

    if (drawer) drawer.classList.add('show');
    $('chatInput')?.focus();

    await Promise.all([
      checkPeerPresence(),
      loadConversation()
    ]);

    // Poll every 3s
    if (activeChat.pollTimer) clearInterval(activeChat.pollTimer);
    activeChat.pollTimer = setInterval(async () => {
      await Promise.all([
        checkPeerPresence(),
        loadConversation()
      ]);
    }, 3000);
  }

  /**
   * Check online/offline presence for active peer
   */
  async function checkPeerPresence() {
    if (!activeChat.peerId) return;
    try {
      const res = await Auth.authFetch(`/api/presence?userId=${encodeURIComponent(activeChat.peerId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const p = data.presence ? data.presence[activeChat.peerId] : null;
      activeChat.peerPresence = p;
      updatePeerPresenceUI(p);
    } catch (e) {}
  }

  function updatePeerPresenceUI(p) {
    const dot = $('chatPeerPresenceDot');
    const text = $('chatPeerPresenceText');
    if (!dot || !text) return;

    if (p && p.isOnline) {
      dot.className = 'presence-dot online';
      text.className = 'presence-text online';
      text.textContent = 'Online';
    } else {
      dot.className = 'presence-dot offline';
      text.className = 'presence-text';
      if (p && p.lastSeen && !p.lastSeen.startsWith('0001')) {
        const diffMinutes = Math.floor((Date.now() - new Date(p.lastSeen).getTime()) / 60000);
        if (diffMinutes < 1) {
          text.textContent = 'Offline · Just now';
        } else if (diffMinutes < 60) {
          text.textContent = `Offline · Last seen ${diffMinutes}m ago`;
        } else {
          text.textContent = 'Offline';
        }
      } else {
        text.textContent = 'Offline';
      }
    }
  }

  /**
   * Close Sliding Chat Drawer
   */
  function closeChat() {
    if (activeChat.pollTimer) {
      clearInterval(activeChat.pollTimer);
      activeChat.pollTimer = null;
    }
    activeChat.isOpen = false;
    const drawer = $('chatDrawerBackdrop');
    if (drawer) drawer.classList.remove('show');
  }

  /**
   * Load chat conversation with double ticks and read receipt triggers
   */
  async function loadConversation() {
    if (!activeChat.isOpen || !activeChat.taskId || !activeChat.peerId) return;

    const container = $('chatMessagesContainer');
    try {
      const res = await Auth.authFetch(`/api/tasks/messages?taskId=${encodeURIComponent(activeChat.taskId)}&peerId=${encodeURIComponent(activeChat.peerId)}`);
      if (!res.ok) return;

      const data = await res.json();
      const messages = data.messages || [];

      if (!container) return;

      if (!messages.length) {
        container.innerHTML = `
          <div class="chat-empty-hint">
            💬 No messages yet.<br>Start the conversation regarding this task!
          </div>
        `;
        return;
      }

      const wasScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
      let hasUnreadIncoming = false;

      container.innerHTML = messages.map(msg => {
        const isOut = msg.senderId === currentUser.id;
        const bubbleClass = isOut ? 'chat-bubble-out' : 'chat-bubble-in';
        const senderLabel = isOut ? 'You' : (msg.senderName || activeChat.peerName);
        const senderRole = isOut ? (currentUser.role || 'student') : (msg.senderRole || activeChat.peerRole || 'student');
        const roleBadge = window.QJS ? window.QJS.getRoleIcon(senderRole, senderRole === 'admin') : '';
        const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (!isOut && !msg.isRead) {
          hasUnreadIncoming = true;
        }

        let tickHtml = '';
        if (isOut) {
          if (msg.isRead) {
            tickHtml = `<span class="chat-tick tick-read" title="Seen / Read by ${escapeHtml(activeChat.peerName)}">✓✓</span>`;
          } else if (activeChat.peerPresence && activeChat.peerPresence.isOnline) {
            tickHtml = `<span class="chat-tick tick-delivered" title="Delivered">✓✓</span>`;
          } else {
            tickHtml = `<span class="chat-tick tick-sent" title="Sent to server">✓</span>`;
          }
        }

        return `
          <div class="chat-bubble ${bubbleClass}">
            <span class="chat-sender-tag">${escapeHtml(senderLabel)} ${roleBadge}</span>
            <span>${escapeHtml(msg.content)}</span>
            <div class="chat-meta-row">
              <span class="chat-timestamp">${timeStr}</span>
              ${tickHtml}
            </div>
          </div>
        `;
      }).join('');

      if (wasScrolledToBottom || container.children.length === messages.length) {
        container.scrollTop = container.scrollHeight;
      }

      // Mark incoming messages as read
      if (hasUnreadIncoming) {
        Auth.authFetch('/api/tasks/messages/read', {
          method: 'POST',
          body: JSON.stringify({ taskId: activeChat.taskId, peerId: activeChat.peerId })
        }).then(() => {
          if (window.QJS) window.QJS.refreshUnread();
        }).catch(() => {});
      }

    } catch (e) {
      console.warn('[Chat] Could not load messages:', e);
    }
  }

  /**
   * Send a chat message
   */
  async function sendMessage() {
    const input = $('chatInput');
    const content = (input?.value || '').trim();
    if (!content || !activeChat.taskId || !activeChat.peerId) return;

    input.value = '';

    try {
      const res = await Auth.authFetch('/api/tasks/messages', {
        method: 'POST',
        body: JSON.stringify({
          taskId: activeChat.taskId,
          recipientId: activeChat.peerId,
          content
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      await loadConversation();

    } catch (err) {
      Auth.showToast(err.message, 'error');
    }
  }

  /**
   * Setup UI Tabs
   */
  function setupTabs() {
    document.querySelectorAll('.tab-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-nav-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });

    $('viewApplications').hidden = (tab !== 'applications');
    $('viewPublished').hidden = (tab !== 'published');
    $('viewExplore').hidden = (tab !== 'explore');
  }

  /**
   * Setup Chat Drawer Listeners
   */
  function setupChatDrawer() {
    const closeBtn = $('closeChatBtn');
    const backdrop = $('chatDrawerBackdrop');
    const form = $('chatForm');

    if (closeBtn) closeBtn.addEventListener('click', closeChat);
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeChat();
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
      });
    }
  }

  /**
   * Setup Withdraw Modal Listeners
   */
  function setupWithdrawModal() {
    const modal = $('withdrawModalBackdrop');
    const cancelBtn = $('cancelWithdrawBtn');
    const confirmBtn = $('confirmWithdrawBtn');

    if (cancelBtn) cancelBtn.addEventListener('click', () => modal?.classList.remove('show'));
    if (confirmBtn) confirmBtn.addEventListener('click', confirmWithdrawAction);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    }
  }

  /**
   * Setup Explore search and filters
   */
  function setupExploreFilters() {
    $('exploreSearch')?.addEventListener('input', renderBrowseTasks);
    $('exploreCategory')?.addEventListener('change', renderBrowseTasks);
  }

  // Expose global controller for inline onclicks
  window.TaskPage = {
    switchTab,
    openChat,
    closeChat,
    requestWithdraw,
    updateStatus,
    applyFromExplore
  };

  document.addEventListener('DOMContentLoaded', init);

})();