import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from './App'

export function renderHome() {
  return renderToString(<StaticRouter location="/"><App /></StaticRouter>)
}
