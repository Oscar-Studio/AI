import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AudioLines, Download, Mic, Upload, WandSparkles, X } from 'lucide-react'
import { api, errorMessage, json, payload, readFile } from './api'
import ElevenVoices, { type Voice } from './ElevenVoices'

const BUILTIN_EXAMPLES = [
    { text: '明天就是周五了，真开心！',                          style: '开心' },
    { text: '哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！', style: '东北话' },
    { text: '呢个真係好正啊！食过一次就唔会忘记！',                  style: '粤语' },
    { text: '晚风吹过长街，灯光照亮回家的路。', style: '唱歌' }
];

const DESIGN_EXAMPLES = [
    { desc: '活泼开朗的年轻女孩，声音甜美清新',  text: '大家好，我是小美，很高兴认识你们！' },
    { desc: '沉稳有力的中年男性声音，播音员风格', text: '欢迎收听今天的新闻播报，本期主要内容有…' },
    { desc: '可爱的小朋友，声音稚嫩纯真',         text: '妈妈，妈妈，我今天在幼儿园画了一幅画！' }
];

const modes = {
  builtin: { label: '预设音色', model: 'mimo-v2.5-tts', icon: AudioLines },
  design: { label: '声音设计', model: 'mimo-v2.5-tts-voicedesign', icon: WandSparkles },
  clone: { label: '音色克隆', model: 'mimo-v2.5-tts-voiceclone', icon: Mic },
}
type Mode = keyof typeof modes
const voices = ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean']
const styles = ['开心', '悲伤', '东北话', '粤语', '唱歌', '悄悄话', '变快', '变慢']
const empty = { text: '', style: '', voice: voices[0] }
const elevenModel = 'elevenlabs/eleven-v4-turbo'
type Result = { url: string; name: string; format: 'WAV' | 'MP3' }
type Response = { choices?: { message?: { audio?: { data?: string } } }[] }
const waveform = [7, 15, 22, 13, 35, 51, 29, 60, 40, 68, 48, 24, 49, 64, 36, 49, 20, 31, 17, 24, 11]

export default function Tts({ active }: { active: boolean }) {
  const [mode, setMode] = useState<Mode>('builtin')
  const [drafts, setDrafts] = useState({ builtin: empty, design: empty, clone: empty })
  const [builtinModel, setBuiltinModel] = useState(modes.builtin.model)
  const [elevenVoice, setElevenVoice] = useState<Voice>({ id: 'sarah', name: 'Sarah' })
  const [sample, setSample] = useState<File | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const player = useRef<HTMLAudioElement>(null)
  const generation = useRef<AbortController | null>(null)
  const draft = drafts[mode]
  const isEleven = mode === 'builtin' && builtinModel === elevenModel

  useEffect(() => () => { generation.current?.abort() }, [])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => { if (!active) player.current?.pause() }, [active])

  function update(patch: Partial<typeof empty>) {
    setDrafts((old) => ({ ...old, [mode]: { ...old[mode], ...patch } }))
  }

  function selectFile(file?: File) {
    if (!file || busy) return
    if (!/\.(mp3|wav)$/i.test(file.name) && !['audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(file.type)) {
      setError('请选择 MP3 或 WAV 文件。')
    } else if (file.size > 10 * 1024 * 1024) {
      setError('音频样本大小不能超过 10 MB。')
    } else {
      setSample(file)
      setError('')
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (generation.current) return
    const text = draft.text.trim()
    if (!text) { setError('请输入要合成的文本。'); return }
    if (isEleven && [...text].length > 10000) { setError('Eleven v4 Turbo 最多支持 10,000 字符。'); return }
    if (mode === 'clone' && !sample) { setError('请先上传音频样本。'); return }
    const ctrl = new AbortController()
    generation.current = ctrl
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const audioData = mode === 'clone' && sample ? (await readFile(sample)).split(',')[1] : undefined
      if (ctrl.signal.aborted) return
      if (isEleven) {
        const response = await api('/tts', {
          ...payload('POST', { model: elevenModel, text, voice: elevenVoice.id }), signal: ctrl.signal,
        }, false)
        const audio = await response.blob()
        if (!audio.size || audio.type !== 'audio/mpeg') throw new Error('没有收到有效的 MP3 音频。')
        if (!ctrl.signal.aborted) setResult({ url: URL.createObjectURL(audio), name: `eleven-v4-turbo-${Date.now()}.mp3`, format: 'MP3' })
        return
      }
      const data = await json<Response>('/tts', {
        ...payload('POST', {
          model: modes[mode].model, text, voice: mode === 'builtin' ? draft.voice : undefined,
          style: draft.style.trim(), audioData,
        }), signal: ctrl.signal,
      }, false)
      const base64 = data.choices?.[0]?.message?.audio?.data
      if (!base64) throw new Error('没有收到音频数据。')
      if (!ctrl.signal.aborted) {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        setResult({ url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), name: `mimo-tts-${Date.now()}.wav`, format: 'WAV' })
      }
    } catch (error) {
      if (!ctrl.signal.aborted) setError(errorMessage(error))
    } finally {
      if (generation.current === ctrl) {
        generation.current = null
        setBusy(false)
      }
    }
  }

  return <main className="tts-workspace" id={active ? 'main' : undefined}>
    <header className="tts-header"><p className="eyebrow"><span className="signal" /> STUDIO / TTS</p>
      <h1>语音合成</h1><p>给文字选一种声音。</p>
    </header>
    <div className="tts-grid">
      <form className="tts-form panel" onSubmit={generate}>
        <div className="section-label"><span>01</span><h2>选择模式</h2></div>
        <div className="mode-row" role="group" aria-label="语音合成模式">
          {(Object.keys(modes) as Mode[]).map((key) => {
            const Icon = modes[key].icon
            return <button key={key} type="button" disabled={busy} aria-pressed={mode === key} onClick={() => {
              if (mode === key) return
              setMode(key); setResult(null); setError('')
            }}><Icon size={17} /><span>{modes[key].label}</span></button>
          })}
        </div>
        <div className="section-label"><span>02</span><h2>输入内容</h2></div>
        {mode === 'builtin' && <label>合成模型<select value={builtinModel} disabled={busy} onChange={(event) => {
          setBuiltinModel(event.target.value)
          setResult(null)
          setError('')
        }}>
          <option value={modes.builtin.model}>MiMo TTS</option>
          <option value={elevenModel}>Eleven v4 Turbo · OpenRouter</option>
        </select></label>}
        {isEleven && <ElevenVoices voice={elevenVoice} onSelect={setElevenVoice} disabled={busy || !active} />}
        {mode === 'clone' && <div className="clone-field">
          <input ref={fileInput} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden
            onChange={(event) => { selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          <button className="upload-area" type="button" disabled={busy} onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]) }}>
            <Upload size={19} /><span>上传或拖入音频样本 <small>MP3 / WAV · 最大 10 MB</small></span>
          </button>
          {sample && <div className="file-preview"><span>{sample.name}</span>
            <button className="icon-button" type="button" disabled={busy} aria-label="移除音频样本" onClick={() => setSample(null)}><X size={17} /></button></div>}
        </div>}
        {mode === 'design' && <label>声音描述<textarea rows={2} placeholder="例如，语速平稳、声音温和的年轻女性。" value={draft.style}
          onChange={(event) => update({ style: event.target.value })} /></label>}
        <label>要合成的文本<textarea rows={5} placeholder={isEleven ? '输入希望朗读的内容，可加入 [whispers] 等情绪标签。' : '输入希望朗读的内容…'} value={draft.text}
          onChange={(event) => update({ text: event.target.value })} />
          <small className="muted count">{(isEleven ? [...draft.text].length : draft.text.length).toLocaleString()}{isEleven ? ' / 10,000' : ''} 字符</small>
        </label>
        {mode !== 'design' && !isEleven && <div className="tts-fields">
          {mode === 'builtin' && <label>音色<select value={draft.voice} onChange={(event) => update({ voice: event.target.value })}>
            {voices.map((voice) => <option key={voice}>{voice}</option>)}</select></label>}
          <label>风格指导 <small className="muted">可选</small><input placeholder="例如，轻快地朗读" value={draft.style}
            onChange={(event) => update({ style: event.target.value })} /></label>
        </div>}
        {mode === 'builtin' && !isEleven && <div className="tts-suggestions">{styles.map((style) =>
          <button key={style} type="button" onClick={() => update({ style: [draft.style.trim(), style].filter(Boolean).join(' ') })}>{style}</button>)}</div>}
        {mode !== 'clone' && !isEleven && <details className="tts-examples"><summary>填入示例</summary><div className="tts-suggestions">
          {mode === 'builtin'
            ? BUILTIN_EXAMPLES.map((example) => <button type="button" key={example.style} onClick={() => update(example)}>{example.style}</button>)
            : DESIGN_EXAMPLES.map((example) => <button type="button" key={example.desc} onClick={() => update({ style: example.desc, text: example.text })}>{example.desc.split('，')[0]}</button>)}
        </div></details>}
        {error && <p className="danger-text" role="alert">{error}</p>}
        <button className="button primary" disabled={busy}><AudioLines size={17} /> {busy ? '正在生成…' : '生成语音'}</button>
      </form>
      <section className="tts-result panel" aria-label="试听与下载">
        <div className="section-label"><span>03</span><h2>试听与下载</h2></div>
        <div className="waveform" aria-hidden="true">{waveform.map((height, i) => <span key={i} style={{ height }} />)}</div>
        {result ? <div className="result-player">
          <p role="status">音频已生成</p>
          <audio ref={player} controls src={result.url} aria-label="试听生成的语音" />
          <a className="button" href={result.url} download={result.name}><Download size={17} /> 下载 {result.format}</a>
        </div> : <p className="muted" role="status">{busy ? '正在合成，完成后可以在这里试听。' : '生成后，音频会出现在这里。'}</p>}
      </section>
    </div>
  </main>
}
