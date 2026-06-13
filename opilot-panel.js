// =====================================================
// Opilot Panel — 悬浮 AI Copilot 面板
// 加载方式: <iframe src="https://ai.oscarstudio.cn/opilot-panel.html">
// 通信: window.parent.postMessage  ←→  宿主页
// =====================================================

(function () {
  'use strict';

  // ============ 配置 ============
  const API_BASE = 'https://api.oscarstudio.cn/api/opilot';
  const TOOLS_CONFIG_URLS = {
    tools: 'https://tools.oscarstudio.cn/tools-config.json',
    games: 'https://games.oscarstudio.cn/tools-config.json',
    ppt:   'https://ppt.oscarstudio.cn/tools-config.json'
  };
  const SITE_ORIGINS = {
    tools: 'https://tools.oscarstudio.cn',
    games: 'https://games.oscarstudio.cn',
    ppt:   'https://ppt.oscarstudio.cn'
  };
  const STORAGE_RECT = 'opilot_panel_rect'; // (位置持久化已搬到父窗口，保留以防其他引用)
  const MIN_W = 320, MIN_H = 400;

  // ============ DOM ============
  const panel        = document.getElementById('opilotPanel');
  const header       = document.getElementById('panelHeader');
  const resizeHandle = document.getElementById('resizeHandle');
  const body         = document.getElementById('panelBody');
  const messagesScroll = document.getElementById('messagesScroll');
  const welcomeScreen  = document.getElementById('welcomeScreen');
  const input        = document.getElementById('panelInput');
  const sendBtn      = document.getElementById('sendBtn');
  const closeBtn     = document.getElementById('closeBtn');
  const minimizeBtn  = document.getElementById('minimizeBtn');
  const newChatBtn   = document.getElementById('newChatBtn');
  const modelLabel   = document.getElementById('modelLabel');

  // ============ 工具集缓存 ============
  let toolsCache = { tools: [], games: [], ppt: [] };
  async function loadTools() {
    const results = await Promise.all(Object.entries(TOOLS_CONFIG_URLS).map(async ([site, url]) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!resp.ok) return [site, []];
        const data = await resp.json();
        return [site, data.tools || []];
      } catch (e) {
        return [site, []];
      }
    }));
    results.forEach(([site, list]) => toolsCache[site] = list);
  }
  loadTools();

  function getAllTools() {
    return [
      ...toolsCache.tools.map(t => ({ ...t, _site: 'tools' })),
      ...toolsCache.games.map(t => ({ ...t, _site: 'games' })),
      ...toolsCache.ppt.map(t => ({ ...t, _site: 'ppt' }))
    ];
  }

  // ============ 拖动 / 缩放 ============
  // document.domain = 'oscarstudio.cn' 让 iframe 与父页面同源，
  // 所以 window.frameElement 正常返回 iframe 元素，可以直接读写它的 style。
  // 不再需要 postMessage 同步位置，零异步、零抖动、零 race condition。
  const frameEl = window.frameElement;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function clampPos(left, top, w, h) {
    if (!frameEl) return { left, top };
    const maxLeft = Math.max(0, window.parent.innerWidth  - Math.min(w, window.parent.innerWidth));
    const maxTop  = Math.max(0, window.parent.innerHeight - Math.min(h, window.parent.innerHeight));
    return {
      left: clamp(left, 24, maxLeft - 24),
      top:  clamp(top,  24, maxTop  - 24)
    };
  }
  function readPos() {
    if (!frameEl) return { left: 0, top: 0, w: 480, h: 600 };
    return {
      left: parseInt(frameEl.style.left) || 0,
      top:  parseInt(frameEl.style.top)  || 0,
      w:    frameEl.offsetWidth  || 480,
      h:    frameEl.offsetHeight || 600
    };
  }
  function writePos(left, top) {
    if (!frameEl) return;
    const p = readPos();
    const c = clampPos(left, top, p.w, p.h);
    frameEl.style.left = c.left + 'px';
    frameEl.style.top  = c.top  + 'px';
  }
  function writeSize(w, h) {
    if (!frameEl) return;
    const p = readPos();
    const newW = clamp(w, 320, window.parent.innerWidth  * 0.95);
    const newH = clamp(h, 400, window.parent.innerHeight * 0.95);
    const c = clampPos(p.left, p.top, newW, newH);
    frameEl.style.width  = newW + 'px';
    frameEl.style.height = newH + 'px';
    frameEl.style.left   = c.left + 'px';
    frameEl.style.top    = c.top  + 'px';
  }
  function saveRect() {
    if (!frameEl || !window.parent.Opilot) return;
    // 通过 Opilot 公共 API 触发父窗口保存
    try { window.parent.dispatchEvent(new CustomEvent('opilot-panel-save-rect')); } catch (e) {}
  }

  // 拖动 header
  function makeDraggable(handle) {
    let dragging = false;
    let lastX = 0, lastY = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.opilot-panel-btn')) return;
      if (e.target.closest('.opilot-panel-resize')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      lastX = e.clientX; lastY = e.clientY;
      dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const p = readPos();
      writePos(p.left + dx, p.top + dy);
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      saveRect();
    }
    handle.addEventListener('pointermove', onMove, true);
    handle.addEventListener('pointerup', onUp, true);
    handle.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', () => { dragging = false; });
  }

  // 缩放 resize handle
  function makeResizable(handle) {
    let resizing = false;
    let lastX = 0, lastY = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      lastX = e.clientX; lastY = e.clientY;
      resizing = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    function onMove(e) {
      if (!resizing) return;
      const dw = e.clientX - lastX;
      const dh = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const p = readPos();
      writeSize(p.w + dw, p.h + dh);
    }
    function onUp(e) {
      if (!resizing) return;
      resizing = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      saveRect();
    }
    handle.addEventListener('pointermove', onMove, true);
    handle.addEventListener('pointerup', onUp, true);
    handle.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', () => { resizing = false; });
  }

  // ============ 位置持久化 ============
  // 持久化逻辑搬到父窗口（它能拿到 iframe 实际屏幕位置）。
  // 这里只剩 applyRect() 用于初始渲染占位（实际位置由父窗口 iframe style 决定）。
  function applyRect() {
    // 不再在 iframe 内设置 left/top —— 父窗口会用 localStorage 的值定位 iframe
    // iframe 内部 panel 仍保持 flex 右下对齐，作为视觉兜底
    panel.style.position = 'relative';
    panel.style.width = '100%';
    panel.style.height = '100%';
  }

  // ============ 消息渲染 ============
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderMessage(role, html) {
    if (welcomeScreen) welcomeScreen.remove();
    const div = document.createElement('div');
    div.className = 'opilot-msg ' + role;
    const avatar = document.createElement('div');
    avatar.className = 'opilot-msg-avatar';
    avatar.textContent = role === 'user' ? '我' : '✨';
    const body = document.createElement('div');
    body.className = 'opilot-msg-body';
    body.innerHTML = html;
    div.appendChild(avatar);
    div.appendChild(body);
    messagesScroll.appendChild(div);
    scrollToBottom();
    return { div, body };
  }

  function renderToolsBlock(tools, opts) {
    opts = opts || {};
    const site = opts.site || (window.parent && window.parent !== window ? null : null);
    let html = `<div class="opilot-tools-block"><div class="opilot-tools-block-label">${escapeHtml(opts.label || '推荐工具')}</div>`;
    tools.forEach(t => {
      const conf = (t.confidence != null) ? `<span class="opilot-panel-tool-conf">${Math.round(t.confidence * 100)}%</span>` : '';
      const reason = t.reason ? `<div class="opilot-panel-tool-reason">${escapeHtml(t.reason)}</div>` : '';
      html += `
        <div class="opilot-panel-tool-card" data-tool="${escapeHtml(t.name)}" data-site="${escapeHtml(t._site || '')}">
          <span class="opilot-panel-tool-icon">${escapeHtml(t.icon || '📄')}</span>
          <div class="opilot-panel-tool-info">
            <div class="opilot-panel-tool-name">${escapeHtml(t.name)}${conf}</div>
            ${reason}
          </div>
        </div>
      `;
    });
    html += `</div>`;
    return html;
  }

  function scrollToBottom() {
    body.scrollTop = body.scrollHeight;
  }

  // ============ 工具启动 ============
  function bindToolCardClicks() {
    messagesScroll.querySelectorAll('.opilot-panel-tool-card').forEach(card => {
      card.addEventListener('click', () => {
        const toolName = card.dataset.tool;
        const site = card.dataset.site;
        launchTool(site, toolName, {});
      });
    });
    messagesScroll.querySelectorAll('.opilot-panel-launch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const toolName = btn.dataset.tool;
        const site = btn.dataset.site;
        let prefill = {};
        try { prefill = JSON.parse(btn.dataset.prefill || '{}'); } catch {}
        launchTool(site, toolName, prefill);
      });
    });
  }

  async function launchTool(site, toolName, prefill) {
    if (!site || !toolName) {
      const tool = getAllTools().find(t => t.name === toolName);
      if (tool) site = tool._site;
    }
    if (!site) return;
    try {
      const resp = await fetch(API_BASE + '/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, toolName, prefill })
      });
      const data = await resp.json();
      if (data.success && data.url) {
        // 跳出 iframe，在父窗口跳转
        try { window.top.location.href = data.url; } catch (e) { window.location.href = data.url; }
      }
    } catch (e) {}
  }

  // ============ 工具启动按钮（推荐 top tool 的预填）============
  function renderLaunchButton(tool, prefill) {
    const prefillJson = JSON.stringify(prefill || {});
    return `<button class="opilot-panel-launch-btn" data-tool="${escapeHtml(tool.name)}" data-site="${escapeHtml(tool._site || '')}" data-prefill='${escapeHtml(prefillJson)}'>🚀 启动并预填</button>`;
  }

  // ============ API 调用 ============
  async function callSearch(query) {
    const allTools = getAllTools().map(t => ({
      name: t.name, description: t.description, tags: t.tags, subject: t.subject, prefill: t.prefill
    }));
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(API_BASE + '/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, tools: allTools }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return await resp.json();
    } catch (e) {
      clearTimeout(tid);
      return { success: false, _degraded: true, message: e.message };
    }
  }

  async function callChat(query, onDelta, onUsage) {
    const token = localStorage.getItem('ai_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30000);
    try {
      const resp = await fetch(API_BASE + '/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: query }],
          stream: true
        }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, message: err.message || `HTTP ${resp.status}` };
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r\n|\r|\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data') || line.startsWith('data:')) {
            const s = line.slice(line.charAt(5) === ' ' ? 6 : 5).trim();
            if (!s || s === '[DONE]') continue;
            try {
              const d = JSON.parse(s);
              const delta = d.choices?.[0]?.delta;
              if (delta?.content) {
                full += delta.content;
                if (onDelta) onDelta(delta.content, full);
              }
              if (d._type === 'usage' && onUsage) onUsage(d);
            } catch (e) {}
          }
        }
      }
      return { ok: true, full };
    } catch (e) {
      clearTimeout(tid);
      return { ok: false, message: e.message };
    }
  }

  // ============ Markdown 渲染（轻量版）============
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 换行
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ============ 主流程：发送消息 ============
  let isGenerating = false;
  async function sendMessage(text) {
    if (isGenerating) return;
    const q = (text || '').trim() || input.value.trim();
    if (!q) return;
    input.value = '';
    input.style.height = 'auto';
    isGenerating = true;
    sendBtn.disabled = true;

    // 1. 渲染用户消息
    renderMessage('user', escapeHtml(q));

    // 2. 并行：先做工具搜索（快） + 准备 chat 占位
    const allTools = getAllTools();
    const searchPromise = callSearch(q);
    const aiDiv = renderMessage('assistant', '<span class="opilot-msg-typing"></span><span class="opilot-msg-typing"></span><span class="opilot-msg-typing"></span>');
    let aiTextAccumulated = '';

    // 3. 等搜索结果，决定先渲染工具还是直接走 chat
    const searchResult = await searchPromise;

    if (searchResult && searchResult.success) {
      // 清空占位
      aiDiv.body.innerHTML = '';

      // 降级 toast
      if (searchResult._fallback) {
        if (modelLabel) modelLabel.textContent = 'Opilot · 备用模型';
        // 顶部 toast（用 parent 调用主站 toast 模式，或自己弹一个）
        showFallbackBadge();
      } else {
        if (modelLabel) modelLabel.textContent = 'Opilot · 免费';
      }

      // 渲染回复
      const reply = searchResult.reply || '';
      const intent = searchResult.intent || 'chat';
      const aiPrefill = (searchResult.prefill && typeof searchResult.prefill === 'object') ? searchResult.prefill : {};
      const tools = (searchResult.tools || []).map(t => {
        const local = allTools.find(x => x.name === t.name);
        return local ? { ...local, ...t, _site: local._site } : { ...t, _site: t._site || null };
      }).filter(t => t._site);

      let html = '';
      if (reply) html += `<div>${renderMarkdown(reply)}</div>`;

      if (intent === 'launch' && tools.length) {
        html += renderToolsBlock(tools, { label: '推荐' });
        // 用 AI 返回的具体 prefill 值（如 {"equation": "H2+O2"}），
        // 而不是 tools-config.json 里的 prefill schema（如 {params, description}）
        const topName = tools[0] && tools[0].name;
        if (topName && aiPrefill && Object.keys(aiPrefill).length) {
          html += renderLaunchButton({ name: topName, _site: tools[0]._site }, aiPrefill);
        }
      } else if (intent === 'search' && tools.length) {
        html += renderToolsBlock(tools, { label: '相关工具' });
      } else if (intent === 'chat' && tools.length) {
        // 兜底：如果 AI 误判 chat，但有关键词匹配，仍然给推荐
        html += renderToolsBlock(tools, { label: '或许你想用' });
      }

      aiDiv.body.innerHTML = html || '<div>暂无结果</div>';
      bindToolCardClicks();
    } else if (searchResult && searchResult._degraded) {
      // AI 不可用 → 退化为关键词搜索
      aiDiv.body.innerHTML = '';
      const lower = q.toLowerCase();
      const matched = allTools.filter(t =>
        (t.name && t.name.toLowerCase().includes(lower)) ||
        (t.description && t.description.toLowerCase().includes(lower)) ||
        (t.tags && t.tags.some(tag => String(tag).toLowerCase().includes(lower)))
      );
      if (matched.length) {
        aiDiv.body.innerHTML = '<div style="color:#94a3b8;margin-bottom:8px;">Opilot 暂不可用，基于关键词为你找到：</div>' + renderToolsBlock(matched, { label: '匹配结果' });
        bindToolCardClicks();
      } else {
        aiDiv.body.innerHTML = '<div style="color:#94a3b8;">Opilot 暂不可用，且未找到匹配工具。请尝试其他关键词。</div>';
      }
    } else {
      aiDiv.body.innerHTML = '<div>出错了，请稍后再试</div>';
    }

    isGenerating = false;
    sendBtn.disabled = false;
    input.focus();
  }

  function showFallbackBadge() {
    // 简单的提示：更新 model label
    if (modelLabel) {
      modelLabel.innerHTML = '<span style="color:#fbbf24">⚡ 备用模型</span>';
    }
  }

  // ============ 事件绑定 ============
  function bindEvents() {
    // 拖动 + 缩放
    makeDraggable(header);
    makeResizable(resizeHandle);

    // 发送
    sendBtn.addEventListener('click', () => sendMessage());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    // 自动调整高度
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // 关闭
    closeBtn.addEventListener('click', () => {
      panel.classList.add('closing');
      setTimeout(() => {
        // 通知 parent
        try { window.parent.postMessage({ type: 'opilot-close' }, '*'); } catch (e) {}
      }, 200);
    });

    // 最小化
    minimizeBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
    });

    // 新对话
    newChatBtn.addEventListener('click', () => {
      messagesScroll.innerHTML = '';
      const welcome = document.createElement('div');
      welcome.className = 'opilot-panel-welcome';
      welcome.id = 'welcomeScreen';
      welcome.innerHTML = `
        <span class="opilot-welcome-eyebrow">AI COPILOT</span>
        <h1 class="opilot-welcome-title">Ask anything.<br>Build anything.</h1>
        <div class="opilot-welcome-suggestions">
          <div class="opilot-suggestion-card" data-q="适合高中生的数学工具">📐 适合高中生的数学工具</div>
          <div class="opilot-suggestion-card" data-q="配平 H2+O2">🧪 配平 H2+O2</div>
          <div class="opilot-suggestion-card" data-q="什么是勾股定理">📜 什么是勾股定理</div>
          <div class="opilot-suggestion-card" data-q="推荐一个抽签器">🎯 推荐一个抽签器</div>
        </div>
      `;
      messagesScroll.appendChild(welcome);
      bindSuggestionCards();
    });

    // 欢迎卡
    bindSuggestionCards();

    // 监听父窗口 resize
    window.addEventListener('resize', () => {
      const rect = panel.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        panel.style.left = Math.max(0, window.innerWidth - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        panel.style.top = Math.max(0, window.innerHeight - rect.height) + 'px';
      }
    });
  }

  function bindSuggestionCards() {
    const suggestions = document.querySelectorAll('.opilot-suggestion-card');
    suggestions.forEach(card => {
      card.addEventListener('click', () => {
        sendMessage(card.dataset.q || card.textContent.trim());
      });
    });
  }

  // ============ 初始化 ============
  applyRect();
  bindEvents();
  bindSuggestionCards();

  // 通知父窗口：iframe 已就绪（旧代码兼容保留；document.domain 模式下父窗口可
  // 直接通过 frameElement 访问本窗口，不再需要 init-rect 消息来回传位置）
  setTimeout(() => {
    try { window.parent.postMessage({ type: 'opilot-ready' }, '*'); } catch (err) {}
  }, 0);

  // 暴露给父窗口调用
  window.OpilotPanel = {
    open: () => {
      panel.classList.remove('closing', 'minimized');
    },
    close: () => closeBtn.click(),
    focus: () => input.focus(),
    send: (q) => sendMessage(q)
  };
})();
