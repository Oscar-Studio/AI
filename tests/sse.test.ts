import assert from 'node:assert/strict'
import test from 'node:test'
import { readEvents } from '../src/sse.ts'

test('parses split CRLF and UTF-8 frames, including usage after DONE', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"text":"你好"}\r\n\r\ndata: [DONE]\n\ndata: {"tokens":12}')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  const frames = []
  for await (const frame of readEvents(stream)) frames.push(frame)
  assert.deepEqual(frames, [{ text: '你好' }, { tokens: 12 }])
  assert.equal(stream.locked, false)
})

test('releases and cancels the reader when the consumer stops', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"text":"part"}\n\n')) },
    cancel() { cancelled = true },
  })
  for await (const frame of readEvents(stream)) {
    assert.deepEqual(frame, { text: 'part' })
    break
  }
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})
