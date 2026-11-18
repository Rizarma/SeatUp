import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import BenchApp from './bench/BenchApp.tsx'

const bench = new URLSearchParams(location.search).has('bench');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {bench ? <BenchApp /> : <App />}
  </StrictMode>,
)
