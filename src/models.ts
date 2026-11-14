export type Model = { id: string; name: string; attachments?: ('image' | 'audio')[]; think?: boolean; premium?: boolean }
export type Preference = { provider: string; modelId: string; thinking: boolean }

export const MODEL_CONFIG: Record<string, { name: string; models: Model[] }> = {
    deepseek: {
        name: 'DeepSeek',
        models: [
            { id: 'deepseek-flash', name: 'V4.1-Flash', attachments: ['image'] }
        ]
    },
    minimax: {
        name: 'MiniMax',
        models: [
            { id: 'MiniMax-M3',         name: 'M3',         think: true, attachments: ['image'] },
            { id: 'MiniMax-M3.1-Flash', name: 'M3.1-Flash', think: true, attachments: ['image'] }
        ]
    },
    mimo: {
        name: 'MiMo',
        models: [
            { id: 'mimo-v2.6-flash', name: 'V2.6-Flash', attachments: ['image', 'audio'] },
            { id: 'mimo-v2.6-pro',   name: 'V2.6-Pro',   attachments: ['image', 'audio'], premium: true }
        ]
    },
    qwen: {
        name: 'Qwen',
        models: [
            { id: 'qwen/qwen3.8-flash', name: 'Qwen3.8 Flash', attachments: ['image'] },
            { id: 'qwen/qwen3.8-27b',   name: 'Qwen3.8 27B',   attachments: ['image'], premium: true }
        ]
    },
    zai: {
        name: 'GLM',
        models: [
            { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3-Flash', attachments: ['image'] },
            { id: 'z-ai/glm-5.3',       name: 'GLM-5.3', premium: true }
        ]
    },
    moonshot: {
        name: 'Kimi',
        models: [
            { id: 'moonshotai/kimi-k2.5',       name: 'Kimi-K2.5',     attachments: ['image'], premium: true },
            { id: 'moonshotai/kimi-k2.6',       name: 'Kimi-K2.6',     attachments: ['image'], premium: true },
            { id: 'moonshotai/kimi-k2.7-code',  name: 'Kimi-K2.7-Code', attachments: ['image'], premium: true }
        ]
    },
    hy3: {
        name: 'Tencent',
        models: [
            { id: 'tencent/hy3', name: 'Hy3', premium: true },
            { id: 'tencent/hy4', name: 'Hy4', premium: true, attachments: ['image'] }
        ]
    },
    xai: {
        name: 'xAI',
        models: [
            { id: 'x-ai/grok-4.3', name: 'Grok 4.3', attachments: ['image'], premium: true }
        ]
    },
    free: {
        name: 'Free',
        models: [] // populated at runtime from GET /api/chat/free-models
    }
};

const MODEL_MIGRATIONS: Record<string, string> = {
  'qwen/qwen3.6-flash': 'qwen/qwen3.8-flash',
  'qwen/qwen3.6-plus':  'qwen/qwen3.8-flash',
  'qwen/qwen3.7-plus':  'qwen/qwen3.8-flash',
  'qwen/qwen3.7-max':   'qwen/qwen3.8-flash',
  'MiniMax-M2.7':        'MiniMax-M3.1-Flash',
  'deepseek-v4-flash':   'deepseek-flash',
  'deepseek-v4-pro':     'deepseek-flash',
  'mimo-v2-flash':       'mimo-v2.6-flash',
  'mimo-v2.5':           'mimo-v2.6-flash',
  'mimo-v2.5-pro':       'mimo-v2.6-pro',
  'z-ai/glm-4.7-flash':  'z-ai/glm-5.3-flash',
  'z-ai/glm-5v-turbo':   'z-ai/glm-5.3',
  'z-ai/glm-5.1':        'z-ai/glm-5.3',
  'z-ai/glm-5.2':        'z-ai/glm-5.3',
  'meituan/longcat-2.0': 'deepseek-flash'
};
export const defaultModel = 'deepseek-flash'

export function modelPreference(modelId: string, thinking: boolean, free: Model[]): Preference {
    const id = MODEL_MIGRATIONS[modelId] ?? modelId
    const provider = Object.keys(MODEL_CONFIG).find((key) => MODEL_CONFIG[key].models.some((model) => model.id === id))
    if (provider) return { provider, modelId: id, thinking }
    if (free.some((model) => model.id === id)) return { provider: 'free', modelId: id, thinking }
    return { provider: 'deepseek', modelId: defaultModel, thinking }
}
