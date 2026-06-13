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
        body: JSON.stringify({ site, toolName, prefill: transformPrefill(site, toolName, prefill) })
      });
      return await resp.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  // 把 AI 返回的 prefill 转成实际 input 需要的格式
  // 例子：化学方程式配平需要 {reactants, products}，但 AI 通常给 {equation: 'H2+O2 → H2O'}
  function transformPrefill(site, toolName, prefill) {
    const p = { ...(prefill || {}) };
    if (site === 'tools' && toolName === '化学方程式配平' && typeof p.equation === 'string' && (p.reactants == null || p.products == null)) {
      const m = p.equation.split(/\s*(?:→|->|=)\s*/);
      if (m.length >= 2) {
        p.reactants = m[0].trim();
        p.products  = m.slice(1).join(' ').trim();
        delete p.equation;
      }
    }
    return p;
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

    // 默认 placeholder
    searchInput.placeholder = ctx.placeholder || 'Chat with Opilot';

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
    let aiResult = null;       // 最近一次 AI 结果
    let aiSearched = false;    // 是否已主动搜索过（用于渲染模式判断）

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
          : `<div class="opilot-col opilot-col-full opilot-empty">输入关键词 · 按 <kbd>Enter</kbd> 让 Opilot 帮你找</div>`;
        bindHistoryClicks();
        dropdown.classList.add('open');
        return;
      }

      // 关键词命中：单列
      if (keywordHits.length) {
        dropdown.innerHTML = `
          <div class="opilot-col opilot-col-full">
            <h4>工具 (${keywordHits.length})</h4>
            <div class="opilot-tool-list">${keywordHits.map(t => renderToolCard(t, { site: ctx.site })).join('')}</div>
          </div>
        `;
        bindCardClicks();
        dropdown.classList.add('open');
        return;
      }

      // 无关键词命中
      dropdown.innerHTML = `<div class="opilot-col opilot-col-full opilot-empty">无关键词匹配 · 按 <kbd>Enter</kbd> 让 Opilot 帮你找</div>`;
      dropdown.classList.add('open');
    }

    // 渲染 AI 结果（按 Enter 触发后）
    function renderAIResult() {
      const q = currentQuery.trim();
      const keywordHits = lastKeywordResults;

      if (isLoading) {
        dropdown.innerHTML = `<div class="opilot-col opilot-col-full opilot-loading">✨ Opilot 思考中...</div>`;
        dropdown.classList.add('open');
        return;
      }

      if (!aiResult) {
        render();
        return;
      }

      const opilotHtml = renderOpilotColumn(aiResult);

      // 双列：左关键词 + 右 AI
      dropdown.innerHTML = `
        <div class="opilot-col opilot-col-keyword">
          <h4>工具 ${keywordHits.length ? `(${keywordHits.length})` : ''}</h4>
          <div class="opilot-tool-list">${keywordHits.map(t => renderToolCard(t, { site: ctx.site })).join('') || '<div class="opilot-empty-mini">无关键词匹配</div>'}</div>
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
      const aiTools = result.tools || [];
      const reply = result.reply || '';
      const intent = result.intent || 'chat';
      let prefill = result.prefill || {};

      let html = '';

      if (intent === 'launch' && aiTools.length) {
        const top = aiTools[0];
        const launchBtn = `<button class="opilot-launch-btn" data-tool="${escapeHtml(top.name)}" data-site="${escapeHtml(top._site || ctx.site || '')}" data-prefill='${escapeHtml(JSON.stringify(prefill))}'>🚀 启动并预填 (${escapeHtml(top.name)})</button>`;
        html += `
          <div class="opilot-section">
            <div class="opilot-section-label">推荐</div>
            <div class="opilot-tool-list">${aiTools.map(t => renderToolCard(t, { reason: t.reason, confidence: t.confidence, site: t._site || ctx.site })).join('')}</div>
            ${launchBtn}
          </div>
        `;
      } else if (intent === 'search' && aiTools.length) {
        // 探索模式：也给一个 launch 入口（top 工具的智能 prefill）
        const top = aiTools[0];
        const finalPrefill = Object.keys(prefill).length ? prefill : autoExtractPrefill(currentQuery, top);
        const launchBtn = `<button class="opilot-launch-btn" data-tool="${escapeHtml(top.name)}" data-site="${escapeHtml(top._site || ctx.site || '')}" data-prefill='${escapeHtml(JSON.stringify(finalPrefill))}'>🚀 启动并预填 (${escapeHtml(top.name)})</button>`;
        html += `
          <div class="opilot-section">
            <div class="opilot-section-label">相关工具</div>
            <div class="opilot-tool-list">${aiTools.map(t => renderToolCard(t, { reason: t.reason, confidence: t.confidence, site: t._site || ctx.site })).join('')}</div>
            ${launchBtn}
          </div>
        `;
      } else {
        // intent === 'chat' 或 tools 为空：前端兜底
        // 1. 从 reply 文本中扫描已注册的工具名
        // 2. 如果 AI 提到了具体工具，强制显示"🚀 启动并预填"按钮
        const mentioned = [];
        if (reply && ctx.tools && ctx.tools.length) {
          for (const t of ctx.tools) {
            if (reply.includes(t.name)) {
              mentioned.push({ ...t, reason: 'AI 提到此工具', confidence: 0.65 });
            }
          }
        }
        const fallback = mentioned.length ? mentioned : lastKeywordResults;
        if (fallback && fallback.length) {
          const top = fallback[0];
          // 如果 AI 没给 prefill，从 query 智能提取
          const finalPrefill = Object.keys(prefill).length ? prefill : autoExtractPrefill(currentQuery, top);
          const launchBtn = `<button class="opilot-launch-btn" data-tool="${escapeHtml(top.name)}" data-site="${escapeHtml(top._site || ctx.site || '')}" data-prefill='${escapeHtml(JSON.stringify(finalPrefill))}'>🚀 启动并预填 (${escapeHtml(top.name)})</button>`;
          const label = mentioned.length ? '或许你想用 (AI 提到)' : '或许你想用';
          html += `
            <div class="opilot-section">
              <div class="opilot-section-label">${label}</div>
              <div class="opilot-tool-list">${fallback.map(t => renderToolCard(t, { reason: t.reason, confidence: t.confidence, site: t._site || ctx.site })).join('')}</div>
              ${launchBtn}
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

    // 从 query 中按工具 prefill schema 智能提取值
    function autoExtractPrefill(query, tool) {
      const p = {};
      if (!tool || !tool.prefill || !Array.isArray(tool.prefill.params) || !query) return p;
      const params = tool.prefill.params;
      if (params.includes('sentence-input')) {
        // 提取引号 / 「」 / 『』 内的文本
        const m = query.match(/[「"'『']([^「"'』'」"]+)[」"'』'』]/);
        if (m) p['sentence-input'] = m[1];
      }
      if (params.includes('reactants') && params.includes('products')) {
        // 提取完整的"反应物 → 生成物"
        const m = query.match(/([^\s→\-=]+(?:\s*\+\s*[^\s→\-=]+)*)\s*[→\-=]+>\s*([^\s→\-=]+(?:\s*\+\s*[^\s→\-=]+)*)/);
        if (m) {
          p.reactants = m[1].trim();
          p.products = m[2].trim();
        } else {
          // 整个 query 当作 equation，让 transformPrefill 处理
          p.equation = query;
        }
      }
      return p;
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

    // Opilot 搜索（按 Enter 才触发，不再 debounce 输入事件）
    async function runOpilot() {
      const q = currentQuery.trim();
      if (!q) return;
      isLoading = true;
      aiSearched = true;
      renderAIResult();
      const result = await callSearch(q, ctx.tools || [], getHistory(3));
      isLoading = false;
      aiResult = result;
      // 降级 toast
      if (result && result._fallback) {
        toast('Opilot 备用模型 · 可能消耗 credits', { type: 'warn' });
      }
      // 记录历史
      if (result && result.success) {
        const top = (result.tools && result.tools[0]) || null;
        recordHistory({
          q,
          intent: result.intent || 'chat',
          toolName: top ? top.name : null,
          fallback: !!(result && result._fallback)
        });
      }
      renderAIResult();
    }

    // 事件绑定
    function bindCardClicks() {
      dropdown.querySelectorAll('.opilot-tool-card').forEach(card => {
        // 阻止 mousedown 抢 focus
        card.addEventListener('mousedown', (e) => { e.preventDefault(); });
        card.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 注意：不收起 dropdown，input 也不 blur，让用户能继续操作
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
          const toolName = btn.dataset.tool;
          const site = btn.dataset.site || ctx.site || 'tools';
          let prefill = {};
          try { prefill = JSON.parse(btn.dataset.prefill || '{}'); } catch {}
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
          aiSearched = false;
          aiResult = null;
          render();
          searchInput.focus();
        });
      });
    }

    // 主输入事件 —— 只做关键词过滤（不再实时调 AI）
    const onInput = debounce((e) => {
      currentQuery = e.target.value;
      runKeywordSearch(currentQuery);
      // 用户重新输入时，清空旧 AI 结果
      if (aiSearched) {
        aiSearched = false;
        aiResult = null;
      }
      render();
    }, 50);

    searchInput.addEventListener('input', onInput);
    searchInput.addEventListener('focus', () => {
      currentQuery = searchInput.value;
      runKeywordSearch(currentQuery);
      if (aiSearched) {
        renderAIResult();
      } else {
        render();
      }
    });
    searchInput.addEventListener('blur', () => {
      // 延迟关闭，允许点击
      setTimeout(() => dropdown.classList.remove('open'), 200);
    });

    // Enter 触发 AI 搜索
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runOpilot();
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('open');
        searchInput.blur();
      }
    });

    return { refresh: render, runOpilot };
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

    // 移除已存在
    const existing = document.getElementById('opilot-palette');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'opilot-palette';
    overlay.className = 'opilot-palette-overlay';
    overlay.innerHTML = `
      <div class="opilot-palette">
        <div class="opilot-palette-header">
          <input type="text" class="opilot-palette-input" placeholder="Chat with Opilot" autofocus>
          <div class="opilot-palette-hint">
            <span>⏎ 发送</span>
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
    let lastMode = 'home'; // 'home' | 'keyword' | 'ai'

    // 加载多源工具配置
    results.innerHTML = '<div class="opilot-palette-loading">加载工具中...</div>';
    loadMultiConfig(sources).then(data => {
      Object.values(data).forEach(cfg => {
        if (cfg && cfg.tools) {
          cfg.tools.forEach(t => allTools.push({ ...t, _site: cfg.site, _origin: cfg.origin }));
        }
      });
      renderHome();
    });

    // ============ 渲染：首页（历史 + 工具分类）============
    function renderHome() {
      lastMode = 'home';
      const history = getHistory(5);
      const siteNames = { tools: '教学工具', games: '益智游戏', ppt: 'HTML-PPT' };
      const grouped = {};
      allTools.forEach(t => {
        if (!grouped[t._site]) grouped[t._site] = [];
        grouped[t._site].push(t);
      });

      let html = '';
      if (history.length) {
        html += `<div class="opilot-palette-section"><div class="opilot-palette-eyebrow">最近</div>${
          history.map((h, i) => `
            <div class="opilot-palette-item opilot-palette-history" data-q="${escapeHtml(h.q)}" data-idx="${i}">
              <span class="opilot-palette-icon">🕘</span>
              <span class="opilot-palette-item-name">${escapeHtml(h.q)}</span>
            </div>
          `).join('')
        }</div>`;
      }
      Object.keys(grouped).forEach(site => {
        html += `<div class="opilot-palette-section">
          <div class="opilot-palette-eyebrow">${siteNames[site] || site} (${grouped[site].length})</div>
          ${grouped[site].slice(0, 8).map((t, i) => `
            <div class="opilot-palette-item" data-site="${site}" data-name="${escapeHtml(t.name)}" data-idx="${i}">
              <span class="opilot-palette-icon">${escapeHtml(t.icon || '📄')}</span>
              <span class="opilot-palette-item-name">${escapeHtml(t.name)}</span>
              <span class="opilot-palette-site">${site}</span>
            </div>
          `).join('')}
        </div>`;
      });
      results.innerHTML = html || '<div class="opilot-palette-empty">暂无工具</div>';
      currentItems = Array.from(results.querySelectorAll('.opilot-palette-item'));
      activeIndex = 0;
      updateActiveItem();
      bindResultsEvents();
    }

    // ============ 渲染：关键词过滤结果（实时）============
    function renderKeyword(q) {
      lastMode = 'keyword';
      const lower = q.toLowerCase().trim();
      const items = allTools.filter(t =>
        (t.name && t.name.toLowerCase().includes(lower)) ||
        (t.description && t.description.toLowerCase().includes(lower)) ||
        (t.tags && t.tags.some(tag => String(tag).toLowerCase().includes(lower)))
      );
      currentItems = items;

      const siteNames = { tools: '教学工具', games: '益智游戏', ppt: 'HTML-PPT' };
      const grouped = {};
      items.forEach(t => {
        if (!grouped[t._site]) grouped[t._site] = [];
        grouped[t._site].push(t);
      });
      let html = '';
      Object.keys(grouped).forEach(site => {
        html += `<div class="opilot-palette-section">
          <div class="opilot-palette-eyebrow">${siteNames[site] || site} (${grouped[site].length})</div>
          ${grouped[site].slice(0, 20).map((t, i) => `
            <div class="opilot-palette-item" data-site="${site}" data-name="${escapeHtml(t.name)}" data-idx="${i}">
              <span class="opilot-palette-icon">${escapeHtml(t.icon || '📄')}</span>
              <span class="opilot-palette-item-name">${escapeHtml(t.name)}</span>
              <span class="opilot-palette-site">${site}</span>
            </div>
          `).join('')}
        </div>`;
      });
      if (!html) {
        html = `<div class="opilot-palette-empty">无匹配工具 · 按 <kbd>Enter</kbd> 让 Opilot 帮你找</div>`;
      }
      results.innerHTML = html;
      activeIndex = 0;
      updateActiveItem();
      bindResultsEvents();
    }

    // ============ 渲染：AI 结果（按 Enter 后）============
    async function runAISearch() {
      const q = input.value.trim();
      if (!q) return;
      results.innerHTML = `<div class="opilot-palette-loading">✨ Opilot 思考中...</div>`;
      currentItems = [];
      activeIndex = 0;
      const toolsForAI = allTools.map(t => ({
        name: t.name, description: t.description, tags: t.tags, subject: t.subject, prefill: t.prefill
      }));
      const result = await callSearch(q, toolsForAI, getHistory(3));
      lastMode = 'ai';
      renderAIResult(result);
      if (result && result.success) {
        const top = (result.tools && result.tools[0]) || null;
        recordHistory({
          q,
          intent: result.intent || 'chat',
          toolName: top ? top.name : null,
          fallback: !!(result && result._fallback)
        });
      }
    }

    function renderAIResult(result) {
      if (!result || !result.success) {
        if (result && result._degraded) {
          results.innerHTML = `
            <div class="opilot-palette-degraded">Opilot 暂不可用，仅显示关键词结果</div>
          `;
          renderKeyword(input.value);
          return;
        }
        results.innerHTML = '<div class="opilot-palette-empty">出错了，请稍后再试</div>';
        return;
      }
      const tools = (result.tools || []).map(t => {
        const local = allTools.find(x => x.name === t.name);
        return local ? { ...local, ...t, _site: local._site } : { ...t, _site: t._site || null };
      }).filter(t => t._site);
      const reply = result.reply || '';
      const intent = result.intent || 'chat';
      const prefill = (result.prefill && typeof result.prefill === 'object') ? result.prefill : {};

      let html = '';
      if (reply) {
        html += `<div class="opilot-palette-reply">${escapeHtml(reply)}</div>`;
      }

      if ((intent === 'launch' || intent === 'search' || (intent === 'chat' && tools.length)) && tools.length) {
        const label = intent === 'launch' ? '推荐 (AI)' : intent === 'search' ? '相关工具' : '或许你想用';
        html += `<div class="opilot-palette-section">
          <div class="opilot-palette-eyebrow">${label}</div>
          ${tools.map((t, i) => `
            <div class="opilot-palette-item" data-site="${escapeHtml(t._site)}" data-name="${escapeHtml(t.name)}" data-idx="${i}">
              <span class="opilot-palette-icon">${escapeHtml(t.icon || '📄')}</span>
              <span class="opilot-palette-item-name">${escapeHtml(t.name)}</span>
              ${t.confidence != null ? `<span class="opilot-palette-conf">${Math.round(t.confidence * 100)}%</span>` : ''}
              <span class="opilot-palette-site">${escapeHtml(t._site)}</span>
            </div>
          `).join('')}
        </div>`;
        // launch 模式：额外显示"启动并预填"按钮
        if (intent === 'launch' && tools[0] && Object.keys(prefill).length) {
          html += renderLaunchButton(tools[0], prefill);
        }
      } else {
        html += `<div class="opilot-palette-empty">无结果 · 试试其他关键词</div>`;
      }

      results.innerHTML = html;
      currentItems = Array.from(results.querySelectorAll('.opilot-palette-item'));
      activeIndex = 0;
      updateActiveItem();
      bindResultsEvents();
      bindLaunchButton();
    }

    function renderLaunchButton(tool, prefill) {
      const prefillJson = JSON.stringify(prefill || {});
      return `<button class="opilot-palette-launch-btn" data-tool="${escapeHtml(tool.name)}" data-site="${escapeHtml(tool._site)}" data-prefill='${escapeHtml(prefillJson)}'>🚀 启动并预填 (${escapeHtml(tool.name)})</button>`;
    }

    function bindLaunchButton() {
      results.querySelectorAll('.opilot-palette-launch-btn').forEach(btn => {
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const toolName = btn.dataset.tool;
          const site = btn.dataset.site;
          let prefill = {};
          try { prefill = JSON.parse(btn.dataset.prefill || '{}'); } catch {}
          const r = await callLaunch(site, toolName, prefill);
          if (r.success && r.url) {
            recordHistory({ q: input.value, intent: 'launch', toolName });
            close();
            window.location.href = r.url;
          } else {
            toast(r.message || '启动失败', { type: 'error' });
          }
        });
      });
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
      if (el.classList.contains('opilot-palette-history')) {
        const q = el.dataset.q || '';
        input.value = q;
        renderKeyword(q);
        input.focus();
        return;
      }
      const site = el.dataset.site;
      const name = el.dataset.name;
      if (!site || !name) return;
      const tool = allTools.find(t => t._site === site && t.name === name);
      if (!tool) return;
      close();
      recordHistory({ q: input.value, intent: 'launch', toolName: name });
      window.location.href = buildLaunchUrl(tool._origin, tool, {});
    }

    function bindResultsEvents() {
      results.querySelectorAll('.opilot-palette-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => { e.preventDefault(); });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          activeIndex = i;
          activateItem(el);
        });
        el.addEventListener('mouseenter', () => {
          activeIndex = i;
          updateActiveItem();
        });
      });
    }

    // ============ 事件 ============
    // 输入：实时只做关键词过滤（不调 AI）
    const onInput = debounce((e) => {
      const q = e.target.value;
      if (!q.trim()) renderHome();
      else renderKeyword(q);
    }, 100);
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
        // 优先激活高亮项（如果有），否则触发 AI 搜索
        const active = results.querySelector('.opilot-palette-item.active');
        if (active && lastMode !== 'ai') {
          activateItem(active);
        } else if (active && lastMode === 'ai') {
          // AI 模式：点击高亮项也启动工具
          activateItem(active);
        } else {
          // 无高亮项 → 调 AI
          runAISearch();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    // 点击 overlay 背景关闭（点击 palette 内部不关闭）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // 自动聚焦
    setTimeout(() => input.focus(), 50);

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

  // ============ 悬浮面板（Opilot Panel）============
  // 共享 iframe 实例：同一站只创建一次
  let panelInstance = null;
  function openPanel() {
    if (panelInstance && document.body.contains(panelInstance)) {
      // 已存在：显示
      panelInstance.style.display = 'block';
      try { panelInstance.contentWindow.OpilotPanel.open(); } catch (e) {}
      return panelInstance;
    }
    // 创建 iframe
    const iframe = document.createElement('iframe');
    iframe.src = 'https://ai.oscarstudio.cn/opilot-panel.html';
    iframe.allow = 'clipboard-read; clipboard-write';
    iframe.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'width:480px',
      'height:600px',
      'min-width:320px',
      'min-height:400px',
      'max-width:95vw',
      'max-height:95vh',
      'border:none',
      'background:transparent',
      'z-index:99998',
      'box-shadow:none',
      'border-radius:16px',
      'overflow:hidden',
      'transition:opacity 0.2s'
    ].join(';');
    iframe.setAttribute('allowtransparency', 'true');
    document.body.appendChild(iframe);
    panelInstance = iframe;

    // 监听 iframe 内的关闭消息
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'opilot-close') {
        if (panelInstance) panelInstance.style.display = 'none';
      }
    });
    return iframe;
  }

  // 全局快捷键 ⌘K / Ctrl+K（默认开面板）
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPanel();
    }
  });

  // ============ 公开 API ============
  window.Opilot = {
    enhance: createDropdown,
    openPalette: openPalette,
    openPanel: openPanel,
    toast: toast,
    recordHistory: recordHistory,
    getHistory: getHistory,
    shouldUseOpilot: shouldUseOpilot,
    version: '1.0.0'
  };
})();
