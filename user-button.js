// ================= Oscar Studio 全局用户按钮 =================
// 在各个项目的 index.html 顶部引入即可使用
// <script src="https://ai.oscarstudio.cn/user-button.js"></script>

(function() {
    // API 基础路径
    const API_BASE = 'https://api.oscarstudio.cn/api';

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

    // 检查登录状态
    function checkLoginStatus() {
        const token = localStorage.getItem('ai_token');
        const userStr = localStorage.getItem('ai_user');
        if (!token || !userStr) return null;

        // 双重验证：Cookie 必须也存在（跨域登出同步）
        // 如果用户在别的子站退出了登录，Cookie 会被清掉
        const cookieToken = document.cookie.split('; ').find(c => c.startsWith('userToken='));
        if (!cookieToken) {
            // Cookie 已不存在 → 用户在别处退出登录了
            localStorage.removeItem('ai_token');
            localStorage.removeItem('ai_user');
            return null;
        }

        try { return JSON.parse(userStr); }
        catch (e) { console.error('解析用户数据失败:', e); return null; }
    }

    // 从跨域 Cookie 同步登录状态到 localStorage
    async function syncLoginFromCookie() {
        // 已经有 localStorage 数据了，跳过
        if (localStorage.getItem('ai_token') && localStorage.getItem('ai_user')) return;

        const token = getCookie('userToken');
        if (!token) return;

        try {
            const resp = await fetch(`${API_BASE}/user`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (data.success && data.user) {
                localStorage.setItem('ai_token', token);
                localStorage.setItem('ai_user', JSON.stringify(data.user));
                console.log('[用户] 从 Cookie 同步登录状态成功');
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
                        <a href="https://api.oscarstudio.cn/user/settings" class="user-dropdown-item" target="_blank">UI 设置</a>
                        <button class="user-dropdown-item" id="logoutBtn">退出登录</button>
                    </div>
                </div>
            `;

            // 绑定事件
            document.getElementById('userAvatarBtn').addEventListener('click', function(e) {
                e.stopPropagation();
                document.getElementById('userDropdown').classList.toggle('active');
            });

            document.getElementById('logoutBtn').addEventListener('click', function() {
                localStorage.removeItem('ai_token');
                localStorage.removeItem('ai_user');
                // 清除跨域 Cookie（和登录时设置的一致）
                document.cookie = 'userToken=; max-age=0; path=/; domain=.oscarstudio.cn';
                location.reload();
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
                color: #f85149;
                font-size: 14px;
                text-align: left;
                cursor: pointer;
                transition: all 0.3s;
                border-radius: 10px;
                text-decoration: none;
            }

            .user-dropdown-item:not(:last-child):hover {
                background: rgba(99, 102, 241, 0.15);
                color: #818cf8;
            }

            .user-dropdown-item:hover {
                background: rgba(248, 81, 73, 0.15);
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
    }

    // DOM 加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})();
