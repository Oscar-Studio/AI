import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowDownRight, ArrowRight, AudioLines, MessageSquare, SunMoon } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'

const Chat = lazy(() => import('./Chat'))
const Tts = lazy(() => import('./Tts'))
const routes = ['home', 'chat', 'tts'] as const
const themeKey = 'ai_studio_theme'

function Landing() {
  return <main className="landing" id="main">
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="signal" /> OSCAR STUDIO / AI WORKSPACE</p>
        <h1>给想法一个<br />工作台<span>。</span></h1>
        <p className="hero-description">用不同的 AI 模型理清问题，把文字变成听得见的声音。</p>
        <div className="actions">
          <Link className="button primary" to="/chat/">开始对话 <ArrowRight size={17} /></Link>
          <Link className="button" to="/tts/">语音合成 <AudioLines size={17} /></Link>
        </div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <span>STUDIO / SIGNAL STUDIES</span>
        <svg viewBox="0 0 420 300" fill="none">
          <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="currentColor" opacity=".28"/></pattern></defs>
          <rect width="420" height="300" fill="url(#dots)"/>
          <path d="M20 150h380M210 22v256" stroke="currentColor" opacity=".3" strokeDasharray="4 5"/>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <ellipse key={n} cx="210" cy="150" rx="126" ry="62" transform={`rotate(${n * 20} 210 150)`} stroke="currentColor" strokeWidth="1.15" opacity={n === 1 ? 1 : .52}/>)}
          <circle cx="210" cy="150" r="8" fill="currentColor"/>
          <circle cx="330" cy="177" r="5" fill="currentColor"/>
        </svg>
        <span>FIG. 01 <span>TEXT ↔ AUDIO</span></span>
      </div>
    </section>
    <section aria-label="工作台功能" className="feature-list">
      <Link to="/chat/"><span className="feature-index">01 / CHAT</span><MessageSquare size={22} /><div><h2>多模型对话</h2><p>切换模型，发送文字、图片或音频。登录后可在不同设备继续已有对话。</p></div><ArrowDownRight size={21} /></Link>
      <Link to="/tts/"><span className="feature-index">02 / TTS</span><AudioLines size={22} /><div><h2>语音合成</h2><p>选择音色、描述想要的声音，或上传样本克隆音色。试听后可下载音频。</p></div><ArrowDownRight size={21} /></Link>
    </section>
    <footer><span>© Oscar Studio</span><a href="https://docs.oscarstudio.cn/ai/AI%20Studio">使用文档 ↗</a></footer>
  </main>
}

export default function App() {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, '')
  const page = path === '/chat' ? 'chat' : path === '/tts' ? 'tts' : ['', '/index.html'].includes(path) ? 'home' : 'missing'
  const [visited, setVisited] = useState({ chat: false, tts: false })
  const [theme, setTheme] = useState('system')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'system')
    const script = document.createElement('script')
    script.src = 'https://api.oscarstudio.cn/user-button.js'
    document.head.append(script)
    return () => script.remove()
  }, [])

  useEffect(() => {
    if (page === 'chat' || page === 'tts') setVisited((old) => old[page] ? old : { ...old, [page]: true })
    document.title = page === 'chat' ? 'AI 对话 · AI Studio' : page === 'tts' ? '语音合成 · AI Studio' : 'AI Studio · Oscar Studio'
    const robots = document.querySelector('meta[name="robots"]') ?? document.createElement('meta')
    robots.setAttribute('name', 'robots')
    robots.setAttribute('content', page === 'home' ? 'index, follow' : 'noindex')
    if (!robots.isConnected) document.head.append(robots)
    const canonical = document.querySelector('link[rel="canonical"]')
    if (page !== 'home') canonical?.remove()
    else if (!canonical) {
      const link = document.createElement('link')
      link.rel = 'canonical'
      link.href = 'https://ai.oscarstudio.cn/'
      document.head.append(link)
    }
  }, [page])

  function changeTheme(value: string) {
    setTheme(value)
    if (value === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = value
    try { localStorage.setItem(themeKey, value) } catch { /* Keep the current choice in memory. */ }
  }

  return <>
    <a className="skip" href="#main">跳到主要内容</a>
    <header className="site-header">
      <Link className="brand" to="/"><img src="/logo.png" alt="" width="28" height="28" /> AI Studio</Link>
      <nav aria-label="工作台">
        {routes.map((route) => <NavLink key={route} end={route === 'home'} className={page === route ? 'current' : ''}
          to={route === 'home' ? '/' : `/${route}/`}>{route === 'home' ? '首页' : route === 'chat' ? 'Chat' : 'TTS'}</NavLink>)}
      </nav>
      <div className="header-actions">
        <label className="theme-control"><SunMoon size={17} aria-hidden="true" />
          <select aria-label="主题" value={theme} onChange={(event) => changeTheme(event.target.value)}>
            <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
          </select>
        </label>
        <div id="userButtonContainer" />
      </div>
    </header>
    {page === 'home' && <Landing />}
    {page === 'missing' && <main className="landing" id="main"><h1>找不到此页面</h1><Link to="/">返回首页</Link></main>}
    {(visited.chat || page === 'chat') && <div hidden={page !== 'chat'}><Suspense fallback={<p className="loading">正在打开对话…</p>}><Chat active={page === 'chat'} /></Suspense></div>}
    {(visited.tts || page === 'tts') && <div hidden={page !== 'tts'}><Suspense fallback={<p className="loading">正在打开语音合成…</p>}><Tts active={page === 'tts'} /></Suspense></div>}
  </>
}
