// =====================================================
// AI Studio — Chat module
//   文本对话、多模态附件、深度思考、流式输出
//   模型选择：模态框二级选择（vendor + model）
// =====================================================

(function () {
    'use strict';

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
                { id: 'MiniMax-M3',  name: 'M3',  think: true },
                { id: 'MiniMax-M2.7', name: 'M2.7', think: true }
            ]
        },
        mimo: {
            name: 'MiMo',
            models: [
                { id: 'mimo-v2-flash',  name: 'V2-Flash' },
                { id: 'mimo-v2.5',      name: 'V2.5',     multi: true },
                { id: 'mimo-v2.5-pro',  name: 'V2.5-Pro', premium: true, multi: true }
            ]
        },
        qwen: {
            name: 'Qwen',
            models: [
                { id: 'qwen/qwen3.6-flash', name: 'Qwen3.6-Flash', multi: true },
                { id: 'qwen/qwen3.6-plus',  name: 'Qwen3.6-Plus',  multi: true, premium: true },
                { id: 'qwen/qwen3.7-max',   name: 'Qwen3.7-Max',   multi: true, premium: true }
            ]
        },
        zai: {
            name: 'GLM',
            models: [
                { id: 'z-ai/glm-4.7-flash', name: 'GLM-4.7-Flash', multi: true },
                { id: 'z-ai/glm-5v-turbo',  name: 'GLM-5V-Turbo',  multi: true, premium: true },
                { id: 'z-ai/glm-5',         name: 'GLM-5',         premium: true },
                { id: 'z-ai/glm-5.1',       name: 'GLM-5.1',       premium: true }
            ]
        },
        moonshot: {
            name: 'Kimi',
            models: [
                { id: 'moonshotai/kimi-k2.5', name: 'Kimi-K2.5', multi: true, premium: true },
                { id: 'moonshotai/kimi-k2.6', name: 'Kimi-K2.6', multi: true, premium: true }
            ]
        },
        hy3: {
            name: 'Tencent',
            models: [
                { id: 'tencent/hy3-preview', name: 'Hy3-Preview', premium: true }
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
        'qwen/qwen3.6-flash', 'qwen/qwen3.6-plus', 'qwen/qwen3.7-max',
        'z-ai/glm-5v-turbo', 'z-ai/glm-4.7-flash',
        'moonshotai/kimi-k2.5', 'moonshotai/kimi-k2.6',
        'x-ai/grok-4.3',
        'mimo-v2.5', 'mimo-v2.5-pro'
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
            li.innerHTML = `
                <span class="vendor-name">${cfg.name}</span>
                <span class="vendor-count">${cfg.models.length}</span>
            `;
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
            li.innerHTML = `
                <div class="model-row">
                    <span class="model-name">${m.name}</span>
                    <span class="model-id">${m.id}</span>
                </div>
                <div class="model-badges">${badges.join('')}</div>
            `;
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
        sidebarModelVendor.textContent = cfg.name;
        sidebarModelName.textContent = m ? m.name : modelId;
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

    function appendMsg(role, text, meta) {
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
            tokenBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg><span>—</span>`;
            const tip = document.createElement('span');
            tip.className = 'token-tip';
            tip.innerHTML = '输入: <span>—</span> &nbsp;|&nbsp; 输出: <span>—</span>';
            tokenBtn.appendChild(tip);
            tokenBtn._tip = tip;
            tokenBtn._count = tokenBtn.querySelector('span');
            metaRow.appendChild(tokenBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action';
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>复制`;
        copyBtn.addEventListener('click', () => {
            const src = role === 'ai'
                ? bubble.querySelector('.content')?.textContent || ''
                : bubble.textContent || '';
            navigator.clipboard.writeText(src).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>已复制`;
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>复制`;
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
        el.innerHTML = DOMPurify.sanitize(html);
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
        appendMsg('user', text, sentAtts);
        history.push(buildContent(text, sentAtts));
        attachments = [];
        renderAttachPreview();
        setLoading(true);

        // 云端持久化：确保会话存在
        await ensureSessionForUser(text);
        if (isNewSession) {
            pendingFirstUserText = text;
        }

        const aiDiv = appendMsg('ai', '');
        currentAiDiv = aiDiv;

        // Reasoning block
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'reasoning-block';
        const reasoningHeader = document.createElement('div');
        reasoningHeader.className = 'reasoning-header';
        reasoningHeader.innerHTML = `<span class="think-label">思考中</span><span class="think-time"></span><span class="think-arrow">▶</span>`;
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
            stream: true
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

            const timeoutId = setTimeout(() => abortCtrl.abort(), 60000);
            const resp = await fetch('https://api.oscarstudio.cn/api/chat', {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: abortCtrl.signal
            });
            clearTimeout(timeoutId);

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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
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
                                contentDiv.innerHTML = DOMPurify.sanitize(html);
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
            const r = typeof marked !== 'undefined' ? marked.parse(fullResponse) : fullResponse;
            if (r instanceof Promise) r.then(html => setContent(contentDiv, html));
            else setContent(contentDiv, r);

            // 云端持久化：先写 user，再写 assistant（有序防 seq 冲突）
            await persistTurnToCloud({
                userText: text,
                userAtts: sentAtts,
                assistantText: fullResponse,
                assistantReasoning: fullReasoning,
                inputTokens: lastInputTokens,
                outputTokens: lastOutputTokens
            });

            // 首轮后 AI 自动命名（仅在新会话且无失败时）
            if (isNewSession && currentSessionId && pendingFirstUserText) {
                const firstText = pendingFirstUserText;
                isNewSession = false;
                pendingFirstUserText = null;
                triggerAiTitle(currentSessionId, firstText);
            }

        } catch (err) {
            contentDiv.classList.remove('typing');
            if (err.name === 'AbortError') {
                contentDiv.textContent = (fullResponse || '') + '\n[已停止生成]';
                if (fullResponse) history.push({ role: 'assistant', content: fullResponse });
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
                tokenBtn._tip.innerHTML = `输入: <span>${input.toLocaleString()}</span> &nbsp;|&nbsp; 输出: <span>${output.toLocaleString()}</span>`;
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

            const r = await window.ChatSessions.get(id);
            if (!r.ok) return false;

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
                appendMsg(m.role === 'user' ? 'user' : 'ai', m.content, m.role === 'user' ? atts : null);
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

            return true;
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

    async function persistTurnToCloud({ userText, userAtts, assistantText, assistantReasoning, inputTokens, outputTokens }) {
        if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) return;
        if (!currentSessionId) return; // ensureSessionForUser 没成功

        // 先写 user，等 seq 确认后再写 assistant，防止 seq 冲突
        const userResp = await window.ChatSessions.appendMessage(currentSessionId, {
            role: 'user',
            content: userText,
            attachments: userAtts && userAtts.length ? userAtts.map(a => ({ type: a.type, url: a.url, name: a.name })) : null
        });
        if (userResp.ok && userResp.data && userResp.data.title) {
            window.dispatchEvent(new CustomEvent('chat:session-renamed', { detail: { sessionId: currentSessionId, title: userResp.data.title } }));
        }

        // 再写 assistant
        const asstResp = await window.ChatSessions.appendMessage(currentSessionId, {
            role: 'assistant',
            content: assistantText,
            reasoning: assistantReasoning || null,
            inputTokens: inputTokens || 0,
            outputTokens: outputTokens || 0
        });
        if (asstResp.ok) {
            window.dispatchEvent(new CustomEvent('chat:session-updated', { detail: { sessionId: currentSessionId } }));
        }
    }
})();
