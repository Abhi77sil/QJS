/* ==========================================================
   PULSE CHAT — script.js
   Pure vanilla JS. No frameworks, no build step.
   ========================================================== */
(function () {
  'use strict';

  /* ---------- Constants ---------- */
  const STORAGE_KEY = 'pulse_chat_v1';
  const EMOJIS = [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰',
    '😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏',
    '😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠',
    '😡','🤬','👍','👎','👌','✌️','🤞','🤝','🙏','👏','🙌','💪','❤️','🧡','💛','💚',
    '💙','💜','🖤','🤍','💔','💕','🔥','✨','🎉','🎊','⭐','🌟','💯','✅','❌','⚡'
  ];
  const AUTO_REPLIES = [
    'Got it!', 'Sounds good 👍', 'Haha nice', 'Let me check...', 'Okay, will do',
    'Sure thing!', 'On it 🚀', 'Thanks!', 'Interesting...', 'Tell me more',
    'I agree', 'Perfect!', 'Cool cool', 'Makes sense', 'Alright then', 'Nice one!'
  ];

  /* ---------- Tiny helpers ---------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hashStr = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

  const GRADIENTS = [
    ['#6366f1', '#8b5cf6'], ['#ec4899', '#f43f5e'], ['#06b6d4', '#3b82f6'],
    ['#f59e0b', '#ef4444'], ['#10b981', '#06b6d4'], ['#8b5cf6', '#ec4899'],
    ['#f43f5e', '#f59e0b'], ['#0ea5e9', '#6366f1'], ['#a855f7', '#06b6d4'],
    ['#f97316', '#ec4899']
  ];
  const gradientFor = (seed) => {
    const g = GRADIENTS[hashStr(seed) % GRADIENTS.length];
    return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatChatListTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60 * 1000) return 'now';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + 'm';
    if (d.toDateString() === now.toDateString()) return formatTime(ts);
    if (diff < 7 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const formatDay = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  };

  /* ---------- State ---------- */
  let state = null;

  /* ---------- Seed data (first run only) ---------- */
  function seedData() {
    const now = Date.now();
    const convos = [
      {
        id: 'c1',
        name: 'Priya Sharma',
        status: 'online',
        online: true,
        unread: 2,
        messages: [
          { id: uid(), text: 'Hey! Are you coming to the study group tonight?', time: now - 3600e3 * 5, sender: 'them', status: 'read' },
          { id: uid(), text: 'Yeah I should be there around 7', time: now - 3600e3 * 4.8, sender: 'me', status: 'read' },
          { id: uid(), text: 'Perfect! Bring your notes on the algorithms chapter 📚', time: now - 3600e3 * 4.5, sender: 'them', status: 'read' },
          { id: uid(), text: 'Will do', time: now - 3600e3 * 2, sender: 'me', status: 'read' },
          { id: uid(), text: 'Also I found this really good resource for dynamic programming', time: now - 1800e3, sender: 'them', status: 'read' },
          { id: uid(), text: 'Send it over! I have been struggling with it', time: now - 900e3, sender: 'them', status: 'read' }
        ]
      },
      {
        id: 'c2',
        name: 'Design Team',
        status: '3 members',
        online: true,
        unread: 0,
        messages: [
          { id: uid(), text: 'New mockups are up on Figma', time: now - 864e5, sender: 'them', status: 'read' },
          { id: uid(), text: 'Love the new color palette 🎨', time: now - 864e5 + 300e3, sender: 'me', status: 'read' },
          { id: uid(), text: 'Thanks! Let me know if you want changes', time: now - 864e5 + 600e3, sender: 'them', status: 'read' }
        ]
      },
      {
        id: 'c3',
        name: 'Rahul Verma',
        status: 'last seen 2h ago',
        online: false,
        unread: 0,
        messages: [
          { id: uid(), text: 'Did you submit the assignment?', time: now - 864e5 * 2, sender: 'me', status: 'read' },
          { id: uid(), text: 'Not yet, doing it tonight', time: now - 864e5 * 2 + 60e3, sender: 'them', status: 'read' },
          { id: uid(), text: 'Cool, ping me if you need help', time: now - 864e5 * 2 + 120e3, sender: 'me', status: 'read' }
        ]
      },
      {
        id: 'c4',
        name: 'Maya Kapoor',
        status: 'online',
        online: true,
        unread: 1,
        messages: [
          { id: uid(), text: 'The photos from yesterday turned out great!', time: now - 7200e3, sender: 'them', status: 'read' },
          { id: uid(), text: 'Can you send them to me?', time: now - 7000e3, sender: 'me', status: 'read' },
          { id: uid(), text: 'Just uploaded them to drive 😊', time: now - 300e3, sender: 'them', status: 'read' }
        ]
      },
      {
        id: 'c5',
        name: 'Arjun Mehta',
        status: 'last seen yesterday',
        online: false,
        unread: 0,
        messages: [
          { id: uid(), text: 'Want to grab coffee later?', time: now - 864e5 * 3, sender: 'them', status: 'read' },
          { id: uid(), text: 'Sure, 4pm at the usual place?', time: now - 864e5 * 3 + 300e3, sender: 'me', status: 'read' },
          { id: uid(), text: 'Works for me ☕', time: now - 864e5 * 3 + 600e3, sender: 'them', status: 'read' }
        ]
      },
      {
        id: 'c6',
        name: 'Sneha Iyer',
        status: 'away',
        online: false,
        unread: 0,
        messages: [
          { id: uid(), text: 'Happy birthday!! 🎉🎂', time: now - 864e5 * 5, sender: 'me', status: 'read' },
          { id: uid(), text: 'Thank you so much! ❤️', time: now - 864e5 * 5 + 120e3, sender: 'them', status: 'read' }
        ]
      }
    ];

    const contacts = [
      { id: 'u1', name: 'Devansh Rana', status: 'online' },
      { id: 'u2', name: 'Tanvi Joshi', status: 'last seen 1h ago' },
      { id: 'u3', name: 'Nikhil Yadav', status: 'online' },
      { id: 'u4', name: 'Pooja Malhotra', status: 'away' },
      { id: 'u5', name: 'Harsh Chauhan', status: 'last seen today' },
      { id: 'u6', name: 'Kavya Bansal', status: 'online' },
      { id: 'u7', name: 'Manav Thakur', status: 'last seen yesterday' },
      { id: 'u8', name: 'Ishita Rana', status: 'online' }
    ];

    return {
      version: 1,
      user: {
        name: 'Alex Morgan',
        status: 'Available',
        statusType: 'online',
        avatar: null,
        notifications: true
      },
      theme: 'dark',
      conversations: convos,
      contacts,
      activeId: 'c1'
    };
  }

  /* ---------- Persistence ---------- */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.conversations)) return null;
      return parsed;
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const meta = $('#themeColorMeta');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0a0c12' : '#eef1f7');
  }
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
    toast(`Switched to ${state.theme} mode`, 'info');
  }

  /* ---------- Toasts ---------- */
  function toast(message, type = 'info') {
    const wrap = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icons = { success: '✓', error: '!', info: 'ℹ' };
    el.innerHTML = `<span class="t-icon">${icons[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  /* ---------- Avatar rendering ---------- */
  function renderAvatar(el, name, avatarUrl) {
    if (!el) return;
    if (avatarUrl) {
      el.innerHTML = `<img src="${avatarUrl}" alt="" />`;
      el.style.background = 'transparent';
    } else {
      el.textContent = initials(name);
      el.style.background = gradientFor(name);
    }
  }

  /* ---------- Chat list ---------- */
  function renderChatList() {
    const list = $('#chatList');
    const query = ($('#searchInput').value || '').trim().toLowerCase();

    let convos = state.conversations.slice();

    // Sort: unread first, then most recent activity
    convos.sort((a, b) => {
      const at = a.messages.length ? a.messages[a.messages.length - 1].time : 0;
      const bt = b.messages.length ? b.messages[b.messages.length - 1].time : 0;
      return bt - at;
    });

    // Filter by search query (name or message text)
    if (query) {
      convos = convos.filter(c => {
        if (c.name.toLowerCase().includes(query)) return true;
        return c.messages.some(m => m.text.toLowerCase().includes(query));
      });
    }

    if (!convos.length) {
      list.innerHTML = `
        <div class="list-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <div>${query ? 'No chats match your search' : 'No conversations yet'}</div>
        </div>`;
      return;
    }

    list.innerHTML = convos.map(c => {
      const last = c.messages[c.messages.length - 1];
      let previewHtml = '';
      if (!last) {
        previewHtml = '<em>No messages yet</em>';
      } else {
        const prefix = last.sender === 'me' ? 'You: ' : '';
        let text = last.text;
        // Highlight search query in preview
        if (query && text.toLowerCase().includes(query)) {
          const idx = text.toLowerCase().indexOf(query);
          const start = Math.max(0, idx - 20);
          const snippet = (start > 0 ? '…' : '') + text.slice(start, start + 60) + (text.length > start + 60 ? '…' : '');
          text = escapeHtml(snippet).replace(
            new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            m => `<mark>${m}</mark>`
          );
          previewHtml = prefix + text;
        } else {
          previewHtml = escapeHtml(prefix + text);
        }
      }

      return `
        <div class="chat-item ${c.id === state.activeId ? 'active' : ''}" data-id="${c.id}">
          <div class="avatar">
            ${c.name ? initials(c.name) : '?'}
            <span class="online-dot ${c.online ? '' : 'offline'}"></span>
          </div>
          <div class="chat-item-body">
            <div class="chat-item-top">
              <div class="chat-item-name">${escapeHtml(c.name)}</div>
              <div class="chat-item-time">${last ? formatChatListTime(last.time) : ''}</div>
            </div>
            <div class="chat-item-bottom">
              <div class="chat-item-preview">${previewHtml}</div>
              ${c.unread ? `<div class="unread-badge">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    // Re-apply gradient avatars (they're set as textContent by template, so set bg)
    $$('.chat-item .avatar', list).forEach(el => {
      const item = el.closest('.chat-item');
      const c = state.conversations.find(x => x.id === item.dataset.id);
      if (c) el.style.background = gradientFor(c.name);
    });

    // Delegate clicks
    $$('.chat-item', list).forEach(item => {
      item.addEventListener('click', () => openConversation(item.dataset.id));
    });
  }

  /* ---------- Messages ---------- */
  function statusIcon(status) {
    if (status === 'sent') {
      return `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg></span>`;
    }
    if (status === 'delivered' || status === 'read') {
      const cls = status === 'read' ? 'tick read' : 'tick';
      return `<span class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m1 12 5 5L17 6"/><path d="m9 12 5 5L23 6" stroke-dasharray="0"/></svg></span>`;
    }
    return '';
  }

  function messageTemplate(m, conv) {
    const isSelf = m.sender === 'me';
    const replyMsg = m.replyTo ? conv.messages.find(x => x.id === m.replyTo) : null;

    const replyHtml = replyMsg ? `
      <div class="reply-preview" data-reply-to="${replyMsg.id}">
        <div class="reply-author">${replyMsg.sender === 'me' ? 'You' : escapeHtml(conv.name)}</div>
        <div class="reply-text">${escapeHtml(replyMsg.text)}</div>
      </div>` : '';

    const textHtml = m.deleted
      ? `<div class="bubble-text"><em>This message was deleted</em></div>`
      : `<div class="bubble-text">${escapeHtml(m.text)}</div>`;

    const meta = `
      <div class="bubble-meta">
        <span>${formatTime(m.time)}</span>
        ${isSelf && !m.deleted ? statusIcon(m.status) : ''}
      </div>`;

    return `
      <div class="message ${isSelf ? 'self' : 'other'}" data-id="${m.id}">
        ${!isSelf ? `<div class="avatar sm">${initials(conv.name)}</div>` : ''}
        <div class="bubble-wrap">
          ${replyHtml}
          <div class="bubble">
            ${textHtml}
            ${meta}
          </div>
          ${!m.deleted ? `<button class="msg-more" data-id="${m.id}" aria-label="More">⋯</button>` : ''}
        </div>
      </div>`;
  }

  function renderMessages() {
    const box = $('#messages');
    const conv = state.conversations.find(c => c.id === state.activeId);
    if (!conv) { box.innerHTML = ''; return; }

    if (!conv.messages.length) {
      box.innerHTML = `
        <div class="list-empty" style="margin:auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
          <div>No messages yet. Say hi 👋</div>
        </div>`;
      return;
    }

    let html = '';
    let lastDay = '';
    conv.messages.forEach(m => {
      const day = formatDay(m.time);
      if (day !== lastDay) {
        html += `<div class="day-divider">${day}</div>`;
        lastDay = day;
      }
      html += messageTemplate(m, conv);
    });

    box.innerHTML = html;

    // Set avatar gradients for "other" messages
    $$('.message.other .avatar', box).forEach(el => {
      el.style.background = gradientFor(conv.name);
    });

    // Delegate "more" button clicks
    $$('.msg-more', box).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        showMessageMenu(rect.left, rect.bottom, btn.dataset.id);
      });
    });

    // Delegate reply-preview clicks → scroll to original
    $$('.reply-preview', box).forEach(el => {
      el.addEventListener('click', () => {
        const targetId = el.dataset.replyTo;
        const target = box.querySelector(`.message[data-id="${targetId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.transition = 'background .4s';
          target.style.background = 'var(--accent-soft)';
          setTimeout(() => { target.style.background = ''; }, 1000);
        }
      });
    });

    scrollToBottom(false);
  }

  function scrollToBottom(smooth = true) {
    const box = $('#messages');
    if (!box) return;
    requestAnimationFrame(() => {
      box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  /* ---------- Open conversation ---------- */
  function openConversation(id) {
    const conv = state.conversations.find(c => c.id === id);
    if (!conv) return;

    state.activeId = id;
    conv.unread = 0;

    // UI
    $('#emptyState').hidden = true;
    $('#chatView').hidden = false;

    renderChatList();
    renderMessages();
    renderChatHeader(conv);
    cancelReply();
    hideTyping();

    // Close sidebar on mobile
    if (window.innerWidth <= 768) closeSidebar();

    save();
    setTimeout(() => $('#messageInput').focus(), 100);
  }

  function renderChatHeader(conv) {
    $('#chatName').textContent = conv.name;
    const statusEl = $('#chatStatus');
    const statusText = $('#chatStatusText');
    const avatarEl = $('#chatAvatar');

    avatarEl.textContent = initials(conv.name);
    avatarEl.style.background = gradientFor(conv.name);

    if (conv.online) {
      statusEl.classList.remove('offline');
      statusText.textContent = 'online';
    } else {
      statusEl.classList.add('offline');
      statusText.textContent = conv.status || 'offline';
    }
  }

  /* ---------- Send message ---------- */
  function sendMessage() {
    const input = $('#messageInput');
    const text = input.value.trim();
    if (!text) return;

    const conv = state.conversations.find(c => c.id === state.activeId);
    if (!conv) return;

    const msg = {
      id: uid(),
      text,
      time: Date.now(),
      sender: 'me',
      status: 'sent',
      replyTo: state.replyTo || null
    };
    conv.messages.push(msg);

    input.value = '';
    autoResizeInput(input);
    cancelReply();

    renderMessages();
    renderChatList();
    save();

    // Simulate status progression
    setTimeout(() => {
      if (msg.status === 'sent') { msg.status = 'delivered'; updateMessageTick(conv.id, msg.id, 'delivered'); save(); }
    }, 700);
    setTimeout(() => {
      if (msg.status === 'delivered') { msg.status = 'read'; updateMessageTick(conv.id, msg.id, 'read'); save(); }
    }, 2000);

    // Simulate the other person replying
    simulateReply(conv);
  }

  function updateMessageTick(convId, msgId, status) {
    if (state.activeId !== convId) return;
    const el = document.querySelector(`.message[data-id="${msgId}"] .tick`);
    if (!el) return;
    el.outerHTML = statusIcon(status);
  }

  /* ---------- Simulated reply ---------- */
  let replyTimers = [];
  function simulateReply(conv) {
    // Clear any pending replies for this conversation
    replyTimers.forEach(t => clearTimeout(t));
    replyTimers = [];

    const t1 = setTimeout(() => {
      if (state.activeId === conv.id) showTyping(conv);
      const t2 = setTimeout(() => {
        hideTyping();
        const replyText = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
        const msg = {
          id: uid(),
          text: replyText,
          time: Date.now(),
          sender: 'them',
          status: 'read'
        };
        conv.messages.push(msg);

        if (state.activeId !== conv.id) {
          conv.unread = (conv.unread || 0) + 1;
        }
        renderChatList();
        if (state.activeId === conv.id) {
          renderMessages();
          scrollToBottom();
        } else {
          toast(`New message from ${conv.name}`, 'info');
        }
        save();
      }, 1300 + Math.random() * 900);
      replyTimers.push(t2);
    }, 900 + Math.random() * 700);
    replyTimers.push(t1);
  }

  function showTyping(conv) {
    const bar = $('#typingBar');
    $('#typingText').textContent = `${conv.name} is typing…`;
    bar.hidden = false;
    scrollToBottom();
  }
  function hideTyping() {
    $('#typingBar').hidden = true;
  }

  /* ---------- Input ---------- */
  function autoResizeInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  /* ---------- Reply ---------- */
  function startReply(msgId) {
    const conv = state.conversations.find(c => c.id === state.activeId);
    if (!conv) return;
    const msg = conv.messages.find(m => m.id === msgId);
    if (!msg) return;

    state.replyTo = msgId;
    $('#replyBarAuthor').textContent = msg.sender === 'me' ? 'You' : conv.name;
    $('#replyBarMsg').textContent = msg.text;
    $('#replyBar').hidden = false;
    $('#messageInput').focus();
  }
  function cancelReply() {
    state.replyTo = null;
    $('#replyBar').hidden = true;
  }

  /* ---------- Delete / Copy ---------- */
  function deleteMessage(msgId) {
    const conv = state.conversations.find(c => c.id === state.activeId);
    if (!conv) return;
    const msg = conv.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.deleted = true;
    msg.text = '';
    renderMessages();
    save();
    toast('Message deleted', 'success');
  }

  async function copyMessage(msgId) {
    const conv = state.conversations.find(c => c.id === state.activeId);
    if (!conv) return;
    const msg = conv.messages.find(m => m.id === msgId);
    if (!msg) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(msg.text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = msg.text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Copied to clipboard', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  }

  /* ---------- Context menu ---------- */
  function showMessageMenu(x, y, msgId) {
    const menu = $('#contextMenu');
    menu.innerHTML = `
      <button data-act="reply">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4"/><path d="m9 5-4 4 4 4"/><path d="M21 17v-3a2 2 0 0 0-2-2h-6"/></svg>
        Reply
      </button>
      <button data-act="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy text
      </button>
      <div class="divider"></div>
      <button class="danger" data-act="delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
        Delete
      </button>`;
    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';

    const handler = (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'reply') startReply(msgId);
      else if (act === 'copy') copyMessage(msgId);
      else if (act === 'delete') deleteMessage(msgId);
      hideContextMenu();
    };
    menu.addEventListener('click', handler);
    setTimeout(() => document.addEventListener('click', outsideClose), 0);

    function outsideClose(e) {
      if (!menu.contains(e.target)) {
        hideContextMenu();
        document.removeEventListener('click', outsideClose);
      }
    }
  }
  function hideContextMenu() {
    $('#contextMenu').hidden = true;
  }

  /* ---------- Emoji picker ---------- */
  function buildEmojiPicker() {
    const p = $('#emojiPicker');
    p.innerHTML = EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
    p.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-emoji]');
      if (!btn) return;
      const input = $('#messageInput');
      const emoji = btn.dataset.emoji;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
      autoResizeInput(input);
    });
  }

  function toggleEmojiPicker(anchorBtn) {
    const p = $('#emojiPicker');
    if (!p.hidden) { p.hidden = true; return; }
    const rect = anchorBtn.getBoundingClientRect();
    const pRect = p.getBoundingClientRect();
    const pw = pRect.width || 300;
    let left = rect.left;
    let top = rect.top - 330;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = rect.bottom + 10;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.hidden = false;

    setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
    function closeOnOutside(e) {
      if (!p.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
        p.hidden = true;
        document.removeEventListener('click', closeOnOutside);
      }
    }
  }

  /* ---------- Sidebar (mobile) ---------- */
  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#backdrop').classList.add('show');
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#backdrop').classList.remove('show');
  }

  /* ---------- Modals ---------- */
  function openModal(html) {
    const overlay = $('#modalOverlay');
    $('#modal').innerHTML = html;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
  }
  function closeModal() {
    const overlay = $('#modalOverlay');
    overlay.classList.remove('show');
    setTimeout(() => { overlay.hidden = true; }, 250);
  }

  /* New chat modal */
  function openNewChatModal() {
    const existingNames = new Set(state.conversations.map(c => c.name.toLowerCase()));
    const contacts = state.contacts.filter(c => !existingNames.has(c.name.toLowerCase()));

    openModal(`
      <div class="modal-head">
        <div>
          <h3>New chat</h3>
          <p>Pick a contact to start chatting</p>
        </div>
        <button class="modal-close" id="modalClose">✕</button>
      </div>
      <div class="field">
        <input type="search" id="contactSearch" placeholder="Search contacts…" autocomplete="off" />
      </div>
      <div class="contact-list" id="contactList"></div>
    `);

    const renderContacts = (q = '') => {
      const list = $('#contactList');
      const filtered = contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
      if (!filtered.length) {
        list.innerHTML = `<div class="list-empty" style="padding:24px 12px">No contacts found</div>`;
        return;
      }
      list.innerHTML = filtered.map(c => `
        <div class="contact-item" data-id="${c.id}" data-name="${escapeHtml(c.name)}">
          <div class="avatar md" style="background:${gradientFor(c.name)}">${initials(c.name)}</div>
          <div class="contact-info">
            <div class="contact-name">${escapeHtml(c.name)}</div>
            <div class="contact-status">${escapeHtml(c.status)}</div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--text-3)"><path d="m9 18 6-6-6-6"/></svg>
        </div>`).join('');

      list.querySelectorAll('.contact-item').forEach(el => {
        el.addEventListener('click', () => {
          startNewChat(el.dataset.name, el.dataset.id);
        });
      });
    };

    renderContacts();
    $('#contactSearch').addEventListener('input', (e) => renderContacts(e.target.value));
    setTimeout(() => $('#contactSearch').focus(), 100);

    $('#modalClose').addEventListener('click', closeModal);
  }

  function startNewChat(name, contactId) {
    // Check if conversation already exists
    let conv = state.conversations.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!conv) {
      conv = {
        id: 'c' + uid(),
        name,
        status: 'online',
        online: true,
        unread: 0,
        messages: []
      };
      state.conversations.unshift(conv);
    }
    closeModal();
    renderChatList();
    openConversation(conv.id);
    toast(`Chat with ${name} opened`, 'success');
  }

  /* Profile modal */
  function openProfileModal() {
    const u = state.user;
    const statuses = [
      { key: 'online', label: 'Available', cls: 'online' },
      { key: 'away', label: 'Away', cls: 'away' },
      { key: 'busy', label: 'Busy', cls: 'busy' },
      { key: 'offline', label: 'Invisible', cls: 'offline' }
    ];

    openModal(`
      <div class="modal-head">
        <div>
          <h3>Profile &amp; settings</h3>
          <p>Manage how you appear on Pulse</p>
        </div>
        <button class="modal-close" id="modalClose">✕</button>
      </div>

      <div class="avatar-editor">
        <div class="avatar" id="editAvatar" style="background:${u.avatar ? 'transparent' : gradientFor(u.name)}">
          ${u.avatar ? `<img src="${u.avatar}" alt="" />` : initials(u.name)}
        </div>
        <div class="avatar-editor-actions">
          <button id="uploadAvatar">Upload photo</button>
          ${u.avatar ? '<button id="removeAvatar" class="danger">Remove photo</button>' : ''}
        </div>
      </div>

      <div class="field">
        <label for="editName">Display name</label>
        <input type="text" id="editName" value="${escapeHtml(u.name)}" maxlength="40" />
      </div>

      <div class="field">
        <label>Status</label>
        <div class="status-options" id="statusOptions">
          ${statuses.map(s => `
            <button class="status-opt ${u.statusType === s.key ? 'active' : ''}" data-status="${s.key}" data-label="${s.label}">
              ${s.label}
            </button>`).join('')}
        </div>
      </div>

      <div style="margin-top:6px">
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Notifications</div>
            <div class="toggle-sub">Show alerts for new messages</div>
          </div>
          <div class="switch ${u.notifications ? 'on' : ''}" id="notifToggle"></div>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Dark mode</div>
            <div class="toggle-sub">Switch between light and dark</div>
          </div>
          <div class="switch ${state.theme === 'dark' ? 'on' : ''}" id="themeSwitch"></div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" id="saveProfile" style="flex:1;padding:12px">Save changes</button>
      </div>
    `);

    $('#modalClose').addEventListener('click', closeModal);

    // Avatar upload
    let pendingAvatar = u.avatar;
    $('#uploadAvatar').addEventListener('click', () => $('#fileInput').click());
    const removeBtn = $('#removeAvatar');
    if (removeBtn) removeBtn.addEventListener('click', () => {
      pendingAvatar = null;
      const av = $('#editAvatar');
      av.innerHTML = initials(u.name);
      av.style.background = gradientFor(u.name);
      removeBtn.remove();
    });

    // Status selection
    let pendingStatus = u.statusType;
    $('#statusOptions').addEventListener('click', (e) => {
      const btn = e.target.closest('.status-opt');
      if (!btn) return;
      $$('.status-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pendingStatus = btn.dataset.status;
    });

    // Toggles
    let pendingNotif = u.notifications;
    $('#notifToggle').addEventListener('click', (e) => {
      pendingNotif = !pendingNotif;
      e.currentTarget.classList.toggle('on', pendingNotif);
    });
    $('#themeSwitch').addEventListener('click', (e) => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      e.currentTarget.classList.toggle('on', state.theme === 'dark');
      save();
    });

    // Save
    $('#saveProfile').addEventListener('click', () => {
      const newName = $('#editName').value.trim() || 'You';
      state.user.name = newName;
      state.user.avatar = pendingAvatar;
      state.user.notifications = pendingNotif;
      state.user.statusType = pendingStatus;
      const lbl = { online: 'Available', away: 'Away', busy: 'Busy', offline: 'Invisible' };
      state.user.status = lbl[pendingStatus] || 'Available';

      renderProfile();
      save();
      closeModal();
      toast('Profile updated', 'success');
    });
  }

  // File input handling (once)
  function setupFileInput() {
    $('#fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast('Only image files are supported', 'error');
        e.target.value = '';
        return;
      }
      if (file.size > 1.5 * 1024 * 1024) {
        toast('Image too large (max 1.5MB)', 'error');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.user.avatar = ev.target.result;
        const av = $('#editAvatar');
        if (av) {
          av.innerHTML = `<img src="${ev.target.result}" alt="" />`;
          av.style.background = 'transparent';
        }
        renderProfile();
        save();
        toast('Photo updated', 'success');
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
  }

  /* ---------- Profile (sidebar) ---------- */
  function renderProfile() {
    const u = state.user;
    const av = $('#myAvatar');
    if (u.avatar) {
      av.innerHTML = `<img src="${u.avatar}" alt="" />`;
      av.style.background = 'transparent';
    } else {
      av.textContent = initials(u.name);
      av.style.background = gradientFor(u.name);
    }
    $('#myName').textContent = u.name;
    const statusEl = $('#myStatus');
    statusEl.textContent = u.status;
    statusEl.className = 'profile-status ' + (u.statusType || 'online');
  }

  /* ---------- Attach button ---------- */
  function handleAttach() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const conv = state.conversations.find(c => c.id === state.activeId);
      if (!conv) return;
      const msg = {
        id: uid(),
        text: `📎 ${f.name}`,
        time: Date.now(),
        sender: 'me',
        status: 'sent',
        replyTo: null,
        attachment: true
      };
      conv.messages.push(msg);
      renderMessages();
      renderChatList();
      save();
      toast(`Attached: ${f.name}`, 'success');
      setTimeout(() => { msg.status = 'delivered'; updateMessageTick(conv.id, msg.id, 'delivered'); save(); }, 700);
      setTimeout(() => { msg.status = 'read'; updateMessageTick(conv.id, msg.id, 'read'); save(); }, 1800);
    };
    input.click();
  }

  /* ---------- Event bindings ---------- */
  function bindEvents() {
    // Theme
    $('#themeToggle').addEventListener('click', toggleTheme);

    // Search
    const searchInput = $('#searchInput');
    searchInput.addEventListener('input', () => {
      $('#clearSearch').hidden = !searchInput.value;
      renderChatList();
    });
    $('#clearSearch').addEventListener('click', () => {
      searchInput.value = '';
      $('#clearSearch').hidden = true;
      renderChatList();
      searchInput.focus();
    });

    // New chat
    $('#newChatBtn').addEventListener('click', openNewChatModal);
    $('#startChatEmpty').addEventListener('click', openNewChatModal);

    // Profile
    $('#profileBtn').addEventListener('click', openProfileModal);

    // Back / menu
    $('#backBtn').addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        openSidebar();
      } else {
        $('#chatView').hidden = true;
        $('#emptyState').hidden = false;
        state.activeId = null;
        save();
      }
    });
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#menuBtnEmpty').addEventListener('click', openSidebar);

    // Backdrop
    $('#backdrop').addEventListener('click', () => {
      closeSidebar();
      $('#emojiPicker').hidden = true;
      hideContextMenu();
    });

    // Modal close on backdrop click
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeModal();
    });

    // Composer
    const input = $('#messageInput');
    input.addEventListener('input', () => autoResizeInput(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    $('#sendBtn').addEventListener('click', sendMessage);
    $('#attachBtn').addEventListener('click', handleAttach);

    // Emoji
    $('#emojiBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEmojiPicker(e.currentTarget);
    });

    // Cancel reply
    $('#cancelReply').addEventListener('click', cancelReply);

    // Chat header actions
    $('#chatSearchBtn').addEventListener('click', () => {
      toast('Search-in-chat: use the main search bar', 'info');
      $('#searchInput').focus();
    });
    $('#chatMoreBtn').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const conv = state.conversations.find(c => c.id === state.activeId);
      if (!conv) return;
      showChatMenu(rect.left - 140, rect.bottom + 6, conv);
    });

    // Global keyboard: Escape closes overlays
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeSidebar();
        $('#emojiPicker').hidden = true;
        hideContextMenu();
      }
    });

    // Window resize: close mobile sidebar when going to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeSidebar();
    });

    // Close context menu on scroll
    $('#messages').addEventListener('scroll', hideContextMenu, { passive: true });
  }

  /* Chat header "more" menu */
  function showChatMenu(x, y, conv) {
    const menu = $('#contextMenu');
    menu.innerHTML = `
      <button data-act="markread">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m1 12 5 5L17 6"/><path d="m9 12 5 5L23 6"/></svg>
        Mark as read
      </button>
      <button data-act="mute">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6M17 9l6 6"/></svg>
        Mute notifications
      </button>
      <div class="divider"></div>
      <button class="danger" data-act="clear">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        Clear messages
      </button>`;
    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';

    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'markread') {
        conv.unread = 0; renderChatList(); save();
        toast('Marked as read', 'success');
      } else if (act === 'mute') {
        toast('Notifications muted for ' + conv.name, 'success');
      } else if (act === 'clear') {
        if (confirm('Clear all messages in this chat?')) {
          conv.messages = [];
          renderMessages(); renderChatList(); save();
          toast('Chat cleared', 'success');
        }
      }
      hideContextMenu();
    });

    setTimeout(() => document.addEventListener('click', closeHandler), 0);
    function closeHandler(e) {
      if (!menu.contains(e.target)) {
        hideContextMenu();
        document.removeEventListener('click', closeHandler);
      }
    }
  }

  /* ---------- Init ---------- */
  function init() {
    const saved = load();
    state = saved || seedData();
    // Make sure essential props exist (forward-compatibility)
    state.theme = state.theme || 'dark';
    state.user = state.user || { name: 'You', status: 'Available', statusType: 'online', avatar: null, notifications: true };
    state.conversations = state.conversations || [];
    state.contacts = state.contacts || [];
    state.replyTo = null;

    applyTheme();
    renderProfile();
    renderChatList();
    buildEmojiPicker();
    setupFileInput();
    bindEvents();

    // Auto-open most recent conversation on desktop, or the previously active one
    const initialId = state.activeId && state.conversations.find(c => c.id === state.activeId)
      ? state.activeId
      : (state.conversations[0] ? state.conversations[0].id : null);

    if (initialId && window.innerWidth > 768) {
      openConversation(initialId);
    } else {
      $('#chatView').hidden = true;
      $('#emptyState').hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();