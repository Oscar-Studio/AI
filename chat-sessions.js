// =====================================================
// AI Studio — 云端会话客户端
//   提供会话的 CRUD + 消息追加
//   未登录时所有调用静默失败（由调用方降级到 localStorage）
// =====================================================

(function () {
    'use strict';

    const API_BASE = 'https://api.oscarstudio.cn/api/chat-sessions';

    function getToken() {
        return localStorage.getItem('ai_token');
    }

    function isLoggedIn() {
        const t = getToken();
        if (!t) return false;
        try {
            const parts = t.split('.');
            if (parts.length !== 3) return false;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.exp && Date.now() >= payload.exp * 1000) return false;
            return true;
        } catch { return false; }
    }

    async function request(path, options = {}) {
        const token = getToken();
        if (!token) return { ok: false, reason: 'no-token' };

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const resp = await fetch(`${API_BASE}${path}`, {
                ...options,
                headers: { ...headers, ...(options.headers || {}) }
            });

            // 401 = token 失效；通知上层降级
            if (resp.status === 401) {
                window.dispatchEvent(new CustomEvent('chat-sessions:auth-failed'));
                return { ok: false, reason: 'auth-failed', status: 401 };
            }
            // 429 = 限流；不影响功能
            if (resp.status === 429) {
                return { ok: false, reason: 'rate-limited', status: 429 };
            }

            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) {
                return { ok: false, reason: 'api-error', status: resp.status, message: data.message };
            }
            return { ok: true, data };
        } catch (e) {
            // 网络错误：静默降级
            return { ok: false, reason: 'network-error', error: e.message };
        }
    }

    window.ChatSessions = {
        isLoggedIn,

        async create({ provider, modelId, firstUserContent }) {
            return request('', {
                method: 'POST',
                body: JSON.stringify({
                    provider,
                    modelId,
                    firstUserContent: firstUserContent || undefined
                })
            });
        },

        async list(limit = 100) {
            return request(`?limit=${limit}`, { method: 'GET' });
        },

        async get(id) {
            return request(`/${id}`, { method: 'GET' });
        },

        async rename(id, title) {
            return request(`/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title })
            });
        },

        async remove(id) {
            return request(`/${id}`, { method: 'DELETE' });
        },

        async appendMessage(sessionId, msg) {
            return request(`/${sessionId}/messages`, {
                method: 'POST',
                body: JSON.stringify(msg)
            });
        },

        async removeMessage(sessionId, msgId) {
            return request(`/${sessionId}/messages/${msgId}`, { method: 'DELETE' });
        }
    };
})();
