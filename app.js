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
    newChatBtn.style.display = (localStorage.getItem(STORAGE_VIEW) === 'tts') ? 'none' : '';
    newChatBtn.addEventListener('click', () => {
        if (window.ChatModule) window.ChatModule.newChat();
    });
    // Insert before the user button
    topNavRight.insertBefore(newChatBtn, document.getElementById('userButtonContainer'));

    // Hide new-chat on TTS view
    const observer = new MutationObserver(() => {
        const ttsActive = document.querySelector('.view-tts').classList.contains('active');
        newChatBtn.style.display = ttsActive ? 'none' : '';
    });
    views.forEach(v => observer.observe(v, { attributes: true, attributeFilter: ['class'] }));

    // ---- Init chat module ----
    if (window.ChatModule) window.ChatModule.init();

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
