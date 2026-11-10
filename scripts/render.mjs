import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { renderHome } from '../build/prerender.js'

const template = await readFile('dist/index.html', 'utf8')
await writeFile('dist/index.html', template.replace('<div id="root"></div>', () =>
  `<div id="root" data-prerendered>${renderHome()}</div>`))
for (const [route, title] of [['chat', 'AI 对话'], ['tts', '语音合成']]) {
  const html = template
    .replace(/^[ \t]*<(?:meta (?:property="og:[^"]+"|name="description")|link rel="canonical")[^>]*>\n/gm, '')
    .replace('<title>AI Studio · Oscar Studio</title>',
      `<meta name="robots" content="noindex">\n  <title>${title} · AI Studio</title>`)
  await mkdir(`dist/${route}`, { recursive: true })
  await writeFile(`dist/${route}/index.html`, html)
}
