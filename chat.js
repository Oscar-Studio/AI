// =====================================================
// AI Studio — Chat module
//   文本对话、多模态附件、深度思考、流式输出
//   模型选择：模态框二级选择（vendor + model）
// =====================================================

(function () {
    'use strict';

    // ===== 客户端结构化日志（t=ms 相对时间轴）=====
    // 默认只输出关键事件（永远打印）；要看到每条 chunk，console 里：
    //   window.__chatVerbose = true
    let _t0 = 0;
    function clock() { return _t0 ? Date.now() - _t0 : 0; }
    function chatLog(kind, msg, data) {
        const t = clock();
        const tag = `[chat] t=${String(t).padStart(6)}ms`;
        const tail = data ? ' ' + data : '';
        if (kind === 'warn')  console.warn(tag, msg, tail);
        else if (kind === 'err') console.error(tag, msg, tail);
        else                    console.log(tag, msg, tail);
    }
    function chatVerbose(msg, data) {
        if (typeof window !== 'undefined' && window.__chatVerbose) {
            chatLog('info', msg, data);
        }
    }

    // ---- Model catalog (vendor + models) ----
    const MODEL_CONFIG = {
        deepseek: {
            name: 'DeepSeek',
            models: [
                { id: 'deepseek-v4-flash', name: 'V4-Flash' },
                { id: 'deepseek-v4-pro',   name: 'V4-Pro', premium: true }
            ]
        },
        minimax: {
            name: 'MiniMax',
            models: [
                { id: 'MiniMax-M3',  name: 'M3',  think: true, multi: true },
                { id: 'MiniMax-M2.7', name: 'M2.7', think: true }
            ]
        },
        mimo: {
            name: 'MiMo',
            models: [
                { id: 'mimo-v2.5',      name: 'V2.5',     multi: true },
                { id: 'mimo-v2.5-pro',  name: 'V2.5-Pro', premium: true, multi: true }
            ]
        },
        qwen: {
            name: 'Qwen',
            models: [
                { id: 'qwen/qwen3.6-flash', name: 'Qwen3.6-Flash', multi: true },
                { id: 'qwen/qwen3.6-plus',  name: 'Qwen3.6-Plus',  multi: true, premium: true },
                { id: 'qwen/qwen3.7-plus',  name: 'Qwen3.7-Plus',  multi: true, premium: true },
                { id: 'qwen/qwen3.7-max',   name: 'Qwen3.7-Max',   multi: true, premium: true }
            ]
        },
        zai: {
            name: 'GLM',
            models: [
                { id: 'z-ai/glm-4.7-flash', name: 'GLM-4.7-Flash', multi: true },
                { id: 'z-ai/glm-5v-turbo',  name: 'GLM-5V-Turbo',  multi: true, premium: true },
                { id: 'z-ai/glm-5.1',       name: 'GLM-5.1',       premium: true },
                { id: 'z-ai/glm-5.2',       name: 'GLM-5.2',       premium: true }
            ]
        },
        moonshot: {
            name: 'Kimi',
            models: [
                { id: 'moonshotai/kimi-k2.5',       name: 'Kimi-K2.5',     multi: true, premium: true },
                { id: 'moonshotai/kimi-k2.6',       name: 'Kimi-K2.6',     multi: true, premium: true },
                { id: 'moonshotai/kimi-k2.7-code',  name: 'Kimi-K2.7-Code', multi: true, premium: true }
            ]
        },
        hy3: {
            name: 'Tencent',
            models: [
                { id: 'tencent/hy3', name: 'Hy3', premium: true }
            ]
        },
        meituan: {
            name: 'Meituan',
            models: [
                { id: 'meituan/longcat-2.0', name: 'LongCat 2.0', premium: true }
            ]
        },
        xai: {
            name: 'xAI',
            models: [
                { id: 'x-ai/grok-4.3', name: 'Grok 4.3', multi: true, premium: true }
            ]
        },
        free: {
            name: 'Free',
            models: [] // populated at runtime from openrouter-free-models repo
        }
    };

    const MULTIMODAL_MODELS = [
        'qwen/qwen3.6-flash', 'qwen/qwen3.6-plus', 'qwen/qwen3.7-plus', 'qwen/qwen3.7-max',
        'z-ai/glm-5v-turbo', 'z-ai/glm-4.7-flash',
        'moonshotai/kimi-k2.5', 'moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.7-code',
        'x-ai/grok-4.3',
        'mimo-v2.5', 'mimo-v2.5-pro',
        'MiniMax-M3'
    ];

    // ---- DOM ----
    const chatScroll     = document.getElementById('chatScroll');
    const chatWelcome    = document.getElementById('chatWelcome');
    const chatInput      = document.getElementById('chatInput');
    const sendBtn        = document.getElementById('sendBtn');
    const sendLabel      = document.getElementById('sendLabel');
    const thinkBtn       = document.getElementById('thinkBtn');
    const tokenCounter   = document.getElementById('tokenCounter');
    const attachBtn      = document.getElementById('attachBtn');
    const fileInput      = document.getElementById('fileInput');
    const attachPreview  = document.getElementById('attachPreview');

    const sidebarModelBtn   = document.getElementById('sidebarModelBtn');
    const sidebarModelVendor = document.getElementById('sidebarModelVendor');
    const sidebarModelName  = document.getElementById('sidebarModelName');
    // 顶栏紧凑 pill（移动端使用，但始终存在；桌面端 display:none 不显示）
    const modelPill        = document.getElementById('modelPill');
    const modelPillVendor  = document.getElementById('modelPillVendor');
    const modelPillName    = document.getElementById('modelPillName');

    const modelModal       = document.getElementById('modelModal');
    const modelModalClose  = document.getElementById('modelModalClose');
    const vendorList       = document.getElementById('vendorList');
    const modelList        = document.getElementById('modelList');

    // ---- State ----
    const STORAGE_KEY = 'ai_studio_state';
    const saved = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    })();

    let provider       = saved.provider   || 'deepseek';
    let modelId        = saved.modelId    || 'deepseek-v4-flash';
    let thinking       = saved.thinking ?? true;
    let attachments    = [];
    let isGenerating   = false;
    let abortCtrl      = null;
    let liveStreamCtrl = null;  // 当前订阅的 live stream AbortController
    let currentAiDiv   = null;
    let totalTokens    = 0;
    let userScrolledUp = false;
    const history = [];
    let currentSessionId = null;
    let isNewSession    = false;       // 标记当前会话是否刚创建（用于首轮后生成 AI 标题）
    let pendingFirstUserText = null;  // 首条 user 消息，用于 AI 标题生成（客户端预读，防后端写消息失败时丢失）

    // ---- Free models loader ----
    (async function loadFreeModels() {
        try {
            const r = await fetch('https://cdn.jsdelivr.net/gh/Oscarwang1222/openrouter-free-models@main/models-cn.json');
            const d = await r.json();
            MODEL_CONFIG.free.models = (d.models || []).map(m => ({
                id: m.id,
                name: (m.name || m.id).replace(/\s*\(free\)/gi, '').trim() + ' 🆓',
                free: true
            }));
            // If currently on free, refresh
            if (provider === 'free') renderModelList();
            // 通知外部模块（如 Arena）free 模型已就绪
            window.dispatchEvent(new CustomEvent('chat:free-models-loaded', {
                detail: { count: MODEL_CONFIG.free.models.length }
            }));
        } catch (e) {
            console.warn('[chat] free models load failed:', e);
            window.dispatchEvent(new CustomEvent('chat:free-models-loaded', {
                detail: { count: 0, error: e.message }
            }));
        }
    })();

    // ---- Quota ----
    let quotaCache = null;
    async function fetchQuota() {
        const token = localStorage.getItem('ai_token');
        if (!token) { quotaCache = null; updateQuotaUI(); return; }
        try {
            const resp = await fetch('https://api.oscarstudio.cn/api/user', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (data.success && data.user) {
                quotaCache = data.user.quota?.credits?.remaining ?? null;
            }
        } catch (e) { /* silent */ }
        updateQuotaUI();
    }

    function updateQuotaUI() {
        const pill = document.getElementById('quotaPill');
        const val  = document.getElementById('quotaValue');
        if (quotaCache === null) {
            pill.style.display = 'none';
            return;
        }
        pill.style.display = 'inline-flex';
        val.textContent = quotaCache.toLocaleString();
        pill.classList.toggle('is-low', quotaCache <= 50);
    }

    // ---- Model modal ----
    function openModelModal() {
        modelModal.hidden = false;
        renderVendorList();
        renderModelList();
    }
    function closeModelModal() {
        modelModal.hidden = true;
    }
    function renderVendorList() {
        vendorList.innerHTML = '';
        Object.keys(MODEL_CONFIG).forEach(key => {
            const cfg = MODEL_CONFIG[key];
            const li = document.createElement('li');
            li.className = key === provider ? 'active' : '';
            const vn = document.createElement('span');
            vn.className = 'vendor-name';
            vn.textContent = cfg.name;
            const vc = document.createElement('span');
            vc.className = 'vendor-count';
            vc.textContent = String(cfg.models.length);
            li.appendChild(vn);
            li.appendChild(vc);
            li.addEventListener('click', () => {
                provider = key;
                renderVendorList();
                renderModelList();
            });
            vendorList.appendChild(li);
        });
    }
    function renderModelList() {
        const cfg = MODEL_CONFIG[provider];
        modelList.innerHTML = '';
        if (!cfg || !cfg.models.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = '暂无可用模型';
            modelList.appendChild(li);
            return;
        }
        cfg.models.forEach(m => {
            const li = document.createElement('li');
            li.className = m.id === modelId ? 'active' : '';
            const badges = [];
            if (m.free)     badges.push('<span class="model-badge free">FREE</span>');
            if (m.premium)  badges.push('<span class="model-badge">PRO</span>');
            if (MULTIMODAL_MODELS.includes(m.id)) badges.push('<span class="model-badge multi">MULTI</span>');
            if (m.think || provider === 'minimax') badges.push('<span class="model-badge think">THINK</span>');
            const modelRow = document.createElement('div');
            modelRow.className = 'model-row';
            const mnameSpan = document.createElement('span');
            mnameSpan.className = 'model-name';
            mnameSpan.textContent = m.name;
            const midSpan = document.createElement('span');
            midSpan.className = 'model-id';
            midSpan.textContent = m.id;
            modelRow.appendChild(mnameSpan);
            modelRow.appendChild(midSpan);
            li.appendChild(modelRow);
            const badgesDiv = document.createElement('div');
            badgesDiv.className = 'model-badges';
            if (m.free) {
                const b = document.createElement('span');
                b.className = 'model-badge free';
                b.textContent = 'FREE';
                badgesDiv.appendChild(b);
            }
            if (m.premium) {
                const b = document.createElement('span');
                b.className = 'model-badge';
                b.textContent = 'PRO';
                badgesDiv.appendChild(b);
            }
            if (MULTIMODAL_MODELS.includes(m.id)) {
                const b = document.createElement('span');
                b.className = 'model-badge multi';
                b.textContent = 'MULTI';
                badgesDiv.appendChild(b);
            }
            if (m.think || provider === 'minimax') {
                const b = document.createElement('span');
                b.className = 'model-badge think';
                b.textContent = 'THINK';
                badgesDiv.appendChild(b);
            }
            li.appendChild(badgesDiv);
            li.addEventListener('click', () => {
                modelId = m.id;
                thinking = true;
                saveState();
                applyThinkBtn();
                applyAttachBtn();
                refreshSidebarModel();
                closeModelModal();
            });
            modelList.appendChild(li);
        });
    }
    function refreshSidebarModel() {
        const cfg = MODEL_CONFIG[provider];
        const m   = cfg.models.find(x => x.id === modelId);
        const displayName = m ? m.name : modelId;
        sidebarModelVendor.textContent = cfg.name;
        sidebarModelName.textContent = displayName;
        // 同步顶栏 pill（移动端）
        if (modelPillVendor) modelPillVendor.textContent = cfg.name;
        if (modelPillName)   modelPillName.textContent   = displayName;
    }

    function applyThinkBtn() {
        // MiniMax always thinks; we just hide the toggle
        const hide = provider === 'minimax';
        thinkBtn.classList.toggle('hidden', hide);
        if (hide) {
            thinking = true;
        } else {
            thinkBtn.classList.toggle('active', thinking);
        }
    }

    function applyAttachBtn() {
        const isMulti = MULTIMODAL_MODELS.includes(modelId);
        attachBtn.classList.toggle('show', isMulti);
        if (!isMulti) {
            attachments = [];
            fileInput.value = '';
            renderAttachPreview();
        }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, modelId, thinking }));
    }

    sidebarModelBtn.addEventListener('click', openModelModal);
    if (modelPill) modelPill.addEventListener('click', openModelModal);
    modelModalClose.addEventListener('click', closeModelModal);
    modelModal.addEventListener('click', (e) => {
        if (e.target === modelModal) closeModelModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modelModal.hidden) closeModelModal();
    });

    // ---- Attachments ----
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        for (const file of Array.from(fileInput.files || [])) {
            const isImage = file.type.startsWith('image/');
            const isAudio = file.type.startsWith('audio/');
            if (!isImage && !isAudio) continue;
            const url = await new Promise(r => {
                const fr = new FileReader();
                fr.onload = e => r(e.target.result);
                fr.readAsDataURL(file);
            });
            attachments.push({ type: isImage ? 'image' : 'audio', url, name: file.name });
        }
        fileInput.value = '';
        renderAttachPreview();
    });
    function renderAttachPreview() {
        attachPreview.innerHTML = '';
        if (!attachments.length) {
            attachPreview.classList.remove('show');
            return;
        }
        attachPreview.classList.add('show');
        attachments.forEach((att, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'attach-thumb';
            if (att.type === 'image') {
                const img = document.createElement('img');
                img.src = att.url;
                img.addEventListener('click', () => window.open(att.url, '_blank'));
                wrap.appendChild(img);
            } else {
                const audio = document.createElement('audio');
                audio.src = att.url;
                audio.controls = true;
                wrap.appendChild(audio);
            }
            const rm = document.createElement('button');
            rm.className = 'remove';
            rm.type = 'button';
            rm.textContent = '✕';
            rm.addEventListener('click', () => {
                attachments.splice(i, 1);
                renderAttachPreview();
            });
            wrap.appendChild(rm);
            attachPreview.appendChild(wrap);
        });
    }

    // ---- Send ----
    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
    sendBtn.addEventListener('click', handleSend);
    thinkBtn.addEventListener('click', () => {
        thinking = !thinking;
        thinkBtn.classList.toggle('active', thinking);
        saveState();
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    });

    chatScroll.addEventListener('scroll', () => {
        userScrolledUp = chatScroll.scrollTop + chatScroll.clientHeight < chatScroll.scrollHeight - 50;
    });

    function scrollBottom(force) {
        if (force !== true && userScrolledUp) return;
        chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    function buildContent(text, atts) {
        if (!atts || !atts.length) return { role: 'user', content: text };
        const content = [{ type: 'text', text }];
        for (const a of atts) {
            if (a.type === 'image') content.push({ type: 'image_url', image_url: { url: a.url } });
            else if (a.type === 'audio') content.push({ type: 'audio', audio_url: { url: a.url } });
        }
        return { role: 'user', content };
    }

    function appendMsg(role, text, meta, reasoning) {
        const div = document.createElement('div');
        div.className = `msg ${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.textContent = role === 'user' ? 'U' : 'AI';

        const body = document.createElement('div');
        body.className = 'msg-body';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';

        if (role === 'ai') {
            // 思考块（reasoning）：如果历史消息有 reasoning，建一个
            // 这样新窗口打开时能看到已完成的 reasoning，live stream 时也能继续 append
            if (reasoning || meta === 'live') {
                const rBlock = document.createElement('div');
                rBlock.className = 'reasoning-block';
                const rHeader = document.createElement('div');
                rHeader.className = 'reasoning-header';
                rHeader.innerHTML = '<span class="think-label">已深度思考</span><span class="think-time"></span><span class="think-arrow">▶</span>';
                const rBody = document.createElement('div');
                rBody.className = 'reasoning-body';
                rBody.textContent = reasoning || '';
                rHeader.addEventListener('click', () => {
                    rBlock.classList.toggle('expanded');
                    rHeader.classList.toggle('expanded');
                });
                rBlock.appendChild(rHeader);
                rBlock.appendChild(rBody);
                bubble.appendChild(rBlock);
            }
            const content = document.createElement('div');
            content.className = 'content';
            if (text) setContent(content, marked.parse(text, { async: false }));
            bubble.appendChild(content);
        } else {
            bubble.textContent = text;
            if (meta && meta.length) {
                const row = document.createElement('div');
                row.className = 'attach-row';
                for (const a of meta) {
                    if (a.type === 'image') {
                        const img = document.createElement('img');
                        img.src = a.url;
                        img.addEventListener('click', () => window.open(a.url, '_blank'));
                        row.appendChild(img);
                    } else {
                        const au = document.createElement('audio');
                        au.src = a.url;
                        au.controls = true;
                        row.appendChild(au);
                    }
                }
                bubble.appendChild(row);
            }
        }
        body.appendChild(bubble);

        const metaRow = document.createElement('div');
        metaRow.className = 'msg-meta';

        if (role === 'ai') {
            const tokenBtn = document.createElement('button');
            tokenBtn.className = 'msg-token';
            const tokenSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            tokenSvg.setAttribute('viewBox', '0 0 24 24');
            tokenSvg.setAttribute('fill', 'none');
            tokenSvg.setAttribute('stroke', 'currentColor');
            tokenSvg.setAttribute('stroke-width', '1.8');
            tokenSvg.setAttribute('stroke-linecap', 'round');
            tokenSvg.setAttribute('stroke-linejoin', 'round');
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '12');
            circle.setAttribute('cy', '12');
            circle.setAttribute('r', '10');
            tokenSvg.appendChild(circle);
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path1.setAttribute('d', 'M12 16v-4');
            tokenSvg.appendChild(path1);
            const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path2.setAttribute('d', 'M12 8h.01');
            tokenSvg.appendChild(path2);
            const tokenDash = document.createElement('span');
            tokenDash.textContent = '—';
            tokenBtn.textContent = '';
            tokenBtn.appendChild(tokenSvg);
            tokenBtn.appendChild(tokenDash);
            const tip = document.createElement('span');
            tip.className = 'token-tip';
            tip.textContent = '输入: — | 输出: —';
            tokenBtn.appendChild(tip);
            tokenBtn._tip = tip;
            tokenBtn._count = tokenBtn.querySelector('span');
            metaRow.appendChild(tokenBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action';
        copyBtn.textContent = '';
        const cpSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        cpSvg.setAttribute('viewBox', '0 0 24 24');
        cpSvg.setAttribute('fill', 'none');
        cpSvg.setAttribute('stroke', 'currentColor');
        cpSvg.setAttribute('stroke-width', '1.8');
        const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rectEl.setAttribute('x', '9');
        rectEl.setAttribute('y', '9');
        rectEl.setAttribute('width', '13');
        rectEl.setAttribute('height', '13');
        rectEl.setAttribute('rx', '2');
        cpSvg.appendChild(rectEl);
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
        cpSvg.appendChild(pathEl);
        copyBtn.appendChild(cpSvg);
        copyBtn.appendChild(document.createTextNode('复制'));
        copyBtn.addEventListener('click', () => {
            const src = role === 'ai'
                ? bubble.querySelector('.content')?.textContent || ''
                : bubble.textContent || '';
            navigator.clipboard.writeText(src).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.textContent = '';
                const cpSvg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                cpSvg2.setAttribute('viewBox', '0 0 24 24');
                cpSvg2.setAttribute('fill', 'none');
                cpSvg2.setAttribute('stroke', 'currentColor');
                cpSvg2.setAttribute('stroke-width', '1.8');
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                poly.setAttribute('points', '20 6 9 17 4 12');
                cpSvg2.appendChild(poly);
                copyBtn.appendChild(cpSvg2);
                copyBtn.appendChild(document.createTextNode('已复制'));
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.textContent = '';
            const cpSvg1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            cpSvg1.setAttribute('viewBox', '0 0 24 24');
            cpSvg1.setAttribute('fill', 'none');
            cpSvg1.setAttribute('stroke', 'currentColor');
            cpSvg1.setAttribute('stroke-width', '1.8');
            const rect1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect1.setAttribute('x', '9');
            rect1.setAttribute('y', '9');
            rect1.setAttribute('width', '13');
            rect1.setAttribute('height', '13');
            rect1.setAttribute('rx', '2');
            cpSvg1.appendChild(rect1);
            const cpPath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            cpPath1.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
            cpSvg1.appendChild(cpPath1);
            copyBtn.appendChild(cpSvg1);
            copyBtn.appendChild(document.createTextNode('复制'));
                }, 1500);
            });
        });
        metaRow.appendChild(copyBtn);
        body.appendChild(metaRow);

        div.appendChild(avatar);
        div.appendChild(body);
        chatScroll.appendChild(div);
        scrollBottom();
        return div;
    }

    function renderMath(el) {
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(el, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$',  right: '$',  display: false }
                ],
                throwOnError: false
            });
        }
    }

    function setContent(el, html) {
        const sanitized = DOMPurify.sanitize(html);
        const frag = document.createRange().createContextualFragment(sanitized);
        el.textContent = '';
        el.appendChild(frag);
        renderMath(el);
        addCodeCopyBtns(el);
    }

    function addCodeCopyBtns(el) {
        el.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.code-copy')) return;
            const btn = document.createElement('button');
            btn.className = 'code-copy';
            btn.textContent = '复制';
            btn.addEventListener('click', () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent;
                navigator.clipboard.writeText(code).then(() => {
                    btn.textContent = '已复制';
                    setTimeout(() => { btn.textContent = '复制'; }, 1500);
                });
            });
            pre.appendChild(btn);
        });
    }

    function setLoading(on) {
        isGenerating = on;
        sendBtn.classList.toggle('stop', on);
        sendLabel.textContent = on ? '停止' : '发送';
    }

    function updateTotalTokens(delta) {
        totalTokens += delta;
        tokenCounter.textContent = `累计 ${totalTokens.toLocaleString()} tokens`;
    }

    async function handleSend() {
        if (isGenerating) {
            abortCtrl?.abort();
            return;
        }
        const text = chatInput.value.trim();
        if (!text) return;

        // Quota check
        if (quotaCache !== null && quotaCache <= 0) {
            alert('今日 Credits 配额已用完，请明天再试或升级会员');
            return;
        }

        if (chatWelcome && chatWelcome.parentElement === chatScroll) {
            chatWelcome.remove();
        }

        chatInput.value = '';
        chatInput.style.height = '56px';
        userScrolledUp = false;
        const sentAtts = attachments.slice();
        _t0 = Date.now();
        chatLog('info', 'sendMessage', `model=${modelId} provider=${provider} thinking=${thinking} session=${currentSessionId || 'null'} msgLen=${text.length} atts=${sentAtts.length}`);
        appendMsg('user', text, sentAtts);
        history.push(buildContent(text, sentAtts));
        attachments = [];
        renderAttachPreview();
        setLoading(true);

        // 云端持久化：确保会话存在
        const _prevSess = currentSessionId;
        await ensureSessionForUser(text);
        chatLog('info', 'ensureSession', _prevSess ? `reused=${currentSessionId}` : `created=${currentSessionId}`);
        if (isNewSession) {
            pendingFirstUserText = text;
        }

        // 关键修复：用户消息必须先入库，不再等流结束。
        // 这样即便 AI 思考超时 / 网络断开，用户的提问也会保留在历史里。
        // 服务端有 fallback 标题（前 15 字），即便 AI 标题生成失败，session 也不会一直叫"新对话"。
        if (currentSessionId) {
            persistUserToCloud(text, sentAtts)
                .then((r) => chatLog('info', 'persistUser', `ok=${!!(r && r.ok)} seq=${r && r.data && r.data.message ? r.data.message.seq : '?'}`))
                .catch((e) => chatLog('warn', 'persistUser failed', e.message));
            if (isNewSession && pendingFirstUserText) {
                chatLog('info', 'triggerAiTitle', `session=${currentSessionId}`);
                triggerAiTitle(currentSessionId, pendingFirstUserText);
            }
        }

        const aiDiv = appendMsg('ai', '');
        currentAiDiv = aiDiv;

        // Reasoning block
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'reasoning-block';
        const reasoningHeader = document.createElement('div');
        reasoningHeader.className = 'reasoning-header';
        reasoningHeader.textContent = '';
        const thinkLabel = document.createElement('span');
        thinkLabel.className = 'think-label';
        thinkLabel.textContent = '思考中';
        const thinkTime = document.createElement('span');
        thinkTime.className = 'think-time';
        const thinkArrow = document.createElement('span');
        thinkArrow.className = 'think-arrow';
        thinkArrow.textContent = '▶';
        reasoningHeader.appendChild(thinkLabel);
        reasoningHeader.appendChild(thinkTime);
        reasoningHeader.appendChild(thinkArrow);
        const reasoningBody = document.createElement('div');
        reasoningBody.className = 'reasoning-body';
        reasoningHeader.addEventListener('click', () => {
            const expanded = reasoningDiv.classList.toggle('expanded');
            reasoningHeader.classList.toggle('expanded', expanded);
            _reasoningExpanded = expanded;
        });
        reasoningDiv.appendChild(reasoningHeader);
        reasoningDiv.appendChild(reasoningBody);
        aiDiv.querySelector('.msg-bubble').prepend(reasoningDiv);

        const contentDiv = aiDiv.querySelector('.content');
        contentDiv.classList.add('typing');

        let _thinkStopped = false;
        let _thinkingFinished = false;
        let _reasoningExpanded = false;
        const thinkStart = Date.now();

        function finishThinking() {
            if (_thinkingFinished) return;
            _thinkingFinished = true;
            const secs = Math.round((Date.now() - thinkStart) / 1000);
            const label = secs >= 60 ? `${Math.floor(secs / 60)}分${secs % 60}秒` : `${secs}秒`;
            reasoningHeader.querySelector('.think-label').textContent = '已深度思考';
            reasoningHeader.querySelector('.think-time').textContent = label;
        }

        const thinkTimer = setInterval(() => {
            if (_thinkStopped || _thinkingFinished || !isGenerating) return;
            reasoningDiv.style.display = 'block';
            const secs = Math.round((Date.now() - thinkStart) / 1000);
            const label = secs >= 60 ? `${Math.floor(secs / 60)}分${secs % 60}秒` : `${secs}秒`;
            reasoningHeader.querySelector('.think-time').textContent = label;
        }, 1000);

        abortCtrl = new AbortController();
        let streamTimeoutId = null;  // 提到 try 之外，catch 块也能 clearTimeout
        let fullResponse = '';
        let fullReasoning = '';
        let outputChars = 0;
        let usageReceived = false;
        let lastInputTokens = 0;
        let lastOutputTokens = 0;
        const isMiniMax = provider === 'minimax';

        const body = {
            model: modelId,
            messages: history,
            stream: true,
            sessionId: currentSessionId  // 让服务端在 abort 时能把累积内容存到正确的 session
        };

        let promptChars = 0;
        for (const m of history) {
            if (typeof m.content === 'string') promptChars += m.content.length;
        }

        if (provider === 'deepseek') {
            body.extra_body = { thinking: { type: thinking ? 'enabled' : 'disabled' } };
            if (thinking) body.extra_body.reasoning_effort = 'high';
        }
        if (isMiniMax) body.reasoning_split = true;
        if (provider === 'mimo') {
            body.thinking = { type: thinking ? 'enabled' : 'disabled' };
            if (thinking) body.thinking.budget_tokens = 2048;
        }
        if (provider === 'xai' && modelId === 'x-ai/grok-4.3') {
            body.extra_body = { reasoning: thinking ? 'enabled' : 'disabled' };
        }

        try {
            const token = localStorage.getItem('ai_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // 空闲超时（idle timeout），不是总时长：
            // 思考/正文每来一个 chunk 都 armIdleTimeout() 重置一次计时器。
            // 只有当上游"完全沉默" STREAM_IDLE_MS 毫秒才认为连接死了。
            // 思考过程（reasoning_content）就是输出，不应该被总时长卡掉。
            const STREAM_IDLE_MS = 300000;
            function armIdleTimeout() {
                if (streamTimeoutId) clearTimeout(streamTimeoutId);
                streamTimeoutId = setTimeout(() => {
                    const silentMs = Date.now() - (typeof _lastChunkAt === 'number' ? _lastChunkAt : Date.now());
                    chatLog('warn', 'ABORT (idle fired)', `上游 ${silentMs}ms 没任何输出 (阈值 ${STREAM_IDLE_MS}ms)`);
                    abortCtrl.abort();
                }, STREAM_IDLE_MS);
            }
            armIdleTimeout();
            const _fetchStart = Date.now();
            chatLog('info', 'fetch', `POST /api/chat stream=true body≈${JSON.stringify(body).length}B`);
            const resp = await fetch('https://api.oscarstudio.cn/api/chat', {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: abortCtrl.signal
            });
            const _ttfb = Date.now() - _fetchStart;
            chatLog('info', 'fetch-response', `status=${resp.status} ttfb=${_ttfb}ms content-type=${resp.headers.get('content-type') || '?'}`);

            if (resp.status === 401) throw new Error('请先登录后再使用 (401 未登录)');
            if (resp.status === 502) {
                const ed = await resp.json().catch(() => ({}));
                throw new Error(ed.message || 'API 服务暂时不可用，请稍后再试');
            }
            if (resp.status === 403) {
                const ed = await resp.json().catch(() => ({}));
                throw new Error(ed.message || '今日配额已用完，请明天再试或升级会员');
            }
            if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);

            contentDiv.classList.remove('typing');
            const reader = resp.body.getReader();
            const dec = new TextDecoder();
            let buf = '';

            let _chunkCount = 0;
            let _totalBytes = 0;
            let _lastChunkAt = Date.now();
            let _finishReason = null;
            chatLog('info', 'stream-loop start', `idle=${STREAM_IDLE_MS}ms`);
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // 每拿到一个 chunk（哪怕只是 ": keep-alive" 注释）就重置
                // 空闲计时器；上游只要还在产出，就算在思考，也不算"卡"
                _chunkCount++;
                _totalBytes += value ? value.length : 0;
                _lastChunkAt = Date.now();
                armIdleTimeout();
                chatVerbose('chunk', `#${_chunkCount} ${value ? value.length : 0}B idle-reset`);
                buf += dec.decode(value, { stream: true });
                let lines = buf.split(/\r\n|\r|\n/);
                buf = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data')) continue;
                    const s = line.slice(line.charAt(5) === ' ' ? 6 : 5);
                    if (s === '[DONE]') continue;
                    try {
                        const d = JSON.parse(s);

                        // xAI reasoning
                        if (provider === 'xai' && modelId === 'x-ai/grok-4.3' && thinking) {
                            const delta = d.choices?.[0]?.delta;
                            if (delta?.reasoning) {
                                fullReasoning += delta.reasoning;
                                outputChars += delta.reasoning.length;
                                reasoningBody.textContent = fullReasoning;
                                reasoningDiv.style.display = 'block';
                                if (!_reasoningExpanded) reasoningDiv.classList.remove('expanded');
                                scrollBottom();
                            }
                        }
                        // OpenRouter models reasoning
                        if (['qwen', 'zai', 'moonshot', 'hy3'].includes(provider) && thinking) {
                            const delta = d.choices?.[0]?.delta;
                            if (delta) {
                                const rt = delta.reasoning || delta.thinking || delta.reasoning_content || delta.thought;
                                if (rt) {
                                    fullReasoning += rt;
                                    outputChars += rt.length;
                                    reasoningBody.textContent = fullReasoning;
                                    reasoningDiv.style.display = 'block';
                                    if (!_reasoningExpanded) reasoningDiv.classList.remove('expanded');
                                    scrollBottom();
                                }
                            }
                        }
                        // MiniMax reasoning
                        if (isMiniMax && d.choices?.[0]?.delta) {
                            const delta = d.choices[0].delta;
                            if (delta.reasoning_details) {
                                for (const rd of delta.reasoning_details) {
                                    if (rd.text) {
                                        fullReasoning += rd.text;
                                        outputChars += rd.text.length;
                                    }
                                }
                                reasoningBody.textContent = fullReasoning;
                                reasoningDiv.style.display = 'block';
                                if (!_reasoningExpanded) reasoningDiv.classList.remove('expanded');
                                scrollBottom();
                            }
                            if (delta.content) {
                                _thinkStopped = true;
                                clearInterval(thinkTimer);
                                finishThinking();
                                fullResponse += delta.content;
                                outputChars += delta.content.length;
                                const html = marked.parse(fullResponse, { async: false });
                                const sanitized = DOMPurify.sanitize(html);
                                const frag = document.createRange().createContextualFragment(sanitized);
                                contentDiv.textContent = '';
                                contentDiv.appendChild(frag);
                                renderMath(contentDiv);
                                scrollBottom();
                            }
                        }
                        // DeepSeek / MiMo reasoning
                        else if ((provider === 'deepseek' || provider === 'mimo') && d.choices?.[0]?.delta?.reasoning_content && thinking) {
                            fullReasoning += d.choices[0].delta.reasoning_content;
                            outputChars += d.choices[0].delta.reasoning_content.length;
                            reasoningBody.textContent = fullReasoning;
                            reasoningDiv.style.display = 'block';
                            if (!_reasoningExpanded) reasoningDiv.classList.remove('expanded');
                            scrollBottom();
                        }

                        // 抓 finishReason（OpenAI 兼容 stream 通常在最后一个 delta 里带）
                        if (!isMiniMax && d.choices?.[0]?.finish_reason) {
                            _finishReason = d.choices[0].finish_reason;
                        }

                        // Answer content
                        if (!isMiniMax && d.choices?.[0]?.delta?.content) {
                            clearInterval(thinkTimer);
                            _thinkStopped = true;
                            finishThinking();
                            const c = d.choices[0].delta.content;
                            fullResponse += c;
                            outputChars += c.length;
                            const html = marked.parse(fullResponse, { async: false });
                            setContent(contentDiv, html);
                            scrollBottom();
                        }

                        if (d._type === 'usage') {
                            usageReceived = true;
                            lastInputTokens = d.input_tokens || lastInputTokens;
                            lastOutputTokens = d.output_tokens || lastOutputTokens;
                            applyUsage(d);
                        } else if (d.usage && !usageReceived) {
                            usageReceived = true;
                            lastInputTokens = d.usage.input_tokens || lastInputTokens;
                            lastOutputTokens = d.usage.output_tokens || lastOutputTokens;
                            applyUsage(d.usage);
                        }
                    } catch (e) {
                        console.warn('[SSE parse]', e.message, '| raw:', line);
                    }
                }
            }

            if (buf.trim()) {
                const last = buf.trim();
                if (last.startsWith('data')) {
                    const s = last.slice(last.charAt(5) === ' ' ? 6 : 5);
                    if (s !== '[DONE]') {
                        try {
                            const d = JSON.parse(s);
                            if (!isMiniMax && d.choices?.[0]?.delta?.content) {
                                fullResponse += d.choices[0].delta.content;
                                outputChars += d.choices[0].delta.content.length;
                            }
                        } catch (_) {}
                    }
                }
            }
            const rem = dec.decode();
            if (rem) { fullResponse += rem; outputChars += rem.length; }
            clearTimeout(streamTimeoutId);
            chatLog('info', 'stream done', `chunks=${_chunkCount} bytes=${_totalBytes} reasoningChars=${fullReasoning.length} contentChars=${fullResponse.length}`);

            if (!usageReceived) {
                const estInput = Math.max(1, Math.ceil(promptChars / 4));
                const estOutput = Math.max(1, Math.ceil(outputChars / 4));
                lastInputTokens = estInput;
                lastOutputTokens = estOutput;
                applyUsage({
                    input_tokens: estInput,
                    output_tokens: estOutput,
                    total_tokens: estInput + estOutput
                });
            }

            history.push({ role: 'assistant', content: fullResponse });
            // 截断检测：finishReason='length' 表示上游打到了 max_tokens 上限被截断
            // 在 UI 末尾追加明显的提示，告诉用户"这是被截断的"
            let truncatedNote = '';
            if (typeof _finishReason === 'string' && _finishReason === 'length') {
                truncatedNote = '\n\n> ⚠️ **回答被 max_tokens 截断了**（模型输出达到上限）。如果需要更完整的回答，请换用 `deepseek-v4-pro`（maxOutput 384K）或精简输入。';
            }
            const r = typeof marked !== 'undefined' ? marked.parse(fullResponse + truncatedNote) : (fullResponse + truncatedNote);
            if (r instanceof Promise) r.then(html => setContent(contentDiv, html));
            else setContent(contentDiv, r);
            if (truncatedNote) chatLog('warn', 'response truncated', `finishReason=length output=${(fullResponse || '').length}chars`);

            // 云端持久化：assistant 消息由后端 live-stream 单一写入（routes/chat.js 里的 updateLiveMessage
            // 在流结束时已把内容 + token 落到 chat_messages）。前端不再调 appendMessage，避免重复行。
            // 只剩 AI 自动命名这步。（仅在新会话且无失败时）
            if (isNewSession && currentSessionId && pendingFirstUserText) {
                const firstText = pendingFirstUserText;
                isNewSession = false;
                pendingFirstUserText = null;
                triggerAiTitle(currentSessionId, firstText);
            }

        } catch (err) {
            clearTimeout(streamTimeoutId);
            contentDiv.classList.remove('typing');
            chatLog('err', 'CATCH', `name=${err.name} msg="${err.message}" chunks_seen=${typeof _chunkCount === 'number' ? _chunkCount : '?'} bytes_seen=${typeof _totalBytes === 'number' ? _totalBytes : '?'} partialResponse=${(fullResponse || '').length}ch`);
            if (err.name === 'AbortError') {
                // 思考超时 / 用户主动停止：部分正文由后端 live-stream + req.on('close') 兜底落库
                // 前端不再写，避免重复行。
                contentDiv.textContent = (fullResponse || '') + '\n[已停止生成]';
                if (fullResponse) {
                    history.push({ role: 'assistant', content: fullResponse });
                }
            } else {
                contentDiv.textContent = `[出错: ${err.message}]`;
            }
        } finally {
            setLoading(false);
            abortCtrl = null;
            currentAiDiv = null;
            clearInterval(thinkTimer);
            fetchQuota();
        }
    }

    function applyUsage(u) {
        if (!u) return;
        const input  = u.input_tokens  ?? u.prompt_tokens     ?? 0;
        const output = u.output_tokens ?? u.completion_tokens ?? 0;
        const total  = u.total_tokens  ?? (input + output);
        updateTotalTokens(total);
        if (currentAiDiv) {
            const tokenBtn = currentAiDiv.querySelector('.msg-token');
            if (tokenBtn) {
                tokenBtn._count.textContent = total.toLocaleString();
                const tipText = document.createElement('span');
                tipText.className = 'tip-text';
                tipText.textContent = `输入: ${input.toLocaleString()} | 输出: ${output.toLocaleString()}`;
                tokenBtn._tip.textContent = '';
                tokenBtn._tip.appendChild(tipText);
            }
        }
    }

    // ---- New chat (clear) ----
    // Exposed for the new-chat button (rendered in app.js)
    window.ChatModule = {
        newChat() {
            if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
            history.length = 0;
            totalTokens = 0;
            tokenCounter.textContent = '累计 0 tokens';
            chatScroll.innerHTML = '';
            if (chatWelcome) chatScroll.appendChild(chatWelcome);
            currentSessionId = null;
            isNewSession = false;
            pendingFirstUserText = null;
            // 通知抽屉：当前会话已变更
            window.dispatchEvent(new CustomEvent('chat:current-session-changed', { detail: { sessionId: null } }));
        },

        async loadSession(id) {
            if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) return false;
            if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
            const _lsT0 = Date.now();
            chatLog('info', 'loadSession start', `id=${id}`);

            const r = await window.ChatSessions.get(id);
            if (!r.ok) { chatLog('warn', 'loadSession failed', `id=${id} reason=${r.reason || r.message || '?'}`); return false; }

            const session = r.data.session;
            const messages = r.data.messages || [];

            // 切换 provider/model 到会话当时的设置
            if (session.provider) provider = session.provider;
            if (session.model_id) {
                modelId = session.model_id;
                saveState();
                applyThinkBtn();
                applyAttachBtn();
                refreshSidebarModel();
            }
            currentSessionId = session.id;
            isNewSession = false;
            pendingFirstUserText = null;

            // 清空 UI + history，重新渲染
            history.length = 0;
            totalTokens = 0;
            tokenCounter.textContent = '累计 0 tokens';
            chatScroll.innerHTML = '';

            // 0 条消息时把欢迎语补回去，避免空会话点进去一片空白
            if (messages.length === 0 && chatWelcome) {
                chatScroll.appendChild(chatWelcome);
            }

            // 重新构造 history 数组（OpenAI 格式）
            for (const m of messages) {
                let content = m.content;
                if (m.attachments) {
                    try {
                        const atts = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
                        if (Array.isArray(atts) && atts.length) {
                            const parts = [{ type: 'text', text: m.content }];
                            for (const a of atts) {
                                if (a.type === 'image') parts.push({ type: 'image_url', image_url: { url: a.url } });
                                else if (a.type === 'audio') parts.push({ type: 'audio', audio_url: { url: a.url } });
                            }
                            content = parts;
                        }
                    } catch {}
                }
                history.push({ role: m.role, content });
            }

            // 渲染消息
            for (const m of messages) {
                const atts = (() => {
                    try {
                        return typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
                    } catch { return null; }
                })();
                // 顺便看这条是不是还在生成（in_progress=1）→ 用 'live' 标记
                // 让 appendMsg 占位 reasoning block，方便后续 live update
                const isLive = m.is_in_progress === 1 || m.is_in_progress === '1';
                appendMsg(
                    m.role === 'user' ? 'user' : 'ai',
                    m.content,
                    m.role === 'user' ? atts : (isLive ? 'live' : null),
                    m.role === 'ai' ? (m.reasoning || '') : null
                );
            }

            // 累计 token
            for (const m of messages) {
                totalTokens += (m.input_tokens || 0) + (m.output_tokens || 0);
            }
            tokenCounter.textContent = `累计 ${totalTokens.toLocaleString()} tokens`;

            // 通知抽屉
            window.dispatchEvent(new CustomEvent('chat:current-session-changed', { detail: { sessionId: id } }));

            // 如果会话标题仍是默认值（前次 title gen 被刷新中断），触发 AI 生成
            if ((session.title || '') === '新对话') {
                triggerAiTitle(id, null);
            }

            chatLog('info', 'loadSession done', `id=${id} msgs=${messages.length} elapsed=${Date.now() - _lsT0}ms`);

            // ============ Live stream: 如果 AI 还在生成，订阅实时更新 ============
            loadLiveStream(id).catch((e) => chatLog('warn', 'loadLiveStream error', e.message));

            return true;
        },

        // 订阅 session 的 live stream（AI 还在生成时调用）
        async loadLiveStream(sessionId) {
            if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) return false;
            const token = localStorage.getItem('ai_token');
            if (!token) return false;
            // 找到最近一条 assistant 消息（就是要 live-update 的）
            const lastAi = chatScroll.querySelector('.msg.ai:last-of-type .msg-bubble');
            if (!lastAi) return false;
            const liveUrl = `https://api.oscarstudio.cn/api/chat-sessions/${sessionId}/stream`;
            chatLog('info', 'loadLiveStream', `session=${sessionId} url=${liveUrl}`);
            // EventSource 不支持自定义 header，用 URL query 传 token（后端需要支持）
            // 简单方案：fetch + ReadableStream（手动解析 SSE）
            const ctrl = new AbortController();
            liveStreamCtrl = ctrl;
            let _replayed = false;
            try {
                const resp = await fetch(liveUrl, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: ctrl.signal
                });
                if (resp.status === 404) {
                    chatLog('info', 'loadLiveStream no-active-stream', `session=${sessionId}`);
                    return false;
                }
                if (!resp.ok) {
                    chatLog('warn', 'loadLiveStream failed', `status=${resp.status}`);
                    return false;
                }
                const reader = resp.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                // 标记这是 live 模式：appendMsg 时如果是 live update 改 incremental append
                const contentDiv = lastAi.querySelector('.content');
                const reasoningDiv = lastAi.querySelector('.reasoning-body');
                if (contentDiv) contentDiv.classList.add('live-streaming');
                chatLog('info', 'loadLiveStream connected', `session=${sessionId}`);
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const lines = buf.split(/\r\n|\r|\n/);
                    buf = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.startsWith('data')) continue;
                        const s = line.slice(line.charAt(5) === ' ' ? 6 : 5);
                        if (!s) continue;
                        try {
                            const evt = JSON.parse(s);
                            if (evt.type === 'replay') {
                                _replayed = true;
                                // 替换 contentDiv 的内容
                                if (contentDiv && evt.text) {
                                    contentDiv.replaceChildren();
                                    const html = marked.parse(evt.text);
                                    const applyHtml = (h) => contentDiv.replaceChildren(DOMPurify.sanitize(h));
                                    if (html instanceof Promise) html.then(applyHtml);
                                    else applyHtml(html);
                                }
                                if (reasoningDiv && evt.reasoning) {
                                    reasoningDiv.textContent = evt.reasoning;
                                }
                                chatLog('info', 'loadLiveStream replayed', `text=${evt.text.length}ch reasoning=${evt.reasoning.length}ch`);
                            } else if (evt.type === 'delta') {
                                // 增量 append
                                if (contentDiv && evt.content) {
                                    // 简化：累加到一个隐藏变量，下次整体重渲染
                                    // 或者直接 append 文本节点
                                    contentDiv.appendChild(document.createTextNode(evt.content));
                                }
                                if (reasoningDiv && evt.reasoning) {
                                    reasoningDiv.appendChild(document.createTextNode(evt.reasoning));
                                }
                            } else if (evt.type === 'end') {
                                chatLog('info', 'loadLiveStream end', `reason=${evt.reason}`);
                                if (contentDiv) {
                                    // 重新解析（避免 textNode 拼接没走 markdown）
                                    const text = contentDiv.textContent;
                                    contentDiv.replaceChildren(DOMPurify.sanitize(marked.parse(text)));
                                }
                                if (contentDiv) contentDiv.classList.remove('live-streaming');
                                liveStreamCtrl = null;
                                return true;
                            } else if (evt.type === 'stale') {
                                chatLog('warn', 'loadLiveStream stale', '服务重启过，标记为 interrupted');
                                if (contentDiv && evt.text) {
                                    contentDiv.textContent = evt.text + '\n\n[本次回答因服务重启中断]';
                                }
                                if (contentDiv) contentDiv.classList.remove('live-streaming');
                                liveStreamCtrl = null;
                                return true;
                            }
                        } catch (e) { /* 忽略 parse 错误 */ }
                    }
                }
            } catch (e) {
                if (e.name !== 'AbortError') {
                    chatLog('warn', 'loadLiveStream error', e.message);
                }
            }
            liveStreamCtrl = null;
            return _replayed;
        },

        getCurrentSessionId() {
            return currentSessionId;
        },

        init() {
            applyThinkBtn();
            applyAttachBtn();
            refreshSidebarModel();
            fetchQuota();
        },
        // 暴露给 Arena 复用的模型目录
        MODEL_CONFIG,
        MULTIMODAL_MODELS,
    };

    // ============ 云端持久化辅助函数 ============

    async function ensureSessionForUser(firstUserContent) {
        if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) return null;
        if (currentSessionId) return currentSessionId;
        const r = await window.ChatSessions.create({
            provider,
            modelId
        });
        if (r.ok) {
            currentSessionId = r.data.session.id;
            isNewSession = true;
            window.dispatchEvent(new CustomEvent('chat:current-session-changed', { detail: { sessionId: currentSessionId } }));
            return currentSessionId;
        }
        return null;
    }

    // 触发 AI 标题生成（后台进行，不阻塞 UI）
    async function triggerAiTitle(sessionId, firstUserText) {
        if (!window.ChatSessions) return;
        try {
            const r = await window.ChatSessions.generateTitle(sessionId);
            if (r.ok && r.data.title) {
                // 通知抽屉更新
                window.dispatchEvent(new CustomEvent('chat:session-renamed', {
                    detail: { sessionId, title: r.data.title }
                }));
            }
        } catch (e) {
            // 静默失败，保留默认标题
            console.warn('[chat] AI title gen failed:', e.message);
        }
    }

    // 立即保存 user 消息（不等流结束；流被砍/超时/网络断都不会丢失）
    async function persistUserToCloud(userText, userAtts) {
        if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) return null;
        if (!currentSessionId) return null;
        try {
            const resp = await window.ChatSessions.appendMessage(currentSessionId, {
                role: 'user',
                content: userText,
                attachments: userAtts && userAtts.length ? userAtts.map(a => ({ type: a.type, url: a.url, name: a.name })) : null
            });
            if (resp.ok) {
                window.dispatchEvent(new CustomEvent('chat:session-updated', { detail: { sessionId: currentSessionId } }));
            } else {
                console.warn('[chat] persist user msg not ok:', resp.reason || resp.message);
            }
            return resp;
        } catch (e) {
            console.warn('[chat] persist user msg threw:', e.message);
            return null;
        }
    }

    // 注意：assistant 消息的云端落库完全由后端负责（API/routes/chat.js 的
    // updateLiveMessage / persistAssistantMessage）。前端不再 appendMessage，
    // 否则会和后端写同一行 → 历史里出现重复 AI 回复。
})();
