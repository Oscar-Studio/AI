import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, json, payload, readFile } from './api'

const sampleRate = 16000
const maxSeconds = 60
type Status = 'permission' | 'recording' | 'transcribing'
type Recording = { controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder; timer?: number }

function stopTracks(recording: Recording) {
  window.clearTimeout(recording.timer)
  recording.stream?.getTracks().forEach((track) => track.stop())
}

async function toWav(recording: Blob) {
  // Decoding in a 16 kHz context handles each browser's native recording format.
  const context = new OfflineAudioContext(1, 1, sampleRate)
  const audio = await context.decodeAudioData(await recording.arrayBuffer())
  const samples = Math.min(audio.length, sampleRate * maxSeconds)
  const wav = new DataView(new ArrayBuffer(44 + samples * 2))
  function writeTag(offset: number, text: string) {
    for (let index = 0; index < text.length; index++) wav.setUint8(offset + index, text.charCodeAt(index))
  }
  writeTag(0, 'RIFF')
  wav.setUint32(4, wav.byteLength - 8, true)
  writeTag(8, 'WAVEfmt ')
  wav.setUint32(16, 16, true)
  wav.setUint16(20, 1, true)
  wav.setUint16(22, 1, true)
  wav.setUint32(24, sampleRate, true)
  wav.setUint32(28, sampleRate * 2, true)
  wav.setUint16(32, 2, true)
  wav.setUint16(34, 16, true)
  writeTag(36, 'data')
  wav.setUint32(40, samples * 2, true)

  const channel = audio.getChannelData(0)
  for (let index = 0; index < samples; index++) {
    const value = Math.max(-1, Math.min(1, channel[index]))
    wav.setInt16(44 + index * 2, value * (value < 0 ? 32768 : 32767), true)
  }
  return new Blob([wav.buffer], { type: 'audio/wav' })
}

export function useVoiceInput(active: boolean, onText: (text: string) => void, onError: (message: string) => void) {
  const [status, setStatus] = useState<Status | null>(null)
  const current = useRef<Recording | null>(null)

  const release = useCallback(() => {
    const recording = current.current
    if (!recording) return
    current.current = null
    recording.controller.abort()
    if (recording.recorder?.state === 'recording') recording.recorder.stop()
    stopTracks(recording)
  }, [])

  const cancel = useCallback(() => {
    release()
    setStatus(null)
  }, [release])

  useEffect(() => {
    if (!active) cancel()
    return release
  }, [active, cancel, release])

  function finish(recording: Recording) {
    if (current.current !== recording) return
    current.current = null
    stopTracks(recording)
    setStatus(null)
  }

  async function start() {
    if (!active || current.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined'
      || typeof OfflineAudioContext === 'undefined') {
      onError('此浏览器无法录音，请使用支持麦克风录音的浏览器。')
      return
    }
    const recording: Recording = { controller: new AbortController() }
    current.current = recording
    setStatus('permission')
    onError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
      recording.stream = stream
      if (recording.controller.signal.aborted) { stopTracks(recording); return }
      const recorder = new MediaRecorder(stream)
      recording.recorder = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => {
        if (current.current !== recording) return
        onError('录音中断，请检查麦克风后重试。')
        cancel()
      }
      recorder.onstop = async () => {
        stopTracks(recording)
        if (current.current !== recording) return
        setStatus('transcribing')
        const { signal } = recording.controller
        try {
          if (!chunks.length) throw new Error('没有录到声音，请再试一次。')
          const wav = await toWav(new Blob(chunks, { type: recorder.mimeType }))
          const audio = (await readFile(wav)).split(',')[1]
          if (signal.aborted) return
          const result = await json<{ text: string }>('/chat/transcribe', {
            ...payload('POST', { audio }), signal,
          })
          if (signal.aborted) return
          if (result.text) onText(result.text)
          else onError('没有识别到语音，请再试一次。')
        } catch (error) {
          if (!signal.aborted) onError(errorMessage(error))
        } finally {
          finish(recording)
        }
      }
      recorder.start()
      recording.timer = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, maxSeconds * 1000)
      setStatus('recording')
    } catch (error) {
      if (current.current !== recording) return
      const name = error instanceof Error ? error.name : ''
      onError(name === 'NotAllowedError' ? '请允许浏览器访问麦克风后重试。'
        : name === 'NotFoundError' ? '没有找到可用的麦克风。' : '无法启动录音，请检查麦克风后重试。')
      finish(recording)
    }
  }

  function stop() {
    const recorder = current.current?.recorder
    if (recorder?.state === 'recording') {
      setStatus('transcribing')
      recorder.stop()
    }
  }

  return { status, start, stop, cancel }
}
