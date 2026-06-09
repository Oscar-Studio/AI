/* =====================================================
 * Opilot — Oscar Studio 的 AI Copilot 前端模块
 * 加载方式：<script src="https://ai.oscarstudio.cn/opilot.js"></script>
 *
 * 公开 API：
 *   Opilot.enhance(searchInput, { tools, baseUrl, onKeyword })
 *   Opilot.openPalette({ sources, origin })
 *
 * 自动行为：
 *   加载到任何页面后，自动扫描 URL ?key=value 并注入到对应 input
 * ===================================================== */

(function () {
  'use strict';

  // ============ 常量 ============
  const OPILOT_API   = 'https://api.oscarstudio.cn/api/opilot';
  const DEBOUNCE_MS  = 400;
  const TOAST_MS     = 5000;
  const HISTORY_KEY  = 'opilot_history';
  const HISTORY_MAX  = 20;
  const CACHE_KEY    = 'opilot_multi_config';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  // ============ 工具函数 ============
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function now() { return Date.now(); }

  // ============ 模式检测 ============
  function shouldUseOpilot(query, keywordHitCount) {
    if (!query || query.length < 2) return false;
    if (keywordHitCount > 0 && query.length <= 4) return false;
    if (/[\u4e00-\u9fa5]/.test(query) && query.length >= 6) return true;
    if (query.split(/\s+/).filter(Boolean).length >= 3) return true;
    return false;
  }

  // ============ 历史记录 ============
  function recordHistory(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      list.unshift(Object.assign({ id: now(), at: now() }, entry));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (e) { /* 静默 */ }
  }

  function getHistory(n) {
    try {
      const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return list.slice(0, n || 5);
    } catch (e) { return []; }
  }

  // ============ Toast（B2: 弹窗告知降级）============
  let lastToastAt = 0;
  function toast(msg, opts) {
    opts = opts || {};
    // 60 秒内不重复
    if (!opts.force && (now() - lastToastAt) < 60_000) return;
    lastToastAt = now();

    let host = document.getElementById('opilot-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'opilot-toast-host';
      host.className = 'opilot-toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'opilot-toast' + (opts.type ? ' opilot-toast-' + opts.type : '');
    el.textContent = msg;
    host.appendChild(el);
    // 强制 reflow 后加 show class 触发动画
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 300);
    }, opts.duration || TOAST_MS);
  }

  // ============ 后端调用 ============
  async function callSearch(query, tools, history) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    try {
      const resp = await fetch(OPILOT_API + '/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, tools, history: history || [] }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return await resp.json();
    } catch (e) {
      clearTimeout(tid);
      return { success: false, _degraded: true, message: e.message };
    }
  }

  async function callLaunch(site, toolName, prefill) {
    try {
      const resp = await fetch(OPILOT_API + '/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, toolName, prefill: prefill || {} })
      });
      return await resp.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  // ============ 渲染：工具卡片 ============
  function renderToolCard(tool, opts) {
    opts = opts || {};
    const icon = escapeHtml(tool.icon || '📄');
    const name = escapeHtml(tool.name);
    const reason = opts.reason ? `<div class="opilot-tool-reason">${escapeHtml(opts.reason)}</div>` : '';
    const conf = (opts.confidence != null)
      ? `<span class="opilot-tool-conf">${Math.round(opts.confidence * 100)}%</span>`
      : '';
    // site：AI 推荐时通过 opts.site 传入；关键词命中时由 ctx.site 兜底
    const site = opts.site || '';
    return `
      <div class="opilot-tool-card" data-tool="${escapeHtml(tool.name)}" data-site="${escapeHtml(site)}">
        <span class="opilot-tool-icon">${icon}</span>
        <div class="opilot-tool-info">
          <div class="opilot-tool-name">${name}${conf}</div>
          ${reason}
        </div>
        <span class="opilot-tool-arrow">→</span>
      </div>
    `;
  }

  function renderHistoryItem(entry) {
    const time = new Date(entry.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="opilot-history-item" data-q="${escapeHtml(entry.q)}">
        <span class="opilot-history-icon">🕘</span>
        <span class="opilot-history-q">${escapeHtml(entry.q)}</span>
        <span class="opilot-history-time">${escapeHtml(time)}</span>
      </div>
    `;
  }

  // ============ 下拉面板 UI ============
  function createDropdown(host, ctx) {
    const searchInput = host;
    const wrapper = searchInput.closest('.search-box') || searchInput.parentElement;
    if (!wrapper) return null;

    // 容器
    let dropdown = wrapper.querySelector('.opilot-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'opilot-dropdown';
      wrapper.appendChild(dropdown);
    }

    // 状态
    let lastKeywordResults = [];
    let isLoading = false;
    let currentQuery = '';

    // 渲染
    function render() {
      const q = currentQuery.trim();
      const keywordHits = lastKeywordResults;

      // 空 query：显示历史
      if (!q) {
        const history = getHistory(5);
        dropdown.innerHTML = history.length
          ? `<div class="opilot-col opilot-col-full">
               <h4>最近搜索</h4>
               <div class="opilot-history-list">${history.map(renderHistoryItem).join('')}</div>
             </div>`
          : `<div class="opilot-col opilot-col-full opilot-empty">输入关键词或自然语言查询</div>`;
        bindHistoryClicks();
        dropdown.classList.add('open');
        return;
      }

      // 短词 + 有关键词命中：只显示关键词
      if (keywordHits.length && !shouldUseOpilot(q, keywordHits.length)) {
        dropdown.innerHTML = `
          <div class="opilot-col opilot-col-full">
            <h4>工具 (${keywordHits.length})</h4>
            <div class="opilot-tool-list">${keywordHits.map(t => renderToolCard(t)).join('')}</div>
          </div>
        `;
        bindCardClicks();
        dropdown.classList.add('open');
        return;
      }

      // 长句 / 无关键词命中：双列
      const opilotHtml = isLoading
        ? `<div class="opilot-loading">✨ Opilot 思考中...</div>`
        : (currentOpilotResult ? renderOpilotColumn(currentOpilotResult) : '');

      dropdown.innerHTML = `
        <div class="opilot-col opilot-col-keyword">
          <h4>工具 ${keywordHits.length ? `(${keywordHits.length})` : ''}</h4>
          <div class="opilot-tool-list">${keywordHits.map(t => renderToolCard(t)).join('') || '<div class="opilot-empty-mini">无关键词匹配</div>'}</div>
        </div>
        <div class="opilot-col opilot-col-ai">
          <h4>✨ Opilot</h4>
          <div class="opilot-ai-content">${opilotHtml}</div>
        </div>
      `;
      bindCardClicks();
      bindOpilotActions();
      dropdown.classList.add('open');
    }

    function renderOpilotColumn(result) {
      if (!result || !result.success) {
        if (result && result._degraded) {
          return '<div class="opilot-degraded">Opilot 暂不可用，仅显示关键词结果</div>';
        }
        return '';
      }
      const tools = result.tools || [];
      const reply = result.reply || '';
      const intent = result.intent || 'chat';
      const prefill = result.prefill || {};

      let html = '';

      if (intent === 'launch' && tools.length) {
        const top = tools[0];
        const launchBtn = `<button class="opilot-launch-btn" data-tool="${escapeHtml(top.name)}" data-prefill='${escapeHtml(JSON.stringify(prefill))}'>🚀 启动并预填</button>`;
        html += `
          <div class="opilot-section">
            <div class="opilot-section-label">推荐</div>
            <div class="opilot-tool-list">${tools.map(t => renderToolCard(t, { reason: t.reason, confidence: t.confidence, site: ctx.site })).join('')}</div>
            ${launchBtn}
          </div>
        `;
      } else if (intent === 'search' && tools.length) {
        html += `
          <div class="opilot-section">
            <div class="opilot-section-label">相关工具</div>
            <div class="opilot-tool-list">${tools.map(t => renderToolCard(t, { reason: t.reason, confidence: t.confidence, site: ctx.site })).join('')}</div>
          </div>
        `;
      } else if (intent === 'chat') {
        // AI 把它当成通用对话 — 但如果关键词列命中了工具，附加"或许你想用"建议
        if (lastKeywordResults && lastKeywordResults.length) {
          const top = lastKeywordResults[0];
          html += `
            <div class="opilot-section">
              <div class="opilot-section-label">或许你想用</div>
              <div class="opilot-tool-list">${renderToolCard(top, { reason: '基于你的查询', confidence: 0.7, site: ctx.site })}</div>
            </div>
          `;
        }
      }

      if (reply) {
        html += `<div class="opilot-reply">${escapeHtml(reply)}</div>`;
      }

      if (intent === 'chat') {
        html += `<button class="opilot-chat-btn" data-q="${escapeHtml(currentQuery)}">💬 在 AI Studio 中打开</button>`;
      }

      return html || '<div class="opilot-empty-mini">无结果</div>';
    }

    // 关键词搜索
    function runKeywordSearch(term) {
      if (ctx.onKeyword) {
        // 包装 onKeyword 让它返回结果数组（用于双列展示）
        // 简化：直接调用 onKeyword
        ctx.onKeyword(term);
      }
      // 同步本地关键词命中
      lastKeywordResults = filterTools(ctx.tools || [], term);
    }

    function filterTools(tools, term) {
      const lower = term.toLowerCase().trim();
      if (!lower) return [];
      return tools.filter(t =>
        (t.name && t.name.toLowerCase().includes(lower)) ||
        (t.description && t.description.toLowerCase().includes(lower)) ||
        (t.tags && t.tags.some(tag => String(tag).toLowerCase().includes(lower))) ||
        (t.subject && t.subject.some(s => String(s).toLowerCase().includes(lower)))
      );
    }

    // Opilot 搜索
    let currentOpilotResult = null;
    const runOpilot = debounce(async (q) => {
      if (!q || !shouldUseOpilot(q, lastKeywordResults.length)) {
        currentOpilotResult = null;
        render();
        return;
      }
      isLoading = true;
      render();
      const result = await callSearch(q, ctx.tools || [], getHistory(3));
      isLoading = false;
      currentOpilotResult = result;
      // 降级 toast
      if (result && result._fallback) {
        toast('Opilot 备用模型 · 可能消耗 credits', { type: 'warn' });
      }
      // 记录历史
      const top = (result && result.tools && result.tools[0]) || null;
      recordHistory({
        q,
        intent: result.intent || 'chat',
        toolName: top ? top.name : null,
        fallback: !!(result && result._fallback)
      });
      render();
    }, DEBOUNCE_MS);

    // 事件绑定
    function bindCardClicks() {
      dropdown.querySelectorAll('.opilot-tool-card').forEach(card => {
        // 阻止 mousedown 抢 focus
        card.addEventListener('mousedown', (e) => { e.preventDefault(); });
        card.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropdown.classList.remove('open');
          const toolName = card.dataset.tool;
          const cardSite = card.dataset.site || ctx.site;
          const tool = (ctx.tools || []).find(t => t.name === toolName);
          recordHistory({ q: currentQuery, intent: 'launch', toolName });
          if (tool) {
            // 本地工具：直接拼 URL（更快，无网络往返）
            const baseUrl = ctx.baseUrl || '';
            const path = tool.demoFile || `${tool.name}/index.html`;
            window.location.href = baseUrl + '/' + path;
          } else if (cardSite) {
            // AI 推荐的跨站工具：调 launch API
            callLaunch(cardSite, toolName, {}).then(r => {
              if (r.success && r.url) window.location.href = r.url;
              else toast(r.message || '启动失败', { type: 'error' });
            });
          }
        });
      });
    }

    function bindOpilotActions() {
      dropdown.querySelectorAll('.opilot-launch-btn').forEach(btn => {
        // 阻止 mousedown 让 button 抢 focus（否则 searchInput blur 触发，dropdown 收起）
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 立即关闭 dropdown，避免和 location.href 跳转冲突
          dropdown.classList.remove('open');
          const toolName = btn.dataset.tool;
          let prefill = {};
          try { prefill = JSON.parse(btn.dataset.prefill || '{}'); } catch {}
          const site = ctx.site || 'tools';
          const r = await callLaunch(site, toolName, prefill);
          if (r.success && r.url) {
            recordHistory({ q: currentQuery, intent: 'launch', toolName });
            window.location.href = r.url;
          } else {
            toast(r.message || '启动失败', { type: 'error' });
          }
        });
      });
      dropdown.querySelectorAll('.opilot-chat-btn').forEach(btn => {
        // 同上：阻止 mousedown 抢 focus
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropdown.classList.remove('open');
          const q = btn.dataset.q || currentQuery;
          window.open('https://ai.oscarstudio.cn/?q=' + encodeURIComponent(q), '_blank');
        });
      });
    }

    function bindHistoryClicks() {
      dropdown.querySelectorAll('.opilot-history-item').forEach(item => {
        item.addEventListener('mousedown', (e) => { e.preventDefault(); });
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          searchInput.value = item.dataset.q || '';
          currentQuery = searchInput.value;
          runKeywordSearch(currentQuery);
          runOpilot(currentQuery);
          searchInput.focus();
        });
      });
    }

    // 主输入事件
    const onInput = debounce((e) => {
      currentQuery = e.target.value;
      runKeywordSearch(currentQuery);
      runOpilot(currentQuery);
    }, 50);

    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('focus', () => {
      currentQuery = searchInput.value;
      runKeywordSearch(currentQuery);
      render();
    });
    searchInput.addEventListener('blur', () => {
      // 延迟关闭，允许点击
      setTimeout(() => dropdown.classList.remove('open'), 200);
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        searchInput.blur();
      }
    });

    return { refresh: render };
  }

  // ============ 主站命令面板 ============
  async function loadMultiConfig(sources) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (cached.ts && (now() - cached.ts) < CACHE_TTL_MS && cached.data) {
        return cached.data;
      }
    } catch (e) { /* ignore */ }

    const results = await Promise.all(sources.map(async (s) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(s.configUrl, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!resp.ok) return { site: s.site, origin: s.origin, tools: [] };
        const data = await resp.json();
        return { site: s.site, origin: s.origin, tools: data.tools || [] };
      } catch (e) {
        return { site: s.site, origin: s.origin, tools: [] };
      }
    }));

    const data = {};
    results.forEach(r => { data[r.site] = r; });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now(), data }));
    } catch (e) { /* 忽略 quota 错误 */ }
    return data;
  }

  function buildLaunchUrl(origin, tool, prefill) {
    const toolPath = tool.demoFile || `${tool.name}/index.html`;
    let url = `${origin}/${toolPath}`;
    if (prefill && Object.keys(prefill).length) {
      const params = new URLSearchParams(prefill);
      url += '?' + params.toString();
    }
    return url;
  }

  function openPalette(opts) {
    opts = opts || {};
    const sources = opts.sources || [
      { site: 'tools', origin: 'https://tools.oscarstudio.cn', configUrl: 'https://tools.oscarstudio.cn/tools-config.json' },
      { site: 'games', origin: 'https://games.oscarstudio.cn', configUrl: 'https://games.oscarstudio.cn/tools-config.json' },
      { site: 'ppt',   origin: 'https://ppt.oscarstudio.cn',   configUrl: 'https://ppt.oscarstudio.cn/tools-config.json' }
    ];

    // 移除已存在的
    const existing = document.getElementById('opilot-palette');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'opilot-palette';
    overlay.className = 'opilot-palette-overlay';
    overlay.innerHTML = `
      <div class="opilot-palette">
        <div class="opilot-palette-header">
          <input type="text" class="opilot-palette-input" placeholder="搜索工具、游戏、PPT（⌘K）" autofocus>
          <div class="opilot-palette-hint">
            <span>↑↓ 选择</span>
            <span>⏎ 打开</span>
            <span>ESC 关闭</span>
          </div>
        </div>
        <div class="opilot-palette-results"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.opilot-palette-input');
    const results = overlay.querySelector('.opilot-palette-results');
    let allTools = [];
    let activeIndex = 0;
    let currentItems = [];

    // 加载配置
    results.innerHTML = '<div class="opilot-palette-loading">加载工具中...</div>';
    loadMultiConfig(sources).then(data => {
      const sites = Object.keys(data);
      const history = getHistory(5);
      let html = '';

      if (history.length) {
        html += `<div class="opilot-palette-section"><div class="opilot-palette-eyebrow">最近</div>${
          history.map((h, i) => `
            <div class="opilot-palette-item opilot-palette-history" data-q="${escapeHtml(h.q)}">
              <span class="opilot-palette-icon">🕘</span>
              <span>${escapeHtml(h.q)}</span>
            </div>
          `).join('')
        }</div>`;
      }

      sites.forEach(site => {
        const cfg = data[site];
        if (!cfg || !cfg.tools || !cfg.tools.length) return;
        html += `<div class="opilot-palette-section">
          <div class="opilot-palette-eyebrow">${site === 'tools' ? '教学工具' : site === 'games' ? '益智游戏' : 'HTML-PPT'}</div>
          ${cfg.tools.slice(0, 8).map(t => `
            <div class="opilot-palette-item" data-site="${site}" data-name="${escapeHtml(t.name)}">
              <span class="opilot-palette-icon">${escapeHtml(t.icon || '📄')}</span>
              <span>${escapeHtml(t.name)}</span>
              <span class="opilot-palette-site">${site}</span>
            </div>
          `).join('')}
        </div>`;
        cfg.tools.forEach(t => allTools.push({ ...t, _site: site, _origin: cfg.origin }));
      });

      results.innerHTML = html || '<div class="opilot-palette-empty">暂无工具</div>';
      bindResultsEvents();
      // 输入框聚焦
      setTimeout(() => input.focus(), 50);
    });

    function renderFiltered(q) {
      const lower = q.toLowerCase().trim();
      let items = allTools;
      if (lower) {
        items = allTools.filter(t =>
          (t.name && t.name.toLowerCase().includes(lower)) ||
          (t.description && t.description.toLowerCase().includes(lower)) ||
          (t.tags && t.tags.some(tag => String(tag).toLowerCase().includes(lower)))
        );
      }
      // 按 site 分组
      const grouped = {};
      items.forEach(t => {
        if (!grouped[t._site]) grouped[t._site] = [];
        grouped[t._site].push(t);
      });
      const siteNames = { tools: '教学工具', games: '益智游戏', ppt: 'HTML-PPT' };
      let html = '';
      Object.keys(grouped).forEach(site => {
        html += `<div class="opilot-palette-section">
          <div class="opilot-palette-eyebrow">${siteNames[site] || site} (${grouped[site].length})</div>
          ${grouped[site].slice(0, 20).map((t, i) => `
            <div class="opilot-palette-item" data-site="${site}" data-name="${escapeHtml(t.name)}" data-idx="${i}">
              <span class="opilot-palette-icon">${escapeHtml(t.icon || '📄')}</span>
              <span>${escapeHtml(t.name)}</span>
              <span class="opilot-palette-site">${site}</span>
            </div>
          `).join('')}
        </div>`;
      });
      results.innerHTML = html || `<div class="opilot-palette-empty">无匹配工具 · 试试在 AI Studio 中聊：<br><em>${escapeHtml(q)}</em><br><button class="opilot-palette-chat-btn" data-q="${escapeHtml(q)}">💬 打开 AI 对话</button></div>`;
      currentItems = items;
      activeIndex = 0;
      updateActiveItem();
      bindResultsEvents();
    }

    function updateActiveItem() {
      results.querySelectorAll('.opilot-palette-item').forEach((el, i) => {
        el.classList.toggle('active', i === activeIndex);
      });
      const active = results.querySelector('.opilot-palette-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function activateItem(el) {
      if (!el) return;
      if (el.classList.contains('opilot-palette-chat-btn')) {
        const q = el.dataset.q;
        window.open('https://ai.oscarstudio.cn/?q=' + encodeURIComponent(q), '_blank');
        close();
        return;
      }
      const site = el.dataset.site;
      const name = el.dataset.name;
      if (!site || !name) return;
      const tool = allTools.find(t => t._site === site && t.name === name);
      if (!tool) return;
      // 关闭面板再跳转
      close();
      recordHistory({ q: input.value, intent: 'launch', toolName: name });
      window.location.href = buildLaunchUrl(tool._origin, tool, {});
    }

    function bindResultsEvents() {
      results.querySelectorAll('.opilot-palette-item').forEach((el, i) => {
        el.addEventListener('click', () => {
          activeIndex = i;
          activateItem(el);
        });
        el.addEventListener('mouseenter', () => {
          activeIndex = i;
          updateActiveItem();
        });
      });
    }

    // 输入事件
    const onInput = debounce((e) => renderFiltered(e.target.value), 100);
    input.addEventListener('input', onInput);

    // 键盘
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = results.querySelectorAll('.opilot-palette-item');
        if (items.length) {
          activeIndex = Math.min(activeIndex + 1, items.length - 1);
          updateActiveItem();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = results.querySelector('.opilot-palette-item.active');
        activateItem(active);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    // 点击外部关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    function close() {
      overlay.classList.add('hide');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // ============ 自动预填注入器 ============
  // 在所有 Opilot 加载的页面上自动执行
  (function autoPrefill() {
    const params = new URLSearchParams(location.search);
    if (![...params.keys()].length) return;
    const apply = () => {
      params.forEach((value, key) => {
        // 跳过内部参数
        if (key.startsWith('_')) return;
        const el = document.getElementById(key);
        if (!el) return;
        try {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          // 视觉提示
          el.classList.add('opilot-prefilled');
          setTimeout(() => el.classList.remove('opilot-prefilled'), 3000);
        } catch (e) { /* 静默 */ }
      });
      // 顶部横幅
      const params_obj = {};
      params.forEach((v, k) => { if (!k.startsWith('_')) params_obj[k] = v; });
      if (Object.keys(params_obj).length) {
        showPrefillBanner(params_obj);
      }
    };
    function showPrefillBanner(p) {
      const banner = document.createElement('div');
      banner.className = 'opilot-prefill-banner';
      const entries = Object.entries(p).map(([k, v]) => `${k} = ${v}`).join(' · ');
      banner.innerHTML = `✨ Opilot 已预填：<code>${escapeHtml(entries)}</code>`;
      document.body.appendChild(banner);
      setTimeout(() => {
        banner.classList.add('show');
        setTimeout(() => {
          banner.classList.remove('show');
          setTimeout(() => banner.remove(), 300);
        }, 4000);
      }, 100);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
  })();

  // ============ 公开 API ============
  window.Opilot = {
    enhance: createDropdown,
    openPalette: openPalette,
    toast: toast,
    recordHistory: recordHistory,
    getHistory: getHistory,
    shouldUseOpilot: shouldUseOpilot,
    version: '1.0.0'
  };

  // 全局快捷键 ⌘K / Ctrl+K（主站已显式绑定；其他站也提供）
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      // 主站按钮已显式触发；这里不重复触发避免双开
      // 留给各站点的 Opilot 触发按钮主动调用
    }
  });
})();
