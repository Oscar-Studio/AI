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

    // ---- History drawer ----
    const historyBtn    = document.getElementById('historyBtn');
    const drawerOverlay = document.getElementById('drawerOverlay');
    const historyDrawer = document.getElementById('historyDrawer');
    const drawerClose   = document.getElementById('drawerClose');
    const drawerList    = document.getElementById('drawerList');
    const drawerLoginHint = document.getElementById('drawerLoginHint');

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

    async function loadAndRenderDrawer() {
        if (!window.ChatSessions || !window.ChatSessions.isLoggedIn()) {
            drawerLoginHint.hidden = false;
            drawerList.innerHTML = '';
            return;
        }
        drawerLoginHint.hidden = true;

        const r = await window.ChatSessions.list(100);
        if (!r.ok) {
            drawerList.innerHTML = '<div class="drawer-empty">加载失败，请稍后再试</div>';
            return;
        }

        const sessions = r.data.sessions || [];
        if (sessions.length === 0) {
            drawerList.innerHTML = '<div class="drawer-empty">还没有会话<br><span class="drawer-empty-sub">开始一次对话即可自动保存</span></div>';
            return;
        }

        const currentId = window.ChatModule.getCurrentSessionId();
        drawerList.innerHTML = '';
        for (const s of sessions) {
            const item = document.createElement('div');
            item.className = 'drawer-item' + (s.id === currentId ? ' active' : '');
            item.dataset.id = s.id;

            const title = document.createElement('div');
            title.className = 'drawer-item-title';
            title.textContent = s.title || '新对话';

            const meta = document.createElement('div');
            meta.className = 'drawer-item-meta';
            const time = document.createElement('span');
            time.textContent = formatTimeAgo(s.last_message_at);
            const count = document.createElement('span');
            count.textContent = `${s.message_count || 0} 条消息`;
            meta.appendChild(time);
            meta.appendChild(count);

            const actions = document.createElement('div');
            actions.className = 'drawer-item-actions';

            const renameBtn = document.createElement('button');
            renameBtn.className = 'drawer-item-action';
            renameBtn.type = 'button';
            renameBtn.title = '重命名';
            renameBtn.innerHTML = '✏️';
            renameBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newTitle = prompt('新标题：', s.title || '');
                if (newTitle === null || !newTitle.trim()) return;
                await window.ChatSessions.rename(s.id, newTitle.trim());
                loadAndRenderDrawer();
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'drawer-item-action drawer-item-action-del';
            delBtn.type = 'button';
            delBtn.title = '删除';
            delBtn.innerHTML = '🗑';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`确定删除「${s.title || '新对话'}」？\n该会话的所有消息都会一起删除。`)) return;
                await window.ChatSessions.remove(s.id);
                if (s.id === window.ChatModule.getCurrentSessionId()) {
                    window.ChatModule.newChat();
                }
                loadAndRenderDrawer();
            });

            actions.appendChild(renameBtn);
            actions.appendChild(delBtn);

            item.appendChild(title);
            item.appendChild(meta);
            item.appendChild(actions);

            item.addEventListener('click', async () => {
                if (s.id === window.ChatModule.getCurrentSessionId()) {
                    closeDrawer();
                    return;
                }
                const ok = await window.ChatModule.loadSession(s.id);
                if (ok) closeDrawer();
            });

            drawerList.appendChild(item);
        }
    }

    function openDrawer() {
        historyDrawer.hidden = false;
        drawerOverlay.hidden = false;
        loadAndRenderDrawer();
    }
    function closeDrawer() {
        historyDrawer.hidden = true;
        drawerOverlay.hidden = true;
    }

    historyBtn.addEventListener('click', openDrawer);
    drawerClose.addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !historyDrawer.hidden) closeDrawer();
    });

    // 抽屉按钮仅在登录后可见（在 user-button.js 登录态变化时通过事件更新）
    historyBtn.style.display = 'none';
    window.addEventListener('user:login-changed', () => {
        const loggedIn = !!(localStorage.getItem('ai_token'));
        historyBtn.style.display = loggedIn ? '' : 'none';
        if (loggedIn) loadAndRenderDrawer();
    });
    // 首次加载时检查一次
    if (localStorage.getItem('ai_token')) {
        historyBtn.style.display = '';
    }

    // 会话列表在新建/重命名/删除时刷新
    window.addEventListener('chat:session-updated', loadAndRenderDrawer);
    window.addEventListener('chat:session-renamed', loadAndRenderDrawer);
    window.addEventListener('chat:current-session-changed', loadAndRenderDrawer);

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
