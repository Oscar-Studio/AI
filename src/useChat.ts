import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, json, payload, sessionsPath } from './api'
import { MODEL_CONFIG, defaultModel, modelPreference, type Model, type Preference } from './models'
import { readEvents } from './sse'

export type Attachment = { type: 'image' | 'audio'; name: string; url: string }
export type Message = {
  id: string; role: 'user' | 'assistant' | 'system'; content: string
  attachments?: Attachment[]; reasoning?: string; tokens?: number; notice?: string; pending?: boolean
}
export type Session = { id: number; title: string; pinned: number; provider?: string; model_id?: string; total_tokens?: number }
type SavedMessage = Omit<Message, 'id' | 'attachments'> & {
  id: number; attachments?: Attachment[] | string; is_in_progress?: number; input_tokens?: number; output_tokens?: number
}
type SessionData = { session: Session; messages: SavedMessage[] }
type LiveFrame = { type: 'replay' | 'delta' | 'end' | 'stale'; text?: string; reasoning?: string; content?: string; reason?: string }
type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number }
type ChatFrame = Usage & {
  _type?: string; message?: string; usage?: Usage
  choices?: { finish_reason?: string; delta?: {
    content?: string; reasoning?: string; reasoning_content?: string; thinking?: string; thought?: string
    reasoning_details?: { text?: string; type?: string }[]
  } }[]
}

const storageKey = 'ai_studio_state'
const idleLimit = 300_000
const fallback: Preference = { provider: 'deepseek', modelId: defaultModel, thinking: true }

function initialPreference(): Preference {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return { provider: saved.provider || fallback.provider, modelId: saved.modelId || defaultModel, thinking: saved.thinking ?? true }
  } catch { return fallback }
}

function toModelMessage(message: Message, supported: Model['attachments']) {
  const { role, content } = message
  const attachments = message.attachments?.filter(({ type }) => supported?.includes(type))
  if (!attachments?.length) return { role, content }
  const parts = attachments.map(({ type, url }) => type === 'image'
    ? { type: 'image_url', image_url: { url } } : { type: 'audio', audio_url: { url } })
  return { role, content: [{ type: 'text', text: content }, ...parts] }
}

function fromSaved(message: SavedMessage): Message {
  let attachments: Attachment[] | undefined
  try {
    const parsed = typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments
    if (Array.isArray(parsed)) attachments = parsed.filter((item) => item && ['image', 'audio'].includes(item.type) && typeof item.url === 'string')
  } catch { /* The message text can still be shown. */ }
  return {
    id: String(message.id), role: message.role, content: message.content || '', reasoning: message.reasoning,
    attachments, pending: Boolean(message.is_in_progress), tokens: (message.input_tokens || 0) + (message.output_tokens || 0),
  }
}

export function useChat(token: string | null) {
  const [preference, setPreference] = useState(initialPreference)
  const [free, setFree] = useState<Model[]>([])
  const [freeStatus, setFreeStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [quota, setQuota] = useState<number | null>(null)
  const [operation, setOperation] = useState<'send' | 'open' | 'replay' | null>(null)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const listVersion = useRef(0)
  const savedPreference = useRef(preference)
  const preferenceReady = preference.provider !== 'free' || freeStatus !== 'loading'
  const selected = preferenceReady ? modelPreference(preference.modelId, preference.thinking, free) : preference

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    const version = ++listVersion.current
    try {
      const data = await json<{ sessions: Session[] }>(`${sessionsPath}?limit=100`, { signal })
      if (version === listVersion.current && !signal?.aborted) setSessions(data.sessions)
    } catch (error) {
      if (version === listVersion.current && !signal?.aborted) setError(errorMessage(error))
    }
  }, [token])

  const refreshQuota = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    try {
      const data = await json<{ user: { quota?: { credits?: { remaining: number } } } }>('/user', { signal })
      if (!signal?.aborted) setQuota(data.user.quota?.credits?.remaining ?? null)
    } catch { if (!signal?.aborted) setQuota(null) }
  }, [token])

  useEffect(() => {
    const ctrl = new AbortController()
    lifetime.current = ctrl
    void refresh(ctrl.signal)
    void refreshQuota(ctrl.signal)
    return () => { ctrl.abort(); request.current?.abort() }
  }, [refresh, refreshQuota])

  const loadFree = useCallback(async (signal?: AbortSignal) => {
    setFreeStatus('loading')
    try {
      const data = await json<{ models: { id: string; name?: string; modalities?: string[]; think?: boolean }[] }>(
        '/chat/free-models', { signal }, false)
      if (signal?.aborted) return
      setFree(data.models.map((model) => ({
        id: model.id, name: model.name || model.id, think: model.think,
        attachments: model.modalities?.includes('image') ? ['image'] : [],
      })))
      setFreeStatus('ready')
    } catch { if (!signal?.aborted) setFreeStatus('error') }
  }, [])

  useEffect(() => { void loadFree(lifetime.current?.signal) }, [loadFree])

  useEffect(() => {
    if (!preferenceReady || (preference.provider === 'free' && freeStatus === 'error')) return
    savedPreference.current = selected
    try { localStorage.setItem(storageKey, JSON.stringify(selected)) } catch { /* Storage may be disabled. */ }
  }, [preferenceReady, preference.provider, freeStatus, selected.modelId, selected.provider, selected.thinking])

  function newChat() {
    request.current?.abort()
    request.current = null
    setOperation(null)
    setSession(null)
    setMessages([])
    setError('')
    setPreference(savedPreference.current)
  }

  function start(kind: NonNullable<typeof operation>) {
    request.current?.abort()
    const ctrl = new AbortController()
    request.current = ctrl
    setOperation(kind)
    setError('')
    return ctrl
  }

  function finish(ctrl: AbortController) {
    if (request.current !== ctrl) return
    request.current = null
    setOperation(null)
  }

  function patchMessage(id: string, patch: Partial<Message>, ctrl: AbortController) {
    if (request.current === ctrl) {
      setMessages((items) => items.map((message) => message.id === id ? { ...message, ...patch } : message))
    }
  }

  async function loadSession(id: number) {
    const ctrl = start('open')
    try {
      const data = await json<SessionData>(`${sessionsPath}/${id}`, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const loaded = data.messages.map(fromSaved)
      setSession(data.session)
      if (data.session.model_id) {
        setPreference(data.session.provider === 'free'
          ? { provider: 'free', modelId: data.session.model_id, thinking: selected.thinking }
          : modelPreference(data.session.model_id, selected.thinking, free))
      }
      setMessages(loaded)
      const pending = [...loaded].reverse().find((item) => item.pending && item.role === 'assistant')
      if (!pending) return
      setOperation('replay')
      try {
        await replay(id, pending, ctrl)
      } catch (error) {
        if (ctrl.signal.aborted) throw error
        if (!(error instanceof ApiError && error.status === 404)) {
          // A subscriber can reconnect without creating a second generation.
          try { await replay(id, pending, ctrl); return } catch { /* Refresh persisted content below. */ }
        }
        if (ctrl.signal.aborted) return
        const latest = await json<SessionData>(`${sessionsPath}/${id}`, { signal: ctrl.signal })
        if (!ctrl.signal.aborted) setMessages(latest.messages.map(fromSaved).map((item) =>
          item.pending ? { ...item, pending: false, notice: '连接已断开，可重新打开此会话。' } : item))
      } finally {
        patchMessage(pending.id, { pending: false }, ctrl)
      }
    } catch (error) {
      if (request.current === ctrl && !ctrl.signal.aborted) setError(errorMessage(error))
    } finally { finish(ctrl) }
  }

  async function replay(id: number, message: Message, ctrl: AbortController) {
    const response = await api(`${sessionsPath}/${id}/stream`, { signal: ctrl.signal })
    if (!response.body) throw new Error('未收到流式响应')
    let content = message.content
    let reasoning = message.reasoning ?? ''
    for await (const event of readEvents<LiveFrame>(response.body)) {
      if (event.type === 'replay' || event.type === 'stale') {
        content = event.text ?? ''
        reasoning = event.reasoning ?? ''
      } else if (event.type === 'delta') {
        content += event.content ?? ''
        reasoning += event.reasoning ?? ''
      } else if (event.type === 'end') {
        if (!['stop', 'length', 'completed'].includes(event.reason ?? 'stop')) {
          patchMessage(message.id, { notice: '生成已结束，重新打开会话可查看保存的内容。' }, ctrl)
        }
        return
      }
      patchMessage(message.id, {
        content, reasoning, ...(event.type === 'stale' && { notice: '本次回答因服务重启中断。' }),
      }, ctrl)
      if (event.type === 'stale') return
    }
    throw new Error('实时连接已断开')
  }

  async function send(content: string, attachments: Attachment[]) {
    if (request.current || !token || !content || !preferenceReady) return
    if (quota !== null && quota <= 0 && selected.provider !== 'free') {
      setError('今日 Credits 已用完。可切换免费模型或明天再试。')
      return
    }
    const ctrl = start('send')
    const user: Message = { id: crypto.randomUUID(), role: 'user', content, attachments }
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', pending: true }
    const supported = (selected.provider === 'free' ? free : MODEL_CONFIG[selected.provider].models)
      .find((model) => model.id === selected.modelId)?.attachments
    const history = [...messages.filter((message) => !message.pending && (message.role !== 'assistant' || message.content)), user]
    setMessages([...history, assistant])
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let answer = ''
    let reasoning = ''
    let tokens: number | undefined
    let truncated = false
    let hasTerminalFrame = false
    let receivedResponse = false
    let activeSession = session
    const isNew = !session
    function resetIdle() {
      clearTimeout(timer)
      timer = setTimeout(() => { timedOut = true; ctrl.abort() }, idleLimit)
    }
    try {
      if (!activeSession) {
        const { session: created } = await json<{ session: Session }>(sessionsPath, {
          ...payload('POST', { provider: selected.provider, modelId: selected.modelId, firstUserContent: content }),
          signal: ctrl.signal,
        })
        if (ctrl.signal.aborted) return
        activeSession = created
        setSession(created)
      }
      const path = `${sessionsPath}/${activeSession.id}`
      await json(`${path}/messages`, {
        ...payload('POST', { role: 'user', content, attachments: attachments.length ? attachments : undefined }),
        signal: ctrl.signal,
      })
      const background = lifetime.current?.signal
      if (isNew) void json(`${path}/generate-title`, { ...payload('POST'), signal: background })
        .catch(() => {}).then(() => refresh(background))
      void refresh(background)
      resetIdle()
      const response = await api('/chat', {
        ...payload('POST', {
          model: selected.modelId, messages: history.map((message) => toModelMessage(message, supported)), stream: true,
          sessionId: activeSession.id, ...(selected.provider !== 'minimax' && { thinking: selected.thinking }),
        }),
        signal: ctrl.signal,
      })
      if (!response.body) throw new Error('未收到流式响应')
      receivedResponse = true
      for await (const frame of readEvents<ChatFrame>(response.body, resetIdle)) {
        if (frame._type === 'error') throw new Error(frame.message || '模型响应中断')
        const choice = frame.choices?.[0]
        const delta = choice?.delta
        if (delta) {
          answer += delta.content ?? ''
          if (selected.thinking || selected.provider === 'minimax') {
            reasoning += delta.reasoning_content || delta.reasoning || delta.thinking || delta.thought
              || delta.reasoning_details?.map((item) => item.text || '').join('') || ''
          }
        }
        const usage = frame._type === 'usage' ? frame : frame.usage
        if (usage) tokens = usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0))
        if (choice?.finish_reason === 'length') truncated = true
        if (frame._type === 'usage' || choice?.finish_reason) hasTerminalFrame = true
        patchMessage(assistant.id, { content: answer, reasoning, tokens }, ctrl)
      }
      if (!hasTerminalFrame) throw new TypeError('实时连接已断开')
      patchMessage(assistant.id, { pending: false, notice: truncated ? '回答达到模型输出上限。' : undefined }, ctrl)
    } catch (error) {
      if (receivedResponse && error instanceof TypeError && !ctrl.signal.aborted && activeSession && request.current === ctrl) {
        void loadSession(activeSession.id)
        return
      }
      patchMessage(assistant.id, {
        pending: false, notice: timedOut ? '模型长时间未响应，请重试。'
          : ctrl.signal.aborted ? '已停止生成。' : errorMessage(error),
      }, ctrl)
    } finally {
      clearTimeout(timer)
      finish(ctrl)
      if (!lifetime.current?.signal.aborted) {
        void refresh(lifetime.current?.signal)
        void refreshQuota(lifetime.current?.signal)
      }
    }
  }

  async function updateSession(id: number, action: 'rename' | 'pin' | 'remove', title?: string) {
    const signal = lifetime.current?.signal
    const path = `${sessionsPath}/${id}`
    await json(action === 'pin' ? `${path}/pin` : path, {
      ...payload(action === 'remove' ? 'DELETE' : 'PATCH', title === undefined ? undefined : { title }), signal,
    })
    if (signal?.aborted) return
    if (session?.id === id) {
      if (action === 'remove') newChat()
      if (action === 'rename' && title) setSession((current) => current?.id === id ? { ...current, title } : current)
    }
    await refresh(signal)
  }

  return {
    preference: selected, preferenceReady, setPreference, free, freeStatus, reloadFree: () => loadFree(lifetime.current?.signal),
    sessions, session, messages, quota, operation, error, setError, send, newChat, loadSession, updateSession,
    stop: () => request.current?.abort(),
  }
}
