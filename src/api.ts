const origin = 'https://api.oscarstudio.cn'
export const sessionsPath = '/chat-sessions'

export function getToken() {
  const cookie = document.cookie.split('; ').find((item) => item.startsWith('userToken='))?.slice('userToken='.length)
  if (cookie) return cookie
  try { return localStorage.getItem('ai_token') || localStorage.getItem('userToken') } catch { return null }
}

export function authUrl() {
  return `${origin}/auth.html?return=${encodeURIComponent(location.href)}`
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api(path: string, options: RequestInit = {}, authenticated = true) {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  const token = authenticated ? getToken() : null
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${origin}/api${path}`, {
    ...options, headers, credentials: authenticated ? 'include' : 'omit',
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const message = response.status === 429 ? '请求过于频繁或模型繁忙。请稍后重试，或切换模型。'
      : response.status === 401 ? '请登录 Oscar Studio 后继续。'
        : data.message || `请求失败（${response.status}）`
    throw new ApiError(response.status, message)
  }
  return response
}

export async function json<T>(path: string, options?: RequestInit, authenticated?: boolean): Promise<T> {
  const data = await (await api(path, options, authenticated)).json()
  if (data.success === false) throw new Error(data.message || '请求失败')
  return data
}

export function payload(method: string, data?: unknown): RequestInit {
  return { method, body: data === undefined ? undefined : JSON.stringify(data) }
}

export function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取该文件'))
    reader.readAsDataURL(file)
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}
