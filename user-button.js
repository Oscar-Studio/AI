// ================= Oscar Studio 全局用户按钮 =================
// 在各个项目的 index.html 顶部引入即可使用
// <script src="https://ai.oscarstudio.cn/user-button.js"></script>

(function() {
    // API 基础路径
    const API_BASE = 'https://api.oscarstudio.cn/api';

    // 获取当前页面完整 URL（用于登录后返回）
    function getCurrentPage() {
        return window.location.href;
    }

    // 获取跳转 URL（指向 API 后端的登录页面）
    function getAuthURL() {
        const currentPage = getCurrentPage();
        return `https://api.oscarstudio.cn/auth.html?return=${encodeURIComponent(currentPage)}`;
    }

    // 检查登录状态
    function checkLoginStatus() {
        const token = localStorage.getItem('ai_token');
        const userStr = localStorage.getItem('ai_user');

        if (!token || !userStr) {
            return null;
        }

        try {
            return JSON.parse(userStr);
        } catch (e) {
            return null;
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
                background: none;
                border: none;
                cursor: pointer;
                padding: 0;
            }

            .user-avatar-circle {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, #2A5CAA, #00E5FF);
                color: white;
                font-weight: 600;
                font-size: 14px;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }

            .user-avatar-btn:hover .user-avatar-circle {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(0, 229, 255, 0.3);
            }

            .user-dropdown {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                width: 200px;
                background: #0d1117;
                border: 1px solid #30363d;
                border-radius: 8px;
                padding: 8px 0;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-8px);
                transition: all 0.2s ease;
                z-index: 1000;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            }

            .user-dropdown.active {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .user-dropdown-header {
                padding: 8px 12px;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .user-dropdown-header .user-name {
                color: #ffffff;
                font-weight: 600;
                font-size: 14px;
            }

            .user-dropdown-header .user-email {
                color: #8b949e;
                font-size: 12px;
            }

            .user-dropdown-divider {
                height: 1px;
                background: #30363d;
                margin: 4px 0;
            }

            .user-dropdown-item {
                display: block;
                width: 100%;
                padding: 8px 12px;
                background: none;
                border: none;
                color: #f85149;
                font-size: 14px;
                text-align: left;
                cursor: pointer;
                transition: background 0.15s ease;
            }

            .user-dropdown-item:hover {
                background: rgba(248, 81, 73, 0.1);
            }

            .login-register-btn {
                display: inline-flex;
                align-items: center;
                padding: 8px 16px;
                background: linear-gradient(135deg, #2A5CAA, #00E5FF);
                color: white;
                text-decoration: none;
                border-radius: 20px;
                font-weight: 500;
                font-size: 14px;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }

            .login-register-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 229, 255, 0.3);
            }
        `;
        document.head.appendChild(style);
    }

    // 初始化
    function init() {
        injectStyles();
        renderUserButton();
    }

    // DOM 加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
