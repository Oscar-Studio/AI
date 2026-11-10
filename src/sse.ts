// The chat proxy forwards provider frames, then appends its own usage frame.
export async function* readEvents<T>(body: ReadableStream<Uint8Array>, onChunk?: () => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let complete = false

  function* frames(final = false) {
    const lines = buffer.split(/\r\n|\n|\r(?!$)/)
    buffer = final ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try { yield JSON.parse(data) as T } catch { /* Ignore malformed upstream frames. */ }
    }
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      onChunk?.()
      buffer += decoder.decode(chunk.value, { stream: true })
      yield* frames()
    }
    buffer += decoder.decode()
    yield* frames(true)
    complete = true
  } finally {
    if (!complete) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
