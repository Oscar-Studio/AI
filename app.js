// =====================================================
// AI Studio — App glue
//   侧边栏视图切换、新对话按钮、初始化
// =====================================================

(function () {
    'use strict';

    // ---- Sidebar nav ----
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const views        = document.querySelectorAll('.view');
    const STORAGE_VIEW = 'ai_studio_view';

    function switchView(target) {
        sidebarItems.forEach(i => i.classList.toggle('active', i.dataset.view === target));
        views.forEach(v => v.classList.toggle('active', v.dataset.view === target));
        localStorage.setItem(STORAGE_VIEW, target);
        // 进入特定 view 时触发模块钩子
        if (target === 'arena' && window.ArenaModule && window.ArenaModule.onViewEnter) {
            window.ArenaModule.onViewEnter();
        }
    }

    sidebarItems.forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    // Restore last view (default: chat)
    const savedView = localStorage.getItem(STORAGE_VIEW);
    if (savedView && document.querySelector(`.sidebar-item[data-view="${savedView}"]`)) {
        switchView(savedView);
    }

    // ---- Inject "new chat" pill into top nav (Chat view only) ----
    const topNavRight = document.querySelector('.top-nav-right');
    const newChatBtn = document.createElement('button');
    newChatBtn.className = 'ghost-btn';
    newChatBtn.type = 'button';
    newChatBtn.textContent = '新对话';
    newChatBtn.style.display = (localStorage.getItem(STORAGE_VIEW) === 'tts' || localStorage.getItem(STORAGE_VIEW) === 'arena') ? 'none' : '';
    newChatBtn.addEventListener('click', () => {
        if (window.ChatModule) window.ChatModule.newChat();
    });
    // Insert before the user button
    topNavRight.insertBefore(newChatBtn, document.getElementById('userButtonContainer'));

    // Hide new-chat on TTS / Arena view
    const observer = new MutationObserver(() => {
        const activeView = document.querySelector('.view.active');
        const isHidden = activeView && (activeView.classList.contains('view-tts') || activeView.classList.contains('view-arena'));
        newChatBtn.style.display = isHidden ? 'none' : '';
    });
    views.forEach(v => observer.observe(v, { attributes: true, attributeFilter: ['class'] }));

    // ---- Init chat module ----
    if (window.ChatModule) window.ChatModule.init();
    if (window.ArenaModule) window.ArenaModule.init();

    // ---- Sidebar history (inline, below Arena) ----
    const sidebarHistory    = document.getElementById('sidebarHistory');
    const sidebarHistoryList = document.getElementById('sidebarHistoryList');
    const sidebarHistoryNew  = document.getElementById('sidebarHistoryNew');

    function formatTimeAgo(iso) {
        if (!iso) return '';
        const t = new Date(iso);
        const diff = Date.now() - t.getTime();
        const min = Math.floor(diff / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return `${min} 分钟前`;
        const h = Math.floor(min / 60);
        if (h < 24) return `${h} 小时前`;
        const d = Math.floor(h / 24);
        if (d === 1) return '昨天';
        if (d < 7) return `${d} 天前`;
        return t.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }

    // 进入内联编辑模式：把 title 替换为 input
    function enterEditMode(item, s, titleEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sidebar-history-item-edit';
        input.value = s.title || '';
        input.maxLength = 200;
        input.spellcheck = false;

        let committed = false;
        const commit = async (save) => {
            if (committed) return;
            committed = true;
            const newTitle = input.value.trim();
            if (save && newTitle && newTitle !== s.title) {
                await window.ChatSessions.rename(s.id, newTitle);
                window.dispatchEvent(new CustomEvent('chat:session-renamed', { detail: { sessionId: s.id, title: newTitle } }));
                loadAndRenderSidebar();
            } else {
                // 取消或空字符串：恢复原标题
                titleEl.textContent = s.title || '新对话';
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur(); // 触发 commit
            } else if (e.key === 'Escape') {
                e.preventDefault();
                committed = true; // 跳过 commit 的保存
                titleEl.textContent = s.title || '新对话';
                input.remove();
                titleEl.style.display = '';
            }
            e.stopPropagation();
        });
        input.addEventListener('blur', () => {
            if (!committed) commit(true);
            // commit() 会通过 loadAndRenderSidebar 重新渲染，无需手动恢复
        });
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());

        titleEl.style.display = 'none';
        titleEl.parentNode.insertBefore(input, titleEl);
        // 下一帧聚焦并选中
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    async function loadAndRenderSidebar() {
        const loggedIn = window.ChatSessions && window.ChatSessions.isLoggedIn();
        sidebarHistory.hidden = !loggedIn;
        if (!loggedIn) return;

        const r = await window.ChatSessions.list(100);
        if (!r.ok) {
            sidebarHistoryList.innerHTML = '<div class="sidebar-history-empty">加载失败</div>';
            return;
        }

        const sessions = r.data.sessions || [];
        if (sessions.length === 0) {
            sidebarHistoryList.innerHTML = '<div class="sidebar-history-empty">还没有会话</div>';
            return;
        }

        const currentId = window.ChatModule.getCurrentSessionId();
        sidebarHistoryList.innerHTML = '';
        for (const s of sessions) {
            const item = document.createElement('div');
            item.className = 'sidebar-history-item' + (s.id === currentId ? ' active' : '');
            item.dataset.id = s.id;
            item.title = s.title || '新对话';

            const title = document.createElement('div');
            title.className = 'sidebar-history-item-title';
            title.textContent = s.title || '新对话';
            // 单击标题直接进入内联编辑（不切换会话）
            title.addEventListener('click', (e) => {
                e.stopPropagation();
                enterEditMode(item, s, title);
            });

            const time = document.createElement('div');
            time.className = 'sidebar-history-item-time';
            time.textContent = formatTimeAgo(s.last_message_at);

            const actions = document.createElement('div');
            actions.className = 'sidebar-history-item-actions';

            const delBtn = document.createElement('button');
            delBtn.className = 'sidebar-history-item-action is-del';
            delBtn.type = 'button';
            delBtn.title = '删除';
            delBtn.setAttribute('aria-label', '删除');
            delBtn.textContent = '×';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`确定删除「${s.title || '新对话'}」？`)) return;
                await window.ChatSessions.remove(s.id);
                if (s.id === window.ChatModule.getCurrentSessionId()) {
                    window.ChatModule.newChat();
                }
                loadAndRenderSidebar();
            });

            actions.appendChild(delBtn);

            item.appendChild(title);
            item.appendChild(time);
            item.appendChild(actions);

            // 点击空白处（不是 title、不是 actions）才切换会话
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.sidebar-history-item-actions')) return;
                if (e.target.closest('.sidebar-history-item-title')) return;
                if (e.target.closest('.sidebar-history-item-edit')) return;
                if (s.id === window.ChatModule.getCurrentSessionId()) return;
                switchView('chat');
                await window.ChatModule.loadSession(s.id);
            });

            sidebarHistoryList.appendChild(item);
        }
    }

    sidebarHistoryNew.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.ChatModule) window.ChatModule.newChat();
    });

    // 登录态变化时刷新
    window.addEventListener('user:login-changed', () => {
        loadAndRenderSidebar();
    });

    // 首次加载
    loadAndRenderSidebar();

    // 抽屉里在新建/重命名/删除时刷新
    window.addEventListener('chat:session-updated', loadAndRenderSidebar);
    window.addEventListener('chat:session-renamed', loadAndRenderSidebar);
    window.addEventListener('chat:current-session-changed', loadAndRenderSidebar);

    // ---- Auto-fill chat input from ?q= (Opilot integration) ----
    (function autoFillFromQuery() {
        const params = new URLSearchParams(location.search);
        const q = params.get('q');
        if (!q) return;
        // 等 ChatModule 加载完
        const tryFill = () => {
            const input = document.getElementById('chatInput');
            if (!input) {
                setTimeout(tryFill, 100);
                return;
            }
            input.value = q;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
            input.focus();
            // 不自动发送 — 让用户审阅后再按 Enter
        };
        tryFill();
    })();
})();
