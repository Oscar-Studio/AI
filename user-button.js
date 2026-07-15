// ================= Oscar Studio 全局用户按钮 =================
// 在各个项目的 index.html 顶部引入即可使用
// <script src="https://ai.oscarstudio.cn/user-button.js"></script>

(function() {
    // API 基础路径
    const API_BASE = 'https://api.oscarstudio.cn/api';
    const LS_TOKEN_KEY = 'ai_token';
    const LS_USER_KEY = 'ai_user';

    // 读取 Cookie（跨域共享：后端在 .oscarstudio.cn 设了 HttpOnly=false 的 Cookie）
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // 获取跳转 URL（指向 API 后端的登录页面）
    function getAuthURL() {
        return `https://api.oscarstudio.cn/auth.html?return=${encodeURIComponent(window.location.href)}`;
    }

    // 解码 JWT payload 检查是否过期（不验证签名，仅前端判断）
    function isTokenExpired(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return true;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (!payload.exp) return true;
            return Date.now() >= payload.exp * 1000;
        } catch (e) {
            return true;
        }
    }

    // 清除本地登录状态（保留退出登录按钮统一调用）
    function clearLocalState() {
        localStorage.removeItem(LS_TOKEN_KEY);
        localStorage.removeItem(LS_USER_KEY);
        try { localStorage.removeItem('lg-bg'); } catch (e) {}
        if (document.body && document.body.style) {
            document.body.style.backgroundImage = '';
            document.body.style.backgroundSize = '';
            document.body.style.backgroundPosition = '';
            document.body.style.backgroundRepeat = '';
            document.body.style.backgroundAttachment = '';
        }
    }

    // 跨子域登出：调用后端清 Cookie，再清本地缓存
    async function logout() {
        try {
            await fetch(`${API_BASE}/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            // 网络失败兜底：直接清 JS 可见的同名 Cookie
            document.cookie = 'userToken=; max-age=0; path=/; domain=.oscarstudio.cn';
        }
        clearLocalState();
    }

    // 把 Cookie + 用户信息落地为当前域的缓存
    function persistSession(token, user) {
        localStorage.setItem(LS_TOKEN_KEY, token);
        localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
    }

    // 检查登录状态：以跨域 Cookie 为准，localStorage 仅作缓存
    function checkLoginStatus() {
        const cookieToken = getCookie('userToken');
        if (!cookieToken) {
            // Cookie 已被其他子域登出/过期 → 清本地缓存
            if (localStorage.getItem(LS_TOKEN_KEY)) clearLocalState();
            return null;
        }

        // Cookie 存在即认为已登录（cookie 寿命 7 天对齐 JWT 7 天）。
        // 若缓存里的 ai_token 已过期但 cookie 仍有效，下面 syncLoginFromCookie 会刷新它。
        const cachedUserStr = localStorage.getItem(LS_USER_KEY);
        if (cachedUserStr) {
            try { return JSON.parse(cachedUserStr); }
            catch (e) { /* fallthrough, 重新拉 */ }
        }
        return null;
    }

    // 从跨域 Cookie 同步登录状态到 localStorage（含用户信息）
    async function syncLoginFromCookie() {
        const cookieToken = getCookie('userToken');
        if (!cookieToken) return;

        // 当前域缓存的 token 与 cookie 一致，且有用户信息 → 无需刷新
        const cachedToken = localStorage.getItem(LS_TOKEN_KEY);
        const cachedUser = localStorage.getItem(LS_USER_KEY);
        if (cachedToken === cookieToken && cachedUser) return;

        // 任一缺失或不一致：用 cookie 调 /api/user 拿最新用户
        try {
            const resp = await fetch(`${API_BASE}/user`, {
                headers: { 'Authorization': `Bearer ${cookieToken}` },
                credentials: 'include'
            });
            const data = await resp.json();
            if (data.success && data.user) {
                persistSession(cookieToken, data.user);
                console.log('[用户] 从 Cookie 同步登录状态成功');
            } else if (resp.status === 401) {
                // 后端判定 cookie 失效 → 清本地缓存并通知刷新 UI
                clearLocalState();
            }
        } catch (e) {
            console.warn('[用户] 从 Cookie 同步登录状态失败:', e.message);
        }
    }

    // 渲染用户按钮
    function renderUserButton() {
        const user = checkLoginStatus();
        const container = document.getElementById('userButtonContainer');

        if (!container) {
            console.warn('找不到 userButtonContainer 元素');
            return;
        }

        if (user) {
            // 已登录状态
            const firstChar = user.username ? user.username.charAt(0).toUpperCase() : 'U';
            container.innerHTML = `
                <div class="user-btn-wrapper">
                    <button class="user-avatar-btn" id="userAvatarBtn" title="${user.username}">
                        <span class="user-avatar-circle">${firstChar}</span>
                    </button>
                    <div class="user-dropdown" id="userDropdown">
                        <div class="user-dropdown-header">
                            <span class="user-name">${user.username}</span>
                            <span class="user-email">${user.email || ''}</span>
                        </div>
                        <div class="user-dropdown-divider"></div>
                        <button class="user-dropdown-item" id="muteBtn">🔇 静音</button>
                        <a href="https://api.oscarstudio.cn/user/settings" class="user-dropdown-item user-dropdown-link">UI 设置</a>
                        <button class="user-dropdown-item" id="logoutBtn">退出登录</button>
                    </div>
                </div>
            `;

            // 绑定事件
            document.getElementById('userAvatarBtn').addEventListener('click', function(e) {
                e.stopPropagation();
                document.getElementById('userDropdown').classList.toggle('active');
            });

            document.getElementById('logoutBtn').addEventListener('click', async function() {
                await logout();
                window.dispatchEvent(new CustomEvent('user:login-changed', { detail: { loggedIn: false } }));
                location.reload();
            });

            // 静音按钮
            document.getElementById('muteBtn').addEventListener('click', function() {
                if (window._bgAudio) {
                    window._bgAudio.muted = !window._bgAudio.muted;
                    this.textContent = window._bgAudio.muted ? '🔇 静音' : '🔊 播放';
                }
            });

            // 点击其他地方关闭下拉菜单
            document.addEventListener('click', function() {
                const dropdown = document.getElementById('userDropdown');
                if (dropdown) dropdown.classList.remove('active');
            });
        } else {
            // 未登录状态
            container.innerHTML = `
                <a href="${getAuthURL()}" class="login-register-btn">登录/注册</a>
            `;
        }
    }

    // 注入样式（如果还没有的话）
    function injectStyles() {
        if (document.getElementById('userButtonStyles')) return;

        const style = document.createElement('style');
        style.id = 'userButtonStyles';
        style.textContent = `
            .user-btn-wrapper {
                position: relative;
            }

            .user-avatar-btn {
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 50%;
                cursor: pointer;
                padding: 0;
                transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            }

            .user-avatar-btn:hover {
                transform: scale(1.1);
                background: rgba(255, 255, 255, 0.15);
                border-color: rgba(255, 255, 255, 0.3);
                box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
            }

            .user-avatar-circle {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 38px;
                height: 38px;
                border-radius: 50%;
                background: linear-gradient(135deg, #6366f1, #ec4899);
                color: white;
                font-weight: 600;
                font-size: 14px;
                overflow: hidden;
            }

            .user-avatar-img {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                object-fit: cover;
                display: block;
            }

            .user-dropdown {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                width: 200px;
                background: rgba(30, 41, 59, 0.85);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 16px;
                padding: 0.5rem;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px) scale(0.95);
                transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                z-index: 1000;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
            }

            .user-dropdown.active {
                opacity: 1;
                visibility: visible;
                transform: translateY(0) scale(1);
            }

            .user-dropdown-header {
                padding: 1rem;
                display: flex;
                flex-direction: column;
                gap: 4px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 12px;
                margin-bottom: 0.5rem;
            }

            .user-dropdown-header .user-name {
                color: #f8fafc;
                font-weight: 600;
                font-size: 14px;
            }

            .user-dropdown-header .user-email {
                color: #64748b;
                font-size: 12px;
            }

            .user-dropdown-divider {
                height: 1px;
                background: rgba(255, 255, 255, 0.1);
                margin: 0.5rem 0;
            }

            .user-dropdown-item {
                display: block;
                width: 100%;
                padding: 0.7rem 1rem;
                background: none;
                border: none;
                font-size: 14px;
                text-align: left;
                cursor: pointer;
                transition: all 0.3s;
                border-radius: 10px;
                text-decoration: none;
                color: var(--gray);
            }

            .user-dropdown-item:hover {
                background: rgba(99, 102, 241, 0.15);
                color: #818cf8;
            }

            .user-dropdown-item.user-dropdown-link {
                color: var(--gray);
            }

            #logoutBtn {
                color: #f85149;
            }

            #logoutBtn:hover {
                background: rgba(248, 81, 73, 0.15);
                color: #f85149;
            }

            #muteBtn {
                color: var(--gray);
            }

            #muteBtn:hover {
                background: rgba(99, 102, 241, 0.15);
                color: #818cf8;
            }

            .login-register-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0.65rem 1.5rem;
                border-radius: 50px;
                font-weight: 600;
                font-size: 0.9rem;
                text-decoration: none;
                transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(16px) saturate(180%);
                -webkit-backdrop-filter: blur(16px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #f8fafc;
                position: relative;
                overflow: hidden;
            }

            .login-register-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
                transition: left 0.6s ease;
            }

            .login-register-btn:hover::before {
                left: 100%;
            }

            .login-register-btn:hover {
                transform: translateY(-2px);
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.35);
                box-shadow: 0 10px 30px rgba(99, 102, 241, 0.25), 0 0 20px rgba(255, 255, 255, 0.1);
                color: #f8fafc;
            }
        `;
        document.head.appendChild(style);
    }

    // 初始化
    async function init() {
        injectStyles();
        // 从跨域 Cookie 同步登录状态（如果 localStorage 还没有）
        await syncLoginFromCookie();
        renderUserButton();
        // 通知外部模块登录态（AI Studio 抽屉依赖此事件）
        const loggedIn = !!checkLoginStatus();
        window.dispatchEvent(new CustomEvent('user:login-changed', { detail: { loggedIn } }));
        // 应用用户 UI 配置
        applyUserUI();
    }

    // 应用用户 UI 配置（cookie 是真理之源）
    async function applyUserUI() {
        const token = getCookie('userToken');
        if (!token) return;

        try {
            const resp = await fetch(`${API_BASE}/ui`, {
                credentials: 'include'
            });
            const data = await resp.json();
            if (!data.success || !data.ui) return;

            const ui = data.ui;
            console.log('[UI] 应用配置:', JSON.stringify(ui));

            // 上传文件的基础路径（不带 /api）
            const UPLOAD_BASE = 'https://api.oscarstudio.cn';

            // 应用主题颜色到 CSS 变量
            if (ui.primaryColor) {
                document.documentElement.style.setProperty('--primary', ui.primaryColor);
                document.documentElement.style.setProperty('--primary-dark', adjustColor(ui.primaryColor, -20));
            }

            // 应用自定义头像
            if (ui.avatar) {
                const circle = document.querySelector('.user-avatar-circle');
                if (circle) {
                    circle.textContent = '';
                    const img = document.createElement('img');
                    img.src = `${UPLOAD_BASE}${ui.avatar}`;
                    img.alt = '';
                    img.className = 'user-avatar-img';
                    circle.appendChild(img);
                }
            }

            // 应用背景图片 - 统一设置 body style
            if (ui.backgroundImage) {
                const bgUrl = `${UPLOAD_BASE}${ui.backgroundImage}`;
                console.log('[UI] 设置背景:', bgUrl);
                document.body.style.backgroundImage = `url(${bgUrl})`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundAttachment = 'fixed';
            } else {
                document.body.style.backgroundImage = 'none';
            }

            // 应用字体
            if (ui.fontFamily) {
                document.body.style.setProperty('font-family', ui.fontFamily, 'important');
            }

            // 背景音乐
            if (ui.backgroundMusic) {
                window._userBgMusic = `${UPLOAD_BASE}${ui.backgroundMusic}`;
                console.log('[UI] 背景音乐:', window._userBgMusic);
                // 先暂停之前的
                if (window._bgAudio) {
                    window._bgAudio.pause();
                    window._bgAudio = null;
                }
                // 创建音频
                window._bgAudio = new Audio(window._userBgMusic);
                window._bgAudio.loop = true;
                window._bgAudio.volume = 0.3;
                window._bgAudio.play().then(() => {
                    console.log('[UI] 背景音乐开始播放');
                }).catch(e => {
                    console.warn('[UI] 音乐播放失败:', e.message);
                });

                // 页面失去焦点时暂停，获得焦点时继续播放
                document.addEventListener('visibilitychange', () => {
                    if (window._bgAudio) {
                        if (document.hidden) {
                            window._bgAudio.pause();
                        } else {
                            window._bgAudio.play().catch(() => {});
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('[UI] 应用用户配置失败:', e.message);
        }
    }

    // 调整颜色亮度
    function adjustColor(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, Math.max(0, (num >> 16) + amount));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
        const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    // DOM 加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})();
