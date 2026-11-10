import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './style.css'

const root = document.getElementById('root')!
if (location.pathname === '/index.html') history.replaceState(null, '', '/' + location.search + location.hash)
const app = <BrowserRouter><App /></BrowserRouter>
if (root.hasAttribute('data-prerendered') && location.pathname === '/') hydrateRoot(root, app)
else createRoot(root).render(app)
