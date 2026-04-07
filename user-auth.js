// ================= 用户登录管理 =================

// API基础URL - 根据你的服务器IP修改
const API_BASE_URL = 'https://119.23.64.153/api';

// 跨域Cookie域名配置
const COOKIE_DOMAIN = '.oscarstudio.cn';

// 用户状态管理
let currentUser = null;
let currentToken = null;

// ================= Cookie 辅助函数 =================

// 读取 Cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// 写入 Cookie（跨域）
function setCookie(name, value, days = 7) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; domain=${COOKIE_DOMAIN}; samesite=Lax`;
}

// 清除 Cookie
function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${COOKIE_DOMAIN}`;
}

// DOM元素（确保这些ID在你的HTML中都存在）
const userSection = document.getElementById('userSection');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const loggedInUser = document.getElementById('loggedInUser');
const userAvatar = document.getElementById('userAvatar');
const userDropdown = document.getElementById('userDropdown');
const dropdownUsername = document.getElementById('dropdownUsername');
const dropdownPhone = document.getElementById('dropdownPhone');
const editProfileBtn = document.getElementById('editProfileBtn');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const logoutBtn = document.getElementById('logoutBtn');

// 模态框元素
const modalOverlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const closeModal = document.getElementById('closeModal');
const apiMessage = document.getElementById('apiMessage');

// 表单元素
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const editProfileForm = document.getElementById('editProfileForm');
const changePasswordForm = document.getElementById('changePasswordForm');

// 检查登录状态（Cookie 优先，localStorage 兜底）
function checkLoginStatus() {
    // 1. 优先从 Cookie 获取（可跨子域名）
    let token = getCookie('userToken');
    let userData = null;

    if (token) {
        // Cookie 有 token，尝试从 localStorage 获取用户数据
        //（因为 Cookie 存不下完整 JSON，用户数据存在 localStorage）
        const storedUserData = localStorage.getItem('userData');
        if (storedUserData) {
            try {
                userData = JSON.parse(storedUserData);
            } catch (e) {
                console.error('解析用户数据失败:', e);
            }
        }
        console.log('从 Cookie 获取登录状态:', { token: token.substring(0, 20) + '...', userData });
    } else {
        // 2. Cookie 没有，fallback 到 localStorage（仅对本域名有效）
        token = localStorage.getItem('userToken');
        const storedUserData = localStorage.getItem('userData');
        if (storedUserData) {
            try {
                userData = JSON.parse(storedUserData);
            } catch (e) {
                console.error('解析用户数据失败:', e);
            }
        }
        console.log('从 localStorage 获取登录状态:', { token: token ? token.substring(0, 20) + '...' : null, userData });
    }

    if (token && userData) {
        currentToken = token;
        currentUser = userData;
        updateUserUI();
    }
}

// 更新用户界面
function updateUserUI() {
    console.log('更新用户界面:', currentUser);

    if (currentUser) {
        // 显示已登录状态
        loginBtn.style.display = 'none';
        registerBtn.style.display = 'none';
        loggedInUser.style.display = 'flex';

        // 更新用户信息
        const firstChar = currentUser.username ? currentUser.username.charAt(0).toUpperCase() : 'U';
        userAvatar.textContent = firstChar;
        dropdownUsername.textContent = currentUser.username || '未设置';
        dropdownPhone.textContent = currentUser.phone || '未设置';
    } else {
        // 显示未登录状态
        loginBtn.style.display = 'inline-block';
        registerBtn.style.display = 'inline-block';
        loggedInUser.style.display = 'none';
    }
}

// 设置事件监听器
function setupEventListeners() {
    console.log('设置事件监听器');

    // 登录按钮
    loginBtn.addEventListener('click', () => {
        showModal('login');
    });

    // 注册按钮
    registerBtn.addEventListener('click', () => {
        showModal('register');
    });

    // 用户头像点击 - 显示/隐藏下拉菜单
    if (userAvatar) {
        userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('active');
        });
    }

    // 编辑个人信息
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            userDropdown.classList.remove('active');
            showModal('editProfile');
        });
    }

    // 修改密码
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', (e) => {
            e.preventDefault();
            userDropdown.classList.remove('active');
            showModal('changePassword');
        });
    }

    // 退出登录
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // 关闭模态框
    if (closeModal) {
        closeModal.addEventListener('click', hideModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) hideModal();
        });
    }

    // 表单提交事件
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (editProfileForm) editProfileForm.addEventListener('submit', handleEditProfile);
    if (changePasswordForm) changePasswordForm.addEventListener('submit', handleChangePassword);

    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', () => {
        if (userDropdown) userDropdown.classList.remove('active');
    });
}

// 显示模态框
function showModal(type) {
    console.log('显示模态框:', type);

    // 隐藏所有表单
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (editProfileForm) editProfileForm.style.display = 'none';
    if (changePasswordForm) changePasswordForm.style.display = 'none';
    clearMessages();

    switch (type) {
        case 'login':
            modalTitle.textContent = '登录';
            if (loginForm) loginForm.style.display = 'block';
            break;
        case 'register':
            modalTitle.textContent = '注册';
            if (registerForm) registerForm.style.display = 'block';
            break;
        case 'editProfile':
            if (!currentUser) {
                showMessage('请先登录');
                return;
            }
            modalTitle.textContent = '修改个人信息';
            document.getElementById('editUsername').value = currentUser.username || '';
            document.getElementById('editPhone').value = currentUser.phone || '';
            if (editProfileForm) editProfileForm.style.display = 'block';
            break;
        case 'changePassword':
            modalTitle.textContent = '修改密码';
            if (changePasswordForm) changePasswordForm.style.display = 'block';
            break;
    }

    if (modalOverlay) modalOverlay.classList.add('active');
}

// 隐藏模态框
function hideModal() {
    console.log('隐藏模态框');
    if (modalOverlay) modalOverlay.classList.remove('active');
    clearMessages();
    clearFormErrors();
}

// 显示API消息
function showMessage(message, type = 'error') {
    console.log('显示消息:', type, message);
    if (apiMessage) {
        apiMessage.textContent = message;
        apiMessage.className = type;
        apiMessage.style.display = 'block';
    }
}

// 清除消息
function clearMessages() {
    if (apiMessage) {
        apiMessage.textContent = '';
        apiMessage.style.display = 'none';
    }
}

// 清除表单错误
function clearFormErrors() {
    const errors = document.querySelectorAll('.error');
    errors.forEach(error => {
        error.textContent = '';
        error.style.display = 'none';
    });
}

// 显示表单错误
function showFormError(fieldId, message) {
    const errorElement = document.getElementById(fieldId + 'Error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
}

// ================= API 调用函数 =================

// 处理登录
async function handleLogin(e) {
    e.preventDefault();
    clearMessages();
    clearFormErrors();

    const account = document.getElementById('loginAccount').value.trim();
    const password = document.getElementById('loginPassword').value;

    // 简单验证
    if (!account) {
        showFormError('loginAccount', '请输入用户名或手机号');
        return;
    }
    if (!password) {
        showFormError('loginPassword', '请输入密码');
        return;
    }

    console.log('尝试登录:', account);

    try {
        const formData = new FormData();
        formData.append('account', account);
        formData.append('password', password);

        const response = await fetch(`${API_BASE_URL}/login.php`, {
            method: 'POST',
            body: formData
        });

        console.log('登录响应状态:', response.status, response.statusText);

        let result;
        try {
            const text = await response.text();
            console.log('响应文本:', text);
            result = JSON.parse(text);
        } catch (parseError) {
            console.error('解析响应失败:', parseError);
            throw new Error(`服务器返回了无效的JSON: ${response.status} ${response.statusText}`);
        }

        if (result.success) {
            // 保存token和用户信息
            currentToken = result.token;
            currentUser = result.user;

            // 1. 写入 Cookie（跨子域名共享）
            setCookie('userToken', currentToken);

            // 2. 写入 localStorage（本站使用 + Cookie 不可用时的备用）
            localStorage.setItem('userToken', currentToken);
            localStorage.setItem('userData', JSON.stringify(currentUser));

            updateUserUI();
            hideModal();
            showMessage('登录成功！', 'success');
            setTimeout(() => clearMessages(), 2000);
        } else {
            showMessage(result.message || '登录失败');
        }
    } catch (error) {
        console.error('登录错误详情:', error);
        showMessage(`登录失败: ${error.message}`);
    }
}

// 处理注册
async function handleRegister(e) {
    e.preventDefault();
    clearMessages();
    clearFormErrors();

    const username = document.getElementById('regUsername').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    // 验证
    if (username.length < 3 || username.length > 50) {
        showFormError('regUsername', '用户名长度应为3-50字符');
        return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        showFormError('regPhone', '手机号格式不正确');
        return;
    }
    if (password.length < 6) {
        showFormError('regPassword', '密码长度至少6位');
        return;
    }
    if (password !== confirmPassword) {
        showFormError('regConfirmPassword', '两次输入的密码不一致');
        return;
    }

    console.log('尝试注册:', username);

    try {
        const response = await fetch(`${API_BASE_URL}/register.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, phone, password })
        });

        console.log('注册响应状态:', response.status);
        const result = await response.json();
        console.log('注册响应数据:', result);

        if (result.success) {
            showMessage('注册成功！请登录', 'success');
            // 3秒后切换到登录表单
            setTimeout(() => {
                showModal('login');
            }, 2000);
        } else {
            showMessage(result.message || '注册失败');
        }
    } catch (error) {
        console.error('注册错误:', error);
        showMessage('网络错误，请稍后重试。错误详情：' + error.message);
    }
}

// 处理修改个人信息
async function handleEditProfile(e) {
    e.preventDefault();
    clearMessages();
    clearFormErrors();

    if (!currentUser || !currentToken) {
        showMessage('请先登录');
        return;
    }

    const username = document.getElementById('editUsername').value.trim();
    const phone = document.getElementById('editPhone').value.trim();
    const password = document.getElementById('editPassword').value;

    // 验证
    if (username.length < 3 || username.length > 50) {
        showFormError('editUsername', '用户名长度应为3-50字符');
        return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        showFormError('editPhone', '手机号格式不正确');
        return;
    }
    if (!password) {
        showFormError('editPassword', '请输入当前密码验证');
        return;
    }

    console.log('尝试更新个人信息:', username);

    try {
        const response = await fetch(`${API_BASE_URL}/update.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                username: username,
                phone: phone,
                password: password
            })
        });

        console.log('更新响应状态:', response.status);
        const result = await response.json();
        console.log('更新响应数据:', result);

        if (result.success) {
            // 更新本地存储的用户信息和token
            currentUser.username = result.user.username;
            currentUser.phone = result.user.phone;
            currentToken = result.token; // 更新token（因为用户名可能变了）

            // 更新 Cookie（跨子域名）
            setCookie('userToken', currentToken);

            // 更新 localStorage
            localStorage.setItem('userToken', currentToken);
            localStorage.setItem('userData', JSON.stringify(currentUser));

            updateUserUI();
            hideModal();
            showMessage('个人信息更新成功！', 'success');
            setTimeout(() => clearMessages(), 2000);
        } else {
            showMessage(result.message || '更新失败');
        }
    } catch (error) {
        console.error('更新错误:', error);
        showMessage('网络错误，请稍后重试。错误详情：' + error.message);
    }
}

// 处理修改密码
async function handleChangePassword(e) {
    e.preventDefault();
    clearMessages();
    clearFormErrors();

    if (!currentUser || !currentToken) {
        showMessage('请先登录');
        return;
    }

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    // 验证
    if (!currentPassword) {
        showFormError('currentPassword', '请输入当前密码');
        return;
    }
    if (newPassword.length < 6) {
        showFormError('newPassword', '新密码长度至少6位');
        return;
    }
    if (newPassword !== confirmNewPassword) {
        showFormError('confirmNewPassword', '两次输入的新密码不一致');
        return;
    }

    console.log('尝试修改密码');

    try {
        const response = await fetch(`${API_BASE_URL}/change_password.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword,
                confirm_password: confirmNewPassword
            })
        });

        console.log('修改密码响应状态:', response.status);
        const result = await response.json();
        console.log('修改密码响应数据:', result);

        if (result.success) {
            hideModal();
            showMessage('密码修改成功！请重新登录', 'success');

            // 密码修改后需要重新登录
            setTimeout(() => {
                logout();
                showModal('login');
            }, 2000);
        } else {
            showMessage(result.message || '密码修改失败');
        }
    } catch (error) {
        console.error('修改密码错误:', error);
        showMessage('网络错误，请稍后重试。错误详情：' + error.message);
    }
}

// 退出登录
function logout() {
    console.log('退出登录');
    currentUser = null;
    currentToken = null;

    // 清除 Cookie（跨子域名）
    deleteCookie('userToken');

    // 清除 localStorage
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');

    updateUserUI();
    if (userDropdown) userDropdown.classList.remove('active');
    showMessage('已退出登录', 'success');
    setTimeout(() => clearMessages(), 2000);
}

// 页面加载完成后初始化用户系统
document.addEventListener('DOMContentLoaded', function () {
    console.log('初始化用户登录注册系统');
    checkLoginStatus();
    setupEventListeners();
});