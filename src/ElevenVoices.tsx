import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { errorMessage, json } from './api'

export type Voice = { id: string; name: string }
type SharedVoice = Voice & { accent?: string; language?: string; previewUrl?: string }
type VoicePage = { voices: SharedVoice[]; hasMore: boolean }

const presets = ['George', 'Sarah', 'Adam', 'Alice', 'Bella', 'Bill', 'Brian', 'Callum', 'Charlie', 'Chris',
  'Daniel', 'Eric', 'Harry', 'Jessica', 'Laura', 'Liam', 'Lily', 'Matilda', 'River', 'Roger', 'Will']

export default function ElevenVoices({ voice, onSelect, disabled }: {
  voice: Voice; onSelect: (voice: Voice) => void; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('zh')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<VoicePage>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<SharedVoice>()
  const [previewFailed, setPreviewFailed] = useState(false)
  const panel = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (!open || disabled) return
    const controller = new AbortController()
    setError('')
    setData(undefined)
    const timeout = window.setTimeout(async () => {
      const query = new URLSearchParams({ search: search.trim(), language, page: String(page) })
      try {
        const result = await json<VoicePage>(`/tts/voices?${query}`, { signal: controller.signal }, false)
        if (!controller.signal.aborted) setData(result)
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error))
      }
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [open, search, language, page, attempt, disabled])

  useEffect(() => {
    if (disabled) setPreview(undefined)
  }, [disabled])

  function choose(voice: Voice) {
    onSelect(voice)
    setPreview(undefined)
    if (panel.current) {
      panel.current.open = false
      panel.current.querySelector('summary')?.focus()
    }
  }

  return <details className="eleven-voices" ref={panel} onToggle={(event) => {
    setOpen(event.currentTarget.open)
    if (!event.currentTarget.open) setPreview(undefined)
  }}>
    <summary>音色 · {voice.name}</summary>
    <div className="eleven-voice-controls">
      <label>预设音色<select disabled={disabled} value={presets.includes(voice.name) && voice.id === voice.name.toLowerCase() ? voice.name : ''}
        onChange={(event) => choose({ id: event.target.value.toLowerCase(), name: event.target.value })}>
        <option value="" disabled>已选共享音色</option>
        {presets.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <div className="eleven-voice-search">
        <label>搜索共享音色<input type="search" maxLength={100} placeholder="例如，Mandarin" value={search}
          disabled={disabled} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
          onChange={(event) => { setSearch(event.target.value); setPage(0); setPreview(undefined) }} /></label>
        <label>语言<select value={language} disabled={disabled} onChange={(event) => { setLanguage(event.target.value); setPage(0); setPreview(undefined) }}>
          <option value="">全部</option><option value="zh">中文</option><option value="yue">粤语</option>
          <option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option>
        </select></label>
      </div>
      {error ? <div className="eleven-voice-pagination"><p className="danger-text" role="status">{error}</p>
        <button type="button" disabled={disabled} onClick={() => setAttempt(attempt + 1)}>重试</button></div>
        : !data ? <p className="muted" role="status">正在加载共享音色…</p>
        : data.voices.length === 0 && <p className="muted" role="status">没有找到匹配的音色。</p>}
      {!!data?.voices.length && <ul className="eleven-voice-list">{data.voices.map((item) => <li key={item.id}>
        <button className="eleven-voice-option" type="button" disabled={disabled} aria-pressed={item.id === voice.id}
          onClick={() => choose(item)}>{item.name}{item.accent && <small className="muted">{item.accent}</small>}</button>
        {item.previewUrl && <button type="button" className="icon-button" title="试听" aria-label={`试听 ${item.name}`}
          disabled={disabled} onClick={() => { setPreviewFailed(false); setPreview(item) }}><Play size={16} /></button>}
      </li>)}</ul>}
      {preview?.previewUrl && <audio key={preview.id} controls autoPlay src={preview.previewUrl}
        onError={() => setPreviewFailed(true)} aria-label={`试听 ${preview.name}`} />}
      {preview && previewFailed && <p role="status" className="muted">暂时无法加载这个试听样本。</p>}
      {(page > 0 || data?.hasMore) && <div className="eleven-voice-pagination">
        <button type="button" disabled={disabled || page === 0} onClick={() => { setPreview(undefined); setPage(page - 1) }}>上一页</button>
        <span className="muted">第 {page + 1} 页</span>
        <button type="button" disabled={disabled || !data?.hasMore} onClick={() => { setPreview(undefined); setPage(page + 1) }}>下一页</button>
      </div>}
    </div>
  </details>
}
