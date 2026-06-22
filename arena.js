// =====================================================
// AI Studio — Arena 模型评测
//   同一问题，多个模型并行回答；1-5 星匿名评分
//   - 复用 chat.js 的 MODEL_CONFIG 与 MULTIMODAL_MODELS
//   - 实时 credit 预估（GET /api/arena/pricing）
//   - SSE 流式接收每个模型的回答
//   - 投票提交给 POST /api/arena/vote
//   - 我的历史 GET /api/arena/mine
// =====================================================

(function () {
    'use strict';

    const API_BASE   = 'https://api.oscarstudio.cn/api/arena';
    const MAX_MODELS = 4;
    const STORAGE_VIEW = 'ai_studio_view';   // 与 app.js 共用
    const TOKEN_KEY    = 'ai_token';

    // ============ 模型源（来自 chat.js）============
    const MODEL_CONFIG    = (window.ChatModule && window.ChatModule.MODEL_CONFIG) || {};
    const MULTIMODAL_LIST = (window.ChatModule && window.ChatModule.MULTIMODAL_MODELS) || [];

    // ============ DOM ============
    const $ = (id) => document.getElementById(id);

    const arenaPickBtn       = $('arenaPickBtn');
    const arenaPickLabel     = $('arenaPickLabel');
    const arenaPickChips     = $('arenaPickChips');
    const arenaPickCounter   = $('arenaPickCounter');
    const arenaQuestion      = $('arenaQuestion');
    const arenaCharCount     = $('arenaCharCount');
    const arenaAnonymous     = $('arenaAnonymous');
    const arenaEstCredits    = $('arenaEstCredits');
    const arenaRemainingCredits = $('arenaRemainingCredits');
    const arenaEstWarn       = $('arenaEstWarn');
    const arenaStartBtn      = $('arenaStartBtn');
    const arenaAttachBtn     = $('arenaAttachBtn');
    const arenaAttachHint    = $('arenaAttachHint');
    const arenaFileInput     = $('arenaFileInput');
    const arenaAttachPreview = $('arenaAttachPreview');
    const arenaMultimodalWarn = $('arenaMultimodalWarn');
    const arenaMultiCount    = $('arenaMultiCount');
    const arenaGrid          = $('arenaGrid');
    const arenaEmpty         = $('arenaEmpty');
    const arenaFinalActions  = $('arenaFinalActions');
    const arenaSubmitVoteBtn = $('arenaSubmitVoteBtn');
    const arenaVotedCount    = $('arenaVotedCount');
    const arenaTotalCount    = $('arenaTotalCount');
    const arenaResetBtn      = $('arenaResetBtn');
    const arenaHistoryList   = $('arenaHistoryList');

    const arenaModelModal    = $('arenaModelModal');
    const arenaModelModalClose = $('arenaModelModalClose');
    const arenaVendorList    = $('arenaVendorList');
    const arenaModelList     = $('arenaModelList');

    // ============ State ============
    let pricingCache = {};              // { model_id: {input, output, max_output, is_free} }
    let pricingFetched = false;
    let selectedModels = [];            // [{provider, id, name, vendor, isMulti}]
    let attachments = [];                // [{type:'image'|'audio', url, name}]
    let remainingCredits = null;
    let battleAbortCtrl = null;         // 当前评测的 AbortController
    let currentBattle = null;           // 当前评测状态：{question_id, slots: {A:{...}, B:{...}...}, votes: {}}

    // ============ 工具函数 ============
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function getAuthHeaders() {
        const t = getToken();
        return t ? { 'Authorization': `Bearer ${t}` } : {};
    }

    function getCurrentProvider() {
        if (selectedModels.length) return selectedModels[0].provider;
        return null;
    }

    function getModelMeta(modelId) {
        for (const [pkey, cfg] of Object.entries(MODEL_CONFIG)) {
            for (const m of (cfg.models || [])) {
                if (m.id === modelId) {
                    return {
                        provider: pkey,
                        vendor: cfg.name,
                        name: m.name,
                        isMulti: MULTIMODAL_LIST.includes(modelId),
                        isFree: !!m.free,
                        isPremium: !!m.premium,
                    };
                }
            }
        }
        return null;
    }

    // ============ Pricing 加载 ============
    async function loadPricing() {
        if (pricingFetched) return;
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 5000);
            const r = await fetch(API_BASE + '/pricing', { signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) return;
            const d = await r.json();
            if (d && d.success && d.pricing) {
                pricingCache = d.pricing;
                pricingFetched = true;
            }
        } catch (e) {
            // 静默失败：预估会显示 —
        }
    }

    // ============ 配额 ============
    async function fetchRemaining() {
        const t = getToken();
        if (!t) { remainingCredits = null; updateRemainingUI(); return; }
        try {
            const r = await fetch('https://api.oscarstudio.cn/api/user', {
                headers: { 'Authorization': `Bearer ${t}` }
            });
            const d = await r.json();
            if (d.success && d.user) {
                remainingCredits = d.user.quota?.credits?.remaining ?? null;
            }
        } catch (e) {
            // 静默
        }
        updateRemainingUI();
    }

    function updateRemainingUI() {
        if (remainingCredits === null) {
            arenaRemainingCredits.textContent = '—';
            arenaRemainingCredits.classList.remove('is-low');
            return;
        }
        arenaRemainingCredits.textContent = remainingCredits.toLocaleString() + ' credits';
        arenaRemainingCredits.classList.toggle('is-low', remainingCredits <= 50);
    }

    // ============ 预估消耗 ============
    function recalcEstimate() {
        if (!selectedModels.length) {
            arenaEstCredits.textContent = '— credits';
            arenaEstWarn.hidden = true;
            updateStartButton();
            return;
        }

        const inputChars = (arenaQuestion.value || '').length
            + attachments.reduce((s, a) => s + (a.url?.length || 0), 0);
        const outputEstimate = 1500; // 与后端常量对齐

        let total = 0;
        let hasPaid = false;
        for (const m of selectedModels) {
            const p = pricingCache[m.id];
            if (!p) continue;
            if (p.is_free || p.input === 0) continue; // 免费模型不计
            hasPaid = true;
            const inTok  = Math.ceil(inputChars / 4);
            const outTok = outputEstimate;
            total += Math.ceil(inTok * p.input) + Math.ceil(outTok * p.output);
        }

        if (!hasPaid) {
            arenaEstCredits.textContent = '0 credits（均为免费模型）';
            arenaEstCredits.classList.remove('is-low');
            arenaEstWarn.hidden = true;
        } else if (!pricingCache || Object.keys(pricingCache).length === 0) {
            arenaEstCredits.textContent = '加载中…';
            arenaEstWarn.hidden = true;
        } else {
            arenaEstCredits.textContent = total.toLocaleString() + ' credits';
            const over = (remainingCredits !== null && total > remainingCredits);
            arenaEstCredits.classList.toggle('is-low', over);
            if (over) {
                arenaEstWarn.hidden = false;
                arenaEstWarn.textContent = `预估 ${total} 超过剩余 ${remainingCredits}，无法开始评测`;
            } else {
                arenaEstWarn.hidden = true;
            }
        }

        updateStartButton();
    }

    function updateStartButton() {
        const ok = selectedModels.length >= 1
            && (arenaQuestion.value || '').trim().length > 0
            && !isStarting()
            && !(remainingCredits !== null && getEstimateTotal() > remainingCredits);
        arenaStartBtn.disabled = !ok;
    }

    function getEstimateTotal() {
        if (!selectedModels.length) return 0;
        const inputChars = (arenaQuestion.value || '').length
            + attachments.reduce((s, a) => s + (a.url?.length || 0), 0);
        let total = 0;
        for (const m of selectedModels) {
            const p = pricingCache[m.id];
            if (!p || p.is_free || p.input === 0) continue;
            const inTok = Math.ceil(inputChars / 4);
            total += Math.ceil(inTok * p.input) + Math.ceil(1500 * p.output);
        }
        return total;
    }

    function isStarting() {
        return arenaStartBtn.dataset.starting === '1';
    }

    // ============ 模型选择 Modal ============
    function openModelModal() {
        arenaModelModal.hidden = false;
        renderVendorList();
        renderModelList();
    }
    function closeModelModal() {
        arenaModelModal.hidden = true;
    }
    function renderVendorList() {
        arenaVendorList.innerHTML = '';
        const currentProvider = getCurrentProvider() || 'deepseek';
        Object.keys(MODEL_CONFIG).forEach(key => {
            const cfg = MODEL_CONFIG[key];
            const li = document.createElement('li');
            li.className = key === currentProvider ? 'active' : '';
            li.innerHTML = `
                <span class="vendor-name">${escapeHtml(cfg.name)}</span>
                <span class="vendor-count">${cfg.models.length}</span>
            `;
            li.addEventListener('click', () => {
                // 重置 selectedModels 的 provider highlight 用
                renderModelList(key);
                // 高亮切换
                arenaVendorList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
            });
            arenaVendorList.appendChild(li);
        });
    }
    function renderModelList(forceProvider) {
        const provider = forceProvider || getCurrentProvider() || 'deepseek';
        const cfg = MODEL_CONFIG[provider];
        arenaModelList.innerHTML = '';
        if (!cfg || !cfg.models.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = '暂无可用模型';
            arenaModelList.appendChild(li);
            return;
        }
        cfg.models.forEach(m => {
            const li = document.createElement('li');
            const isSelected = selectedModels.some(x => x.id === m.id);
            const isMaxed = selectedModels.length >= MAX_MODELS && !isSelected;
            li.className = (isSelected ? 'active' : '') + (isMaxed ? ' disabled' : '');
            if (isMaxed) li.style.opacity = '0.4';
            const badges = [];
            if (m.free)    badges.push('<span class="model-badge free">FREE</span>');
            if (m.premium) badges.push('<span class="model-badge">PRO</span>');
            if (MULTIMODAL_LIST.includes(m.id)) badges.push('<span class="model-badge multi">MULTI</span>');
            li.innerHTML = `
                <div class="model-row">
                    <span class="model-name">${escapeHtml(m.name)}</span>
                    <span class="model-id">${escapeHtml(m.id)}</span>
                </div>
                <div class="model-badges">${badges.join('')}</div>
            `;
            li.addEventListener('click', () => {
                if (isSelected) {
                    selectedModels = selectedModels.filter(x => x.id !== m.id);
                } else {
                    if (selectedModels.length >= MAX_MODELS) return;
                    selectedModels.push({
                        provider,
                        id: m.id,
                        name: m.name,
                        vendor: cfg.name,
                        isMulti: MULTIMODAL_LIST.includes(m.id),
                        isFree: !!m.free,
                        isPremium: !!m.premium,
                    });
                }
                renderPickChips();
                renderModelList(provider);
                recalcEstimate();
            });
            arenaModelList.appendChild(li);
        });
    }
    function renderPickChips() {
        arenaPickChips.innerHTML = '';
        selectedModels.forEach((m, i) => {
            const chip = document.createElement('div');
            chip.className = 'arena-chip';
            chip.innerHTML = `
                <span class="arena-chip-vendor">${escapeHtml(m.vendor)}</span>
                <span class="arena-chip-name">${escapeHtml(m.name)}</span>
                <button class="arena-chip-remove" type="button" data-idx="${i}" aria-label="移除">✕</button>
            `;
            arenaPickChips.appendChild(chip);
        });
        arenaPickCounter.textContent = `${selectedModels.length}/${MAX_MODELS}`;
        arenaPickCounter.classList.toggle('full', selectedModels.length >= MAX_MODELS);
        if (selectedModels.length === 0) {
            arenaPickLabel.textContent = '点击选择模型（最多 4 个）';
        } else {
            arenaPickLabel.textContent = `已选 ${selectedModels.length} 个，点击可继续修改`;
        }
    }
    arenaPickChips.addEventListener('click', (e) => {
        const btn = e.target.closest('.arena-chip-remove');
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx, 10);
        if (Number.isInteger(idx)) {
            selectedModels.splice(idx, 1);
            renderPickChips();
            recalcEstimate();
            updateMultiWarning();
        }
    });

    arenaPickBtn.addEventListener('click', openModelModal);
    arenaModelModalClose.addEventListener('click', closeModelModal);
    arenaModelModal.addEventListener('click', (e) => {
        if (e.target === arenaModelModal) closeModelModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && arenaModelModal && !arenaModelModal.hidden) {
            closeModelModal();
        }
    });

    // 监听 chat.js 的 free 模型加载完成事件，刷新 picker
    window.addEventListener('chat:free-models-loaded', () => {
        if (arenaModelModal && !arenaModelModal.hidden) {
            renderVendorList();
            renderModelList();
        }
    });

    // ============ 问题输入联动 ============
    arenaQuestion.addEventListener('input', () => {
        const n = arenaQuestion.value.length;
        arenaCharCount.textContent = n.toLocaleString();
        arenaCharCount.classList.toggle('over', n > 8000);
        recalcEstimate();
    });

    arenaAnonymous.addEventListener('change', () => {
        // 仅 UI 状态，不需要重算
    });

    // ============ 附件 ============
    arenaAttachBtn.addEventListener('click', () => arenaFileInput.click());
    arenaFileInput.addEventListener('change', async () => {
        for (const file of Array.from(arenaFileInput.files || [])) {
            const isImage = file.type.startsWith('image/');
            const isAudio = file.type.startsWith('audio/');
            if (!isImage && !isAudio) continue;
            // 文件大小限制 10MB（与后端一致）
            if (file.size > 10 * 1024 * 1024) {
                alert(`${file.name} 超过 10MB，已跳过`);
                continue;
            }
            const url = await new Promise(r => {
                const fr = new FileReader();
                fr.onload = e => r(e.target.result);
                fr.readAsDataURL(file);
            });
            attachments.push({ type: isImage ? 'image' : 'audio', url, name: file.name });
        }
        arenaFileInput.value = '';
        renderAttachPreview();
        updateMultiWarning();
        recalcEstimate();
    });

    function renderAttachPreview() {
        arenaAttachPreview.innerHTML = '';
        if (!attachments.length) {
            arenaAttachHint.textContent = '未选择附件';
            return;
        }
        arenaAttachHint.textContent = `已选 ${attachments.length} 个附件`;
        attachments.forEach((att, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'arena-attach-thumb';
            if (att.type === 'image') {
                const img = document.createElement('img');
                img.src = att.url;
                img.addEventListener('click', () => window.open(att.url, '_blank'));
                wrap.appendChild(img);
            } else {
                const t = document.createElement('div');
                t.className = 'attach-type';
                t.textContent = '♪ AUDIO';
                wrap.appendChild(t);
            }
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'remove';
            rm.textContent = '✕';
            rm.addEventListener('click', () => {
                attachments.splice(i, 1);
                renderAttachPreview();
                updateMultiWarning();
                recalcEstimate();
            });
            wrap.appendChild(rm);
            arenaAttachPreview.appendChild(wrap);
        });
    }

    function updateMultiWarning() {
        if (attachments.length === 0 || selectedModels.length === 0) {
            arenaMultimodalWarn.hidden = true;
            return;
        }
        const nonMulti = selectedModels.filter(m => !m.isMulti).length;
        if (nonMulti > 0) {
            arenaMultiCount.textContent = nonMulti;
            arenaMultimodalWarn.hidden = false;
        } else {
            arenaMultimodalWarn.hidden = true;
        }
    }

    // ============ 当前评测：Grid 渲染 ============
    function renderEmptyState() {
        arenaEmpty.style.display = '';
        arenaGrid.innerHTML = '';
        arenaFinalActions.hidden = true;
    }

    function createCardElement(slot, modelMeta, hideModels) {
        const card = document.createElement('div');
        card.className = 'arena-card is-streaming';
        card.dataset.slot = slot;
        // header 中的模型名：仅在非隐藏模式下显示
        const modelLabel = (!hideModels && modelMeta)
            ? `${modelMeta.vendor} · ${modelMeta.name}`
            : '';
        const headerRight = modelLabel
            ? `<span class="arena-card-model" data-model-label>${escapeHtml(modelLabel)}</span>`
            : '';
        card.innerHTML = `
            <div class="arena-card-header">
                <div class="arena-card-header-left">
                    <span class="arena-card-slot">${slot}</span>
                    ${headerRight}
                </div>
                <span class="arena-card-status is-streaming" data-status>PREPARING</span>
            </div>
            <div class="arena-card-body typing" data-body>
                <span class="arena-card-empty">排队中...</span>
            </div>
            <div class="arena-card-footer" data-footer style="display:none">
                <div class="arena-card-meta">
                    <span data-meta-text>—</span>
                    <span class="arena-card-meta-cost" data-meta-cost></span>
                </div>
                <div data-vote-area></div>
            </div>
        `;
        arenaGrid.appendChild(card);
        return card;
    }

    function setCardStatus(card, status, label) {
        card.classList.remove('is-streaming', 'is-done', 'is-error');
        card.classList.add('is-' + status);
        const statusEl = card.querySelector('[data-status]');
        statusEl.classList.remove('is-streaming', 'is-done', 'is-error');
        statusEl.classList.add('is-' + status);
        statusEl.textContent = label;
    }

    function setCardBody(card, text, append = false) {
        const body = card.querySelector('[data-body]');
        body.classList.add('typing');
        // 简单 markdown 处理（粗体、行内代码、代码块）
        let html = renderMarkdownLite(text);
        if (append && body._rawText) {
            body._rawText += text;
        } else {
            body._rawText = text;
        }
        // 因为每次 append 都重算整段 markdown 性能不好，但简单可靠
        body.innerHTML = renderMarkdownLite(body._rawText);
        scrollCardToBottom(card);
    }

    function renderMarkdownLite(text) {
        if (!text) return '<span class="arena-card-empty">排队中...</span>';
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

    function scrollCardToBottom(card) {
        const body = card.querySelector('[data-body]');
        body.scrollTop = body.scrollHeight;
    }

    function finalizeCard(card, opts) {
        const { status, modelMeta, creditsUsed, latencyMs, inputTokens, outputTokens, error } = opts;
        const body = card.querySelector('[data-body]');
        body.classList.remove('typing');

        setCardStatus(card, status,
            status === 'done' ? `${Math.round(latencyMs/100)/10}s · ✓`
            : status === 'error' ? 'FAILED'
            : status === 'done-no-vote' ? 'DONE'
            : status.toUpperCase());

        const footer = card.querySelector('[data-footer]');
        footer.style.display = '';

        // 元信息
        const metaText = card.querySelector('[data-meta-text]');
        const metaCost = card.querySelector('[data-meta-cost]');
        if (status === 'done' || status === 'done-no-vote') {
            metaText.textContent = `↑ ${inputTokens} · ↓ ${outputTokens}`;
            metaCost.textContent = `${creditsUsed.toLocaleString()} credits`;
        } else {
            metaText.textContent = '—';
            metaCost.textContent = '';
            body.innerHTML = `<div class="arena-card-error">⚠ ${escapeHtml(error || '回答失败')}</div>`;
        }

        // 评分区（仅作者本人可以给自己题目评分？ 不可以。所以此处只展示收集，但不写入 vote 表）
        // 按需求：作者不可自评。所以评分区仅在「等待他人评分」状态下显示为只读说明，不出现交互。
        // MVP：作者查看自己的评测时，不显示评分 UI（避免歧义）。
        const voteArea = card.querySelector('[data-vote-area]');
        voteArea.innerHTML = `
            <div class="arena-vote-label" style="color: var(--body-mid); font-style: italic;">
                你是出题人，无法自评
            </div>
        `;
    }

    // ============ 启动评测 ============
    arenaStartBtn.addEventListener('click', startBattle);

    async function startBattle() {
        if (!selectedModels.length) return alert('请至少选择 1 个模型');
        if (!arenaQuestion.value.trim()) return alert('请输入评测问题');
        if (!getToken()) return alert('请先登录后再使用 Arena');

        // 多模态确认
        if (attachments.length > 0) {
            const nonMulti = selectedModels.filter(m => !m.isMulti);
            if (nonMulti.length) {
                const ok = confirm(
                    `${nonMulti.length} 个模型不支持图片/音频，附件将被忽略。继续吗？`
                );
                if (!ok) return;
            }
        }

        arenaStartBtn.dataset.starting = '1';
        arenaStartBtn.disabled = true;
        arenaStartBtn.querySelector('span:last-child').textContent = '评测中…';

        // 准备卡片
        arenaEmpty.style.display = 'none';
        arenaGrid.innerHTML = '';
        arenaFinalActions.hidden = true;
        // hideModels 用于控制卡片 header 是否显示模型名
        const hideModels = arenaAnonymous.checked;
        currentBattle = { question_id: null, slots: {}, votes: {}, ok_count: 0, total: 0, hide_models: hideModels };

        const slotLabels = ['A', 'B', 'C', 'D'];
        // 随机打乱顺序（slot 随机分配，模型名按 hideModels 决定是否暴露）
        const shuffled = [...selectedModels];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.forEach((m, i) => {
            const slot = slotLabels[i];
            const card = createCardElement(slot, m, hideModels);
            currentBattle.slots[slot] = {
                card,
                model: m,
                response_id: null,
                status: 'pending',
                text: '',
                credits: 0,
                latency: 0,
                input_tokens: 0,
                output_tokens: 0,
                error: null,
            };
        });

        // 流式接收 SSE
        battleAbortCtrl = new AbortController();
        try {
            await streamBattle(currentBattle, battleAbortCtrl.signal);
        } catch (err) {
            console.error('[Arena] stream error:', err);
            alert('评测出错: ' + err.message);
        } finally {
            arenaStartBtn.dataset.starting = '';
            arenaStartBtn.disabled = false;
            arenaStartBtn.querySelector('span:last-child').textContent = '开始评测';
            battleAbortCtrl = null;
            // 刷新剩余配额
            fetchRemaining();
        }
    }

    async function streamBattle(battle, signal) {
        const t = getToken();
        const body = {
            question: arenaQuestion.value,
            hide_model_names: arenaAnonymous.checked,
            attachments: attachments.map(a => ({ type: a.type, url: a.url, name: a.name })),
            model_ids: Object.values(battle.slots).map(s => s.model.id),
            thinking: true,
        };

        const r = await fetch(API_BASE + '/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(t ? { 'Authorization': `Bearer ${t}` } : {}),
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!r.ok) {
            const ed = await r.json().catch(() => ({}));
            throw new Error(ed.message || `HTTP ${r.status}`);
        }
        if (!r.body) throw new Error('空响应');

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let active = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split(/\r\n|\r|\n/);
            buf = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const s = line.slice(5).trim();
                if (!s) continue;
                let evt;
                try { evt = JSON.parse(s); } catch { continue; }

                handleSSEEvent(battle, evt);
                if (evt.type === 'battle_complete' || evt.type === 'battle_error') {
                    active = false;
                }
            }
        }

        // 所有卡片 finalize（如未完成）
        for (const slot of Object.keys(battle.slots)) {
            const s = battle.slots[slot];
            if (s.status === 'pending' || s.status === 'streaming') {
                s.status = 'error';
                s.error = '未收到结果';
                finalizeCard(s.card, {
                    status: 'error',
                    modelMeta: s.model,
                    creditsUsed: 0,
                    latencyMs: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    error: '未收到结果',
                });
            }
        }
    }

    function handleSSEEvent(battle, evt) {
        switch (evt.type) {
            case 'battle_start': {
                battle.question_id = evt.question_id;
                // 更新每张卡片的"待流式"提示（按 slot）
                for (const slot of Object.keys(battle.slots)) {
                    const s = battle.slots[slot];
                    const body = s.card.querySelector('[data-body]');
                    if (body) body.innerHTML = '<span class="arena-card-empty">连接中...</span>';
                }
                break;
            }
            case 'slot_start': {
                const s = battle.slots[evt.slot];
                if (!s) return;
                s.response_id = evt.response_id;
                s.status = 'streaming';
                setCardStatus(s.card, 'streaming', 'STREAMING');
                const body = s.card.querySelector('[data-body]');
                body.innerHTML = '';
                break;
            }
            case 'slot_delta': {
                const s = battle.slots[evt.slot];
                if (!s) return;
                s.text += evt.delta || '';
                setCardBody(s.card, s.text);
                break;
            }
            case 'slot_reasoning': {
                const s = battle.slots[evt.slot];
                if (!s) return;
                // 推理内容折叠显示在顶部
                s.reasoning = (s.reasoning || '') + (evt.delta || '');
                // 简化处理：累加到 body 顶部折叠区
                let block = s.card.querySelector('[data-reasoning]');
                if (!block) {
                    block = document.createElement('details');
                    block.className = 'arena-reasoning';
                    block.setAttribute('data-reasoning', '');
                    block.innerHTML = '<summary>思考过程</summary><div class="arena-reasoning-body"></div>';
                    const body = s.card.querySelector('[data-body]');
                    body.parentNode.insertBefore(block, body);
                }
                block.querySelector('.arena-reasoning-body').textContent = s.reasoning;
                break;
            }
            case 'slot_done': {
                const s = battle.slots[evt.slot];
                if (!s) return;
                s.status = 'done';
                s.credits = evt.credits_used || 0;
                s.latency = evt.latency_ms || 0;
                s.input_tokens = evt.input_tokens || 0;
                s.output_tokens = evt.output_tokens || 0;
                finalizeCard(s.card, {
                    status: 'done-no-vote',
                    modelMeta: s.model,
                    creditsUsed: s.credits,
                    latencyMs: s.latency,
                    inputTokens: s.input_tokens,
                    outputTokens: s.output_tokens,
                });
                break;
            }
            case 'slot_error': {
                const s = battle.slots[evt.slot];
                if (!s) return;
                s.status = 'error';
                s.error = evt.message || '未知错误';
                finalizeCard(s.card, {
                    status: 'error',
                    modelMeta: s.model,
                    creditsUsed: 0,
                    latencyMs: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    error: s.error,
                });
                break;
            }
            case 'battle_complete': {
                battle.ok_count = evt.ok || 0;
                battle.total = evt.total || 0;
                battle.actual_credits = evt.actual_credits || 0;
                arenaFinalActions.hidden = false;
                arenaTotalCount.textContent = String(battle.ok_count);
                arenaVotedCount.textContent = '0';
                arenaSubmitVoteBtn.disabled = true;
                if (battle.ok_count === 0) {
                    arenaSubmitVoteBtn.textContent = '所有模型都失败了';
                    arenaSubmitVoteBtn.disabled = true;
                } else {
                    arenaSubmitVoteBtn.innerHTML = '所有回答已生成（作者不可自评）';
                    arenaSubmitVoteBtn.disabled = true;
                }
                break;
            }
            case 'battle_error': {
                alert('评测失败: ' + (evt.message || '未知错误'));
                break;
            }
        }
    }

    // ============ 重置按钮 ============
    arenaResetBtn.addEventListener('click', () => {
        arenaQuestion.value = '';
        attachments = [];
        renderAttachPreview();
        updateMultiWarning();
        arenaAnonymous.checked = false;
        renderEmptyState();
        arenaCharCount.textContent = '0';
        recalcEstimate();
    });

    // ============ Tab 切换 ============
    document.querySelectorAll('.arena-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.arena-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.arena-panel').forEach(p => {
                p.classList.toggle('active', p.dataset.tab === target);
            });
            if (target === 'history') loadHistory();
        });
    });

    // ============ 我的历史 ============
    async function loadHistory() {
        const t = getToken();
        if (!t) {
            arenaHistoryList.innerHTML = '<div class="arena-history-empty">请先登录后查看历史</div>';
            return;
        }
        try {
            const r = await fetch(API_BASE + '/mine?limit=50', {
                headers: { 'Authorization': `Bearer ${t}` },
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || '加载失败');
            renderHistoryList(d.battles || []);
        } catch (e) {
            arenaHistoryList.innerHTML = `<div class="arena-history-empty">加载失败: ${escapeHtml(e.message)}</div>`;
        }
    }

    function renderHistoryList(list) {
        if (!list.length) {
            arenaHistoryList.innerHTML = '<div class="arena-history-empty">暂无评测历史</div>';
            return;
        }
        arenaHistoryList.innerHTML = '';
        list.forEach(b => {
            const card = document.createElement('div');
            card.className = 'arena-history-card';

            let models = [];
            try { models = JSON.parse(b.model_ids || '[]'); } catch {}
            // 隐藏模型名时：把 N 个 model 显示为「N 个模型」
            const modelTags = b.hide_model_names
                ? `<span class="arena-history-model-tag arena-history-model-count">${models.length} 个模型</span>`
                : models.map(m => {
                    const meta = getModelMeta(m);
                    return `<span class="arena-history-model-tag">${escapeHtml(meta?.name || m)}</span>`;
                }).join('');

            const time = new Date(b.created_at).toLocaleString('zh-CN', {
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            const anonTag = b.hide_model_names ? '<span class="arena-history-card-anon">隐藏模型名</span>' : '';

            card.innerHTML = `
                <div class="arena-history-card-header">
                    <div class="arena-history-card-content">${escapeHtml(b.content)}</div>
                    <div class="arena-history-card-time">${escapeHtml(time)}</div>
                </div>
                <div class="arena-history-card-footer">
                    <div class="arena-history-card-models">${modelTags}</div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${anonTag}
                        <span class="arena-history-card-status ${b.status}">${b.status}</span>
                        <span class="arena-history-card-cost">${(b.actual_credits || 0).toLocaleString()} cr</span>
                    </div>
                </div>
            `;
            card.addEventListener('click', () => openBattleDetail(b.id));
            arenaHistoryList.appendChild(card);
        });
    }

    // ============ 历史详情（弹窗/侧栏）============
    async function openBattleDetail(id) {
        const t = getToken();
        try {
            const r = await fetch(`${API_BASE}/${id}`, {
                headers: { 'Authorization': `Bearer ${t}` },
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || '加载失败');
            showBattleDetailModal(d.battle, d.responses || []);
        } catch (e) {
            alert('加载详情失败: ' + e.message);
        }
    }

    function showBattleDetailModal(battle, responses) {
        // 复用 modelModal 风格
        let modal = document.getElementById('arenaDetailModal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'arenaDetailModal';
        modal.className = 'modal-overlay';
        const hideModels = !!battle.hide_model_names;
        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true">
                <header class="modal-header">
                    <h2 class="modal-title">评测详情${hideModels ? ' <span style="font-size: 12px; color: var(--accent-sunset); margin-left: 8px; font-family: var(--font-mono); letter-spacing: 0.6px;">已隐藏模型名</span>' : ''}</h2>
                    <button class="modal-close" id="arenaDetailClose" type="button" aria-label="关闭">✕</button>
                </header>
                <div class="arena-detail-body" style="padding: 20px 24px; max-height: 70vh; overflow-y: auto;">
                    <div class="arena-detail-question">
                        <span class="eyebrow-mono" style="color: var(--body-mid);">QUESTION</span>
                        <div style="margin-top:6px; padding:10px 12px; background: var(--canvas-soft); border-radius: var(--r-sm); color: var(--ink); font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(battle.content)}</div>
                    </div>
                    <div class="arena-detail-responses" style="margin-top: 20px; display: grid; gap: 14px;">
                        ${responses.map(resp => renderDetailResponse(resp, hideModels)).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        document.getElementById('arenaDetailClose').addEventListener('click', () => modal.remove());
    }

    function renderDetailResponse(resp, hideModels) {
        // 隐藏模型名时：用 slot 替代；后端已置 model_id=null（双重保险）
        let labelHtml;
        if (hideModels || !resp.model_id) {
            labelHtml = `<span style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-twilight); padding: 2px 8px; background: var(--accent-midnight); border: 1px solid var(--accent-dusk); border-radius: var(--r-pill); letter-spacing: 1.4px;">Response ${resp.slot}</span>`;
        } else {
            const meta = getModelMeta(resp.model_id);
            const vendorName = meta?.vendor || resp.vendor;
            const modelName = meta?.name || resp.model_id;
            labelHtml = `
                <span class="arena-chip-vendor" style="font-family: var(--font-mono); font-size: 10px; color: var(--body-mid); letter-spacing:0.6px; text-transform: uppercase;">${escapeHtml(vendorName)}</span>
                <span style="margin-left: 8px; color: var(--ink); font-weight: 500;">${escapeHtml(modelName)}</span>
            `;
        }
        const errorBlock = resp.error
            ? `<div class="arena-card-error" style="margin-top:8px;">⚠ ${escapeHtml(resp.error)}</div>`
            : '';
        const body = resp.content
            ? `<div style="margin-top:8px; padding:10px 12px; background: var(--canvas); border:1px solid var(--hairline); border-radius: var(--r-sm); font-size:13px; line-height:1.6; color: var(--ink); white-space: pre-wrap;">${escapeHtml(resp.content)}</div>`
            : errorBlock;
        return `
            <div style="background: var(--canvas-card); border:1px solid var(--hairline); border-radius: var(--r-sm); padding: 14px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>${labelHtml}</div>
                    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-sunset);">
                        ${resp.credits_used || 0} cr · ↑${resp.input_tokens || 0} ↓${resp.output_tokens || 0}
                    </div>
                </div>
                ${body}
            </div>
        `;
    }

    // ============ 视图进入钩子（被 app.js 调用）============
    function onViewEnter() {
        loadPricing();
        fetchRemaining();
        recalcEstimate();
    }

    // ============ 公开 API ============
    window.ArenaModule = {
        init() {
            // 初始化模型 chips
            renderPickChips();
            recalcEstimate();
        },
        onViewEnter,
        // 暴露给 app.js 在切到 arena 视图时调用
        refresh: () => {
            loadPricing();
            fetchRemaining();
            recalcEstimate();
        },
    };
})();