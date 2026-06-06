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

    // ---- Free models loader ----
    (async function loadFreeModels() {
        try {
            const r = await fetch('https://raw.githubusercontent.com/Oscarwang1222/openrouter-free-models/main/models-cn.json');
            const d = await r.json();
            MODEL_CONFIG.free.models = (d.models || []).map(m => ({
                id: m.id,
                name: (m.name || m.id).replace(/\s*\(free\)/gi, '').trim() + ' 🆓',
                free: true
            }));
            // If currently on free, refresh
            if (provider === 'free') renderModelList();
        } catch (e) {
            console.warn('[chat] free models load failed:', e);
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
            if (text) content.textContent = text;
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
                                    reasoningDiv.classList.remove('expanded');
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
                            reasoningDiv.classList.remove('expanded');
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
                            applyUsage(d);
                        } else if (d.usage) {
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
                applyUsage({
                    input_tokens: Math.max(1, Math.ceil(promptChars / 4)),
                    output_tokens: Math.max(1, Math.ceil(outputChars / 4)),
                    total_tokens: Math.max(1, Math.ceil((promptChars + outputChars) / 4))
                });
            }

            history.push({ role: 'assistant', content: fullResponse });
            const r = typeof marked !== 'undefined' ? marked.parse(fullResponse) : fullResponse;
            if (r instanceof Promise) r.then(html => setContent(contentDiv, html));
            else setContent(contentDiv, r);

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
        },
        init() {
            applyThinkBtn();
            applyAttachBtn();
            refreshSidebarModel();
            fetchQuota();
        }
    };
})();
