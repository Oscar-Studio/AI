const API_BASE = 'https://api.oscarstudio.cn/api';

// ==================== TAB SWITCH ====================
const tabBtns = document.querySelectorAll('.tab-btn');
const forms = document.querySelectorAll('.auth-form');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        forms.forEach(f => f.classList.toggle('active', f.id === `${tab}-form`));
        clearErrors();
    });
});

// ==================== SEND CODE ====================
const loginSendBtn = document.getElementById('login-send-btn');
const regSendBtn = document.getElementById('reg-send-btn');
const loginCountdown = document.getElementById('login-countdown');
const regCountdown = document.getElementById('reg-countdown');

let loginCooldown = 0;
let regCooldown = 0;

function startCountdown(btn, tip, key) {
    let seconds = 60;
    btn.disabled = true;
    btn.textContent = `${seconds}s`;
    tip.style.display = 'block';
    tip.textContent = '验证码 10 分钟内有效';

    const interval = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.textContent = '重新发送';
            tip.style.display = 'none';
            if (key === 'login') loginCooldown = 0;
            else regCooldown = 0;
        } else {
            btn.textContent = `${seconds}s`;
        }
    }, 1000);

    if (key === 'login') loginCooldown = interval;
    else regCooldown = interval;
}

async function sendCode(email, purpose, btn, tip) {
    clearErrors();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(purpose === 'login' ? 'login-error' : 'reg-error', '请输入有效的邮箱地址');
        return;
    }

    btn.disabled = true;
    btn.textContent = '发送中...';

    try {
        const resp = await fetch(`${API_BASE}/auth/send_code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), purpose })
        });

        const data = await resp.json();

        if (data.success) {
            startCountdown(btn, tip, purpose);
            showError(purpose === 'login' ? 'login-error' : 'reg-error', '');
        } else {
            showError(purpose === 'login' ? 'login-error' : 'reg-error', data.message || '发送失败');
            btn.disabled = false;
            btn.textContent = '发送验证码';
        }
    } catch (err) {
        showError(purpose === 'login' ? 'login-error' : 'reg-error', '网络错误，请稍后重试');
        btn.disabled = false;
        btn.textContent = '发送验证码';
    }
}

// 注册发送验证码
if (regSendBtn) {
    regSendBtn.addEventListener('click', () => {
        const email = document.getElementById('reg-email').value;
        sendCode(email, 'register', regSendBtn, regCountdown);
    });
}

// ==================== LOGIN FORM ====================
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const account = document.getElementById('login-account').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('.submit-btn');

    clearErrors();

    if (!account || !password) {
        showError('login-error', '请填写用户名/邮箱和密码');
        return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '登录中...';

    try {
        const resp = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, password })
        });

        const data = await resp.json();

        if (data.success && data.token) {
            localStorage.setItem('ai_token', data.token);
            localStorage.setItem('ai_user', JSON.stringify(data.user));
            showSuccess('登录成功，即将跳转...');
            setTimeout(() => {
                location.href = getReturnURL();
            }, 800);
        } else {
            showError('login-error', data.message || '登录失败');
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = '登录';
        }
    } catch (err) {
        showError('login-error', '网络错误，请稍后重试');
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = '登录';
    }
});

// ==================== REGISTER FORM ====================
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const code = document.getElementById('reg-code').value.trim();
    const btn = e.target.querySelector('.submit-btn');

    clearErrors();

    if (!email || !username || !password || !code) {
        showError('reg-error', '请填写所有字段');
        return;
    }

    if (username.length < 3 || username.length > 50) {
        showError('reg-error', '用户名长度应在 3-50 字符之间');
        return;
    }

    if (password.length < 6) {
        showError('reg-error', '密码长度至少6位');
        return;
    }

    if (!/^\d{6}$/.test(code)) {
        showError('reg-error', '验证码必须是6位数字');
        return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '注册中...';

    try {
        const resp = await fetch(`${API_BASE}/auth/login_by_code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, username, password })
        });

        const data = await resp.json();

        if (data.success && data.token) {
            localStorage.setItem('ai_token', data.token);
            localStorage.setItem('ai_user', JSON.stringify(data.user));
            showSuccess('注册成功，即将跳转...');
            setTimeout(() => {
                location.href = getReturnURL();
            }, 800);
        } else {
            showError('reg-error', data.message || '注册失败');
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = '注册';
        }
    } catch (err) {
        showError('reg-error', '网络错误，请稍后重试');
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = '注册';
    }
});

// ==================== HELPERS ====================
function showError(id, msg) {
    document.getElementById(id).textContent = msg;
}

function clearErrors() {
    document.getElementById('login-error').textContent = '';
    document.getElementById('reg-error').textContent = '';
}

function showSuccess(msg) {
    const card = document.querySelector('.auth-card');
    card.classList.add('success');
    card.innerHTML = `
        <div class="success-icon">✅</div>
        <h2>${msg}</h2>
        <p>正在跳转...</p>
    `;
}

// ==================== RETURN URL ====================
function getReturnURL() {
    const params = new URLSearchParams(window.location.search);
    let returnURL = params.get('return') || 'https://ai.oscarstudio.cn/AI_Launcher/index.html';
    return returnURL;
}

// ==================== CHECK ALREADY LOGGED IN ====================
(function checkAuth() {
    const token = localStorage.getItem('ai_token');
    if (!token) return;
    fetch(`${API_BASE}/user`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).then(data => {
        if (data.success) {
            location.href = getReturnURL();
        } else {
            localStorage.removeItem('ai_token');
            localStorage.removeItem('ai_user');
        }
    }).catch(() => {});
})();
