import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, History, MessageSquare, Paperclip, Pin, Plus, Sparkles, Square, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import renderMath from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import { authUrl, errorMessage, getToken, readFile } from './api'
import { MODEL_CONFIG, modelPreference } from './models'
import { useChat, type Attachment, type Message, type Session } from './useChat'

function Markdown({ content }: { content: string }) {
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = target.current
    if (!node) return
    node.replaceChildren(DOMPurify.sanitize(marked.parse(content, { async: false }), { RETURN_DOM_FRAGMENT: true }))
    renderMath(node, { delimiters: [
      { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
    ], throwOnError: false })
    for (const code of node.querySelectorAll('pre > code')) {
      const button = document.createElement('button')
      button.className = 'code-copy'
      button.textContent = '复制'
      button.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code.textContent ?? ''); button.textContent = '已复制' }
        catch { button.textContent = '复制失败' }
      })
      code.parentElement?.prepend(button)
    }
  }, [content])
  return <div className="markdown" ref={target} />
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  if (attachment.type === 'image' && /^data:image\//i.test(attachment.url)) {
    return <img src={attachment.url} alt={attachment.name || '图片附件'} />
  }
  if (attachment.type === 'audio' && /^data:audio\//i.test(attachment.url)) {
    return <audio controls src={attachment.url} aria-label={attachment.name || '音频附件'} />
  }
  return <span>{attachment.name || '附件'}</span>
}

function ChatMessage({ message }: { message: Message }) {
  const assistant = message.role === 'assistant'
  return <article className={`message ${message.role}`}>
    <p className="message-label">{assistant ? 'AI Studio' : message.role === 'system' ? '系统' : '你'}</p>
    {message.reasoning && <details className="reasoning"><summary>{message.pending ? '思考中' : '查看思考过程'}</summary><p>{message.reasoning}</p></details>}
    {assistant ? <Markdown content={message.content} /> : <div className="plain-message">{message.content}</div>}
    {!!message.attachments?.length && <div className="attachments">{message.attachments.map((attachment, i) =>
      <AttachmentView key={i} attachment={attachment} />)}</div>}
    {message.pending && !message.content && <p role="status" className="muted">正在生成…</p>}
    {message.notice && <p role="status" className="notice">{message.notice}</p>}
    {message.tokens !== undefined && message.tokens > 0 && <small className="muted">{message.tokens.toLocaleString()} tokens</small>}
  </article>
}

export default function Chat({ active }: { active: boolean }) {
  const [token, setToken] = useState(getToken)
  useEffect(() => {
    const update = () => setToken(getToken())
    update()
    window.addEventListener('user:login-changed', update)
    window.addEventListener('storage', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('user:login-changed', update)
      window.removeEventListener('storage', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return <Workspace key={token ?? 'anonymous'} token={token} active={active} />
}

function Workspace({ token, active }: { token: string | null; active: boolean }) {
  const chat = useChat(token)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const uploadVersion = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const drawer = useRef<HTMLDialogElement>(null)
  const editDialog = useRef<HTMLDialogElement>(null)
  const [edit, setEdit] = useState<{ session: Session; action: 'rename' | 'remove'; title: string }>()
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const selectedModel = (chat.preference.provider === 'free' ? chat.free : MODEL_CONFIG[chat.preference.provider]?.models)
    ?.find((model) => model.id === chat.preference.modelId)

  useEffect(() => {
    if (active && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [active, chat.messages])

  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = 'auto'
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 180)}px`
    }
  }, [active, draft])

  useEffect(() => {
    if (!active) {
      drawer.current?.close()
      editDialog.current?.close()
    }
  }, [active])

  useEffect(() => {
    if (active && edit && !editDialog.current?.open) editDialog.current?.showModal()
  }, [active, edit?.session.id, edit?.action])

  function resetAttachments() {
    uploadVersion.current++
    setReading(false)
    setAttachments([])
  }

  function newChat() {
    chat.newChat()
    setDraft('')
    resetAttachments()
    follow.current = true
    drawer.current?.close()
    composer.current?.focus()
  }

  function openSession(id: number) {
    drawer.current?.close()
    if (id === chat.session?.id && chat.operation) return
    setDraft('')
    resetAttachments()
    follow.current = true
    void chat.loadSession(id)
  }

  async function addFiles(files: FileList | null) {
    if (!selectedModel?.multi || !files?.length || reading) return
    const supported = Array.from(files).filter((file) => /^(image|audio)\//.test(file.type))
    if (!supported.length) { chat.setError('请选择图片或音频文件。'); return }
    const version = ++uploadVersion.current
    setReading(true)
    try {
      const items = await Promise.all(supported.map(async (file): Promise<Attachment> => ({
        type: file.type.startsWith('image/') ? 'image' : 'audio', url: await readFile(file), name: file.name,
      })))
      if (uploadVersion.current === version) setAttachments((previous) => [...previous, ...items])
    } catch (error) {
      if (uploadVersion.current === version) chat.setError(errorMessage(error))
    } finally {
      if (uploadVersion.current === version) setReading(false)
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!draft.trim() || chat.operation || !chat.preferenceReady || !token || reading) return
    if (chat.quota !== null && chat.quota <= 0 && chat.preference.provider !== 'free') {
      chat.setError('今日 Credits 已用完。可切换免费模型或明天再试。')
      return
    }
    follow.current = true
    void chat.send(draft.trim(), selectedModel?.multi ? attachments : [])
    setDraft('')
    resetAttachments()
  }

  function showEditor(session: Session, action: 'rename' | 'remove') {
    drawer.current?.close()
    setEdit({ session, action, title: session.title })
    setEditError('')
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!edit || saving || (edit.action === 'rename' && !edit.title.trim())) return
    setSaving(true)
    setEditError('')
    try {
      await chat.updateSession(edit.session.id, edit.action, edit.action === 'rename' ? edit.title.trim() : undefined)
      editDialog.current?.close()
      setEdit(undefined)
    } catch (error) { setEditError(errorMessage(error)) }
    finally { setSaving(false) }
  }

  const historyList = () => <>
    <button type="button" className="button sidebar-new" onClick={newChat}><Plus size={17} /> 新对话</button>
    <h2>会话历史</h2>
    {!token ? <a className="muted" href={authUrl()}>登录后查看历史 ↗</a> :
      !chat.sessions.length ? <p className="muted">还没有会话</p> :
        <ul className="history-list">{chat.sessions.map((session) =>
          <li key={session.id} className={chat.session?.id === session.id ? 'selected' : ''}>
            <button className="history-open" type="button" aria-current={chat.session?.id === session.id ? 'true' : undefined}
              title={session.title} onClick={() => openSession(session.id)}>
              {session.pinned ? <Pin size={13} aria-hidden="true" /> : null}<span>{session.title}</span>
            </button>
            <details className="session-menu"><summary aria-label={`管理会话 ${session.title}`}>···</summary>
              <div>
                <button type="button" onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  void chat.updateSession(session.id, 'pin').catch((error) => chat.setError(errorMessage(error)))
                }}>{session.pinned ? '取消置顶' : '置顶'}</button>
                <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); showEditor(session, 'rename') }}>重命名</button>
                <button type="button" className="danger-text" disabled={Boolean(chat.operation && chat.session?.id === session.id)}
                  onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); showEditor(session, 'remove') }}>删除</button>
              </div>
            </details>
          </li>)}</ul>}
  </>

  return <main className="chat-workspace" id={active ? 'main' : undefined}>
    <aside className="chat-sidebar">{historyList()}</aside>
    <dialog ref={drawer} className="chat-drawer" aria-label="会话历史" onClick={(event) => { if (event.target === event.currentTarget) drawer.current?.close() }}>
      <div><button className="icon-button drawer-close" aria-label="关闭历史" onClick={() => drawer.current?.close()}><X size={19} /></button>{historyList()}</div>
    </dialog>
    <dialog ref={editDialog} aria-labelledby="history-dialog-title" className="edit-dialog"
      onCancel={(event) => { if (saving) event.preventDefault() }} onClose={() => setEdit(undefined)}>
      {edit && <form onSubmit={saveEdit}>
        <h2 id="history-dialog-title">{edit.action === 'rename' ? '重命名会话' : '删除会话'}</h2>
        {edit.action === 'rename' ? <label>会话名称<input value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} maxLength={200} autoFocus /></label>
          : <p>「{edit.session.title}」及其中的消息将永久删除。</p>}
        {editError && <p role="alert" className="danger-text">{editError}</p>}
        <div className="actions"><button className="button" type="button" disabled={saving} onClick={() => editDialog.current?.close()}>取消</button>
          <button className={`button ${edit.action === 'remove' ? 'danger' : 'primary'}`} disabled={saving}>{edit.action === 'remove' ? '删除' : '保存'}</button></div>
      </form>}
    </dialog>
    <section className="chat-main" aria-label="对话">
      <header className="chat-header"><div>
        <button type="button" className="icon-button mobile-history" aria-label="打开历史" onClick={() => drawer.current?.showModal()}><History size={20} /></button>
        <span className="eyebrow chat-label">CHAT</span><h1>{chat.session?.title || 'AI 对话'}</h1>
      </div>{chat.quota !== null && <span className="quota" title="今日剩余额度">{chat.quota.toLocaleString()} <span>Credits</span></span>}</header>
      <div className="chat-scroll" ref={scroll} onScroll={() => {
        const node = scroll.current
        if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }}>
        <div className="transcript">
          {!chat.messages.length && <div className="chat-empty"><MessageSquare size={30} /><h2>今天想聊些什么？</h2>
            {!token && <a className="button" href={authUrl()}>登录或访客体验 <ArrowUp size={15} /></a>}</div>}
          {chat.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
        </div>
      </div>
      <div className="composer-area">
        {chat.error && <div className="composer-error" role="alert">{chat.error}<button type="button" className="icon-button" aria-label="关闭提示" onClick={() => chat.setError('')}><X size={15} /></button></div>}
        <form className="composer" onSubmit={submit} onDragOver={(event) => { if (selectedModel?.multi) event.preventDefault() }}
          onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(event.dataTransfer.files) } }}>
          {!!attachments.length && <div className="attachments">{attachments.map((attachment, i) =>
            <div key={i} className="attachment"><AttachmentView attachment={attachment} />
              <button type="button" className="icon-button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((items) => items.filter((_, index) => index !== i))}><X size={15} /></button>
            </div>)}</div>}
          <textarea ref={composer} rows={2} aria-label="消息" placeholder="输入消息…" value={draft} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
            }} />
          <div className="composer-controls">
            <select aria-label="模型" value={chat.preference.modelId} disabled={Boolean(chat.operation)}
              onChange={(event) => {
                const next = modelPreference(event.target.value, chat.preference.thinking, chat.free)
                chat.setPreference(next)
                if (!(next.provider === 'free' ? chat.free : MODEL_CONFIG[next.provider].models).find((model) => model.id === next.modelId)?.multi) resetAttachments()
              }}>
              {!chat.preferenceReady && <option value={chat.preference.modelId}>正在读取模型…</option>}
              {Object.entries(MODEL_CONFIG).filter(([provider]) => provider !== 'free').map(([provider, group]) =>
                <optgroup key={provider} label={group.name}>{group.models.map((model) => <option key={model.id} value={model.id}>{group.name} · {model.name}</option>)}</optgroup>)}
              {!!chat.free.length && <optgroup label="免费模型">{chat.free.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</optgroup>}
            </select>
            {chat.freeStatus === 'error' && <button type="button" onClick={() => void chat.reloadFree()}>重试免费列表</button>}
            {selectedModel?.multi && <button className="icon-button" type="button" title="添加附件" aria-label="添加附件" disabled={reading} onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>}
            <input type="file" accept="image/*,audio/*" multiple hidden ref={fileInput} onChange={(event) => {
              void addFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }} />
            {chat.preference.provider !== 'minimax' && <button className="think" type="button" aria-pressed={chat.preference.thinking} aria-label="深度思考"
              disabled={Boolean(chat.operation)} onClick={() => chat.setPreference({ ...chat.preference, thinking: !chat.preference.thinking })}><Sparkles size={16} /><span>深度思考</span></button>}
            {(chat.operation === 'send' || chat.operation === 'replay') ? <button className="send" type="button"
              aria-label={chat.operation === 'replay' ? '停止接收' : '停止生成'} onClick={chat.stop}><Square size={17} fill="currentColor" /></button>
              : <button className="send" type="submit" aria-label="发送" disabled={!token || !draft.trim() || reading || !!chat.operation || !chat.preferenceReady}><ArrowUp size={19} /></button>}
          </div>
        </form>
        <p className="composer-footnote">AI 可能出错，请核实重要信息。</p>
      </div>
    </section>
  </main>
}
