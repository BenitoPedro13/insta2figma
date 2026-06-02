import { framer } from "framer-plugin"
import { useState } from "react"
import "./App.css"

framer.showUI({ position: "top right", width: 320, height: 520 })

const API = "https://insta2figma-production.up.railway.app"

// ─── Spike 4: localStorage ────────────────────────────────────────────────
const STORAGE_KEY = "insta2figma-spike-session"
function loadToken(): string { return localStorage.getItem(STORAGE_KEY) ?? "" }
function saveToken(t: string) { localStorage.setItem(STORAGE_KEY, t) }

export function App() {
  const [token, setToken] = useState(loadToken)
  const [results, setResults] = useState<Record<string, string>>({})
  const [running, setRunning] = useState<string | null>(null)

  function log(key: string, value: string) {
    setResults(r => ({ ...r, [key]: value }))
  }

  // ─── Spike 1: CORS + fetch autenticado ───────────────────────────────────
  async function spikeCorsFetch() {
    setRunning("cors")
    try {
      const res = await fetch(`${API}/v1/health`)
      log("cors_health", `${res.status} ${res.ok ? "✅" : "❌"}`)
      if (token) {
        const res2 = await fetch(`${API}/v1/me`, {
          headers: { authorization: `Bearer ${token}` },
        })
        const body = await res2.json()
        log("cors_me", `${res2.status} planTier=${body?.data?.planTier ?? "?"} ✅`)
      } else {
        log("cors_me", "sem token — preenche abaixo")
      }
    } catch (e) {
      log("cors_health", `❌ ${String(e)}`)
    }
    setRunning(null)
  }

  // ─── Spike 2: addImage paralelo (fetch→File, 4 imagens) ──────────────────
  async function spikeAddImage() {
    setRunning("image")
    try {
      if (!framer.isAllowedTo("addImage")) {
        log("add_image", "❌ permissão negada — aceita o pedido no Framer")
        setRunning(null)
        return
      }
      const URLS = Array.from({ length: 20 }, (_, i) =>
        `https://picsum.photos/seed/${i}/400/400`
      )
      const t0 = Date.now()
      // 1. fetch em paralelo
      const files = await Promise.all(
        URLS.map(async (url, i) => {
          const res = await fetch(url)
          const blob = await res.blob()
          return new File([blob], `spike-${i}.jpg`, { type: blob.type })
        })
      )
      const fetchMs = Date.now() - t0
      // 2. addImage em paralelo
      await Promise.all(files.map(f => framer.addImage(f)))
      const totalMs = Date.now() - t0
      log("add_image", `✅ 20 imgs — fetch ${fetchMs}ms / total ${totalMs}ms`)
    } catch (e) {
      log("add_image", `❌ ${String(e)}`)
    }
    setRunning(null)
  }

  // ─── Spike 3: window.open ─────────────────────────────────────────────────
  function spikeWindowOpen() {
    try {
      window.open("https://mainnet.design/", "_blank")
      log("window_open", "✅ window.open não bloqueou")
    } catch (e) {
      log("window_open", `❌ ${String(e)}`)
    }
  }

  // ─── Spike 5: long-poll /v1/me/plan-events ───────────────────────────────
  async function spikeLongPoll() {
    if (!token) { log("long_poll", "sem token"); return }
    setRunning("poll")
    log("long_poll", "a aguardar (~25s)…")
    try {
      const res = await fetch(`${API}/v1/me/plan-events?currentTier=free`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      log("long_poll", `${res.status} changed=${body?.data?.changed} ✅`)
    } catch (e) {
      log("long_poll", `❌ ${String(e)}`)
    }
    setRunning(null)
  }

  function handleTokenSave(v: string) {
    setToken(v)
    saveToken(v)
    log("storage", v ? "✅ token guardado em localStorage" : "token limpo")
  }

  return (
    <main style={{ padding: 16, fontFamily: "sans-serif", fontSize: 13 }}>
      <h3 style={{ margin: "0 0 12px" }}>Spike — Framer ↔ Insta2Figma</h3>

      {/* Token input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
          JWT (cola aqui para testar auth)
        </label>
        <textarea
          style={{ width: "100%", height: 50, fontSize: 11, resize: "none" }}
          value={token}
          onChange={e => handleTokenSave(e.target.value)}
          placeholder="eyJhbGci…"
        />
      </div>

      {/* Spike buttons */}
      {[
        { key: "cors", label: "1. CORS + /v1/me", fn: spikeCorsFetch },
        { key: "image", label: "2. addImage por URL", fn: spikeAddImage },
        { key: "poll", label: "5. Long-poll /v1/me/plan-events", fn: spikeLongPoll },
      ].map(({ key, label, fn }) => (
        <button
          key={key}
          className="framer-button-primary"
          style={{ display: "block", width: "100%", marginBottom: 6 }}
          onClick={fn}
          disabled={running !== null}
        >
          {running === key ? "…" : label}
        </button>
      ))}

      <button
        className="framer-button-secondary"
        style={{ display: "block", width: "100%", marginBottom: 6 }}
        onClick={spikeWindowOpen}
        disabled={running !== null}
      >
        3. window.open
      </button>

      {/* Results */}
      <div style={{ marginTop: 12, background: "#f5f5f5", borderRadius: 6, padding: 10 }}>
        <strong>Resultados:</strong>
        {Object.entries(results).length === 0 && (
          <p style={{ color: "#999", margin: "4px 0 0" }}>— corre um spike acima —</p>
        )}
        {Object.entries(results).map(([k, v]) => (
          <div key={k} style={{ marginTop: 4 }}>
            <span style={{ color: "#666" }}>{k}: </span>
            <span>{v}</span>
          </div>
        ))}
      </div>

      <p style={{ color: "#999", fontSize: 11, marginTop: 10 }}>
        Spike 4 (localStorage): o token acima já testa — fecha e reabre o plugin
        para confirmar persistência.
      </p>
    </main>
  )
}
