import { useEffect, useRef, useState } from 'react'
import { chat } from '../api/client'

// Inline markdown → React elements (no external dep)
function inlineFormat(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    const k = `${keyPrefix}-i${i}`
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={k}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={k}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={k} className="bg-black/10 dark:bg-white/10 px-1 rounded font-mono text-xs">{part.slice(1, -1)}</code>
    return part
  })
}

function renderMarkdown(text) {
  const lines = text.split('\n')
  const elements = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const k = `line-${i}`
    if (line.startsWith('### ')) {
      elements.push(<h3 key={k} className="font-semibold mt-2 mb-0.5">{inlineFormat(line.slice(4), k)}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={k} className="font-bold mt-3 mb-1">{inlineFormat(line.slice(3), k)}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={k} className="font-bold text-base mt-3 mb-1">{inlineFormat(line.slice(2), k)}</h1>)
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={k} className="border-current opacity-20 my-2" />)
    } else if (/^\s*[-*] /.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(<li key={i}>{inlineFormat(lines[i].replace(/^\s*[-*] /, ''), `li-${i}`)}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 pl-1">{items}</ul>)
      continue
    } else if (/^\d+\. /.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{inlineFormat(lines[i].replace(/^\d+\. /, ''), `oli-${i}`)}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 pl-1">{items}</ol>)
      continue
    } else if (line.trim() === '') {
      elements.push(<div key={k} className="h-1.5" />)
    } else {
      elements.push(<p key={k} className="leading-snug">{inlineFormat(line, k)}</p>)
    }
    i++
  }
  return elements
}

function Message({ role, content }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`
        max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm
        ${isUser
          ? 'bg-blue-600 text-white rounded-br-none'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-none'
        }
      `}>
        {isUser ? content : renderMarkdown(content)}
      </div>
    </div>
  )
}

// ── localStorage helpers ────────────────────────────────────────────────────
const STORAGE_KEY = 'logsense_chat_history'

function storageGet(sessionKey) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return all[sessionKey] || []
  } catch { return [] }
}

function storageSave(sessionKey, history) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    all[sessionKey] = history
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {}
}

function storageClear(sessionKey) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    delete all[sessionKey]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {}
}

// Session key: use session_id or '__global__' when no session is focused
const sessionKey = (id) => id || '__global__'

export default function ChatPanel({ sessions, focusedSessionId, onFocusSession }) {
  const [selectedSession, setSelectedSession] = useState(focusedSessionId || '')
  const [history, setHistory] = useState(() => storageGet(sessionKey(focusedSessionId || '')))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  // Ref always holds the current session so async callbacks can read it after re-renders
  const selectedSessionRef = useRef(selectedSession)

  // When the parent focuses a different session, switch to it
  useEffect(() => {
    if (focusedSessionId && focusedSessionId !== selectedSession) {
      setSelectedSession(focusedSessionId)
    }
  }, [focusedSessionId])

  // Load stored history whenever the active session changes
  useEffect(() => {
    selectedSessionRef.current = selectedSession
    setHistory(storageGet(sessionKey(selectedSession)))
  }, [selectedSession])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  const handleSessionChange = (newId) => {
    setSelectedSession(newId)
  }

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return

    // Snapshot the active session at send-time. All saves for this request
    // use this key, regardless of any session switch that happens during await.
    const activeSession = selectedSession
    const userMsg = { role: 'user', content: q }

    // Optimistically show user message and persist it
    setHistory(prev => {
      const next = [...prev, userMsg]
      storageSave(sessionKey(activeSession), next)
      return next
    })
    setInput('')
    setLoading(true)

    try {
      const res = await chat(q, activeSession || null, history)
      const assistantMsg = { role: 'assistant', content: res.answer }

      if (selectedSessionRef.current === activeSession) {
        // Still on the same session — update the visible chat
        setHistory(prev => {
          const next = [...prev, assistantMsg]
          storageSave(sessionKey(activeSession), next)
          return next
        })
      } else {
        // Session was switched while waiting — save silently, don't touch the DOM
        const saved = storageGet(sessionKey(activeSession))
        storageSave(sessionKey(activeSession), [...saved, assistantMsg])
      }
    } catch (err) {
      const errMsg = { role: 'assistant', content: `Error: ${err.message}` }
      if (selectedSessionRef.current === activeSession) {
        setHistory(prev => {
          const next = [...prev, errMsg]
          storageSave(sessionKey(activeSession), next)
          return next
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const clearChat = () => {
    storageClear(sessionKey(selectedSession))
    setHistory([])
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="card flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Chat with AI</h2>
          {history.length > 0 && (
            <button
              onClick={clearChat}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Session focus selector */}
        <select
          value={selectedSession}
          onChange={e => handleSessionChange(e.target.value)}
          className="w-full text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">No session focus (ask about all anomalies)</option>
          {(sessions || []).map(s => (
            <option key={s.session_id} value={s.session_id}>
              {s.session_id} (score: {s.anomaly_score?.toFixed(3)})
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {history.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-600 text-sm mt-8 space-y-3">
            <div className="text-3xl">💬</div>
            <p>Ask anything about the anomalies.</p>
            <div className="space-y-1 text-xs text-gray-400 dark:text-gray-600">
              <p>"What is the most critical anomaly?"</p>
              <p>"Summarise all high-severity issues"</p>
              <p>"What caused the failures in this session?"</p>
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <Message key={i} role={msg.role} content={msg.content} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-700 rounded-xl rounded-bl-none px-4 py-3 flex gap-1">
              {[0, 150, 300].map(d => (
                <span
                  key={d}
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about the anomalies… (Enter to send)"
            rows={2}
            className="flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary px-3 self-end"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
