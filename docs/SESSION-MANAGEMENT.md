# Gestão de Sessões Instagram

Guia de referência para criar, renovar e monitorizar as sessões (cookies) usadas pelo scraper.

---

## Como funciona

Cada sessão é uma conta Instagram + cookie de autenticação (opcional proxy dedicado). O sistema roda entre sessões em round-robin e marca automaticamente as inválidas (HTTP 401/403).

As sessões são carregadas de três fontes, por ordem de prioridade:

1. **Redis** (`ig:session-pool`) — actualizado pelo endpoint admin sem redeploy
2. **Env var `IG_SESSION_POOL`** — fallback se Redis não tiver sessões
3. **Env var `IG_SESSION_COOKIE`** (legacy) — conta única, sem proxy

Tanto a API como o Worker verificam o Redis a cada 60 segundos e recarregam automaticamente se as sessões mudaram.

---

## 1. Criar uma conta de serviço (CDP automatizado)

Os scripts CDP automatizam a criação de contas Google/Gmail e Instagram via Chrome DevTools Protocol. As credenciais e sessões são guardadas localmente em `scripts/accounts.json` e `scripts/sessions.json` (ambos em `.gitignore`).

### Pré-requisitos

- Google Chrome instalado
- `SMS5SIM_API_KEY` no `.env` raiz (para verificação por OTP via [5sim.net](https://5sim.net))
- `VONAGE_API_KEY` + `VONAGE_API_SECRET` + `VONAGE_FROM_NUMBER` no `.env` raiz (para verificação de dispositivo via SMS)
- `scripts/proxies.txt` com proxies no formato `host:port:user:pass` (um por linha)

### Fluxo sem proxy (conta ligada ao IP do servidor)

```bash
# 1. Criar conta Gmail
pnpm cdp:launch

# 2. Criar conta Instagram com o Gmail criado
pnpm cdp:instagram
# → pausa e pede o código de confirmação do Gmail (abrir manualmente)

# 3. Gerar o valor de IG_SESSION_POOL
pnpm cdp:pool
```

### Fluxo com proxy (recomendado — cada conta num IP dedicado)

```bash
# 1. Criar conta Gmail através do proxy N (ex: linha 9 de proxies.txt)
pnpm cdp:launch --proxy=9
# ou proxy aleatório: pnpm cdp:proxy

# 2. Criar conta Instagram — reutiliza automaticamente o mesmo proxy (.proxy-session)
pnpm cdp:instagram:proxy
# → pausa e pede o código de confirmação do Gmail

# 3. Gerar IG_SESSION_POOL (inclui proxy na entrada)
pnpm cdp:pool
```

O `pnpm cdp:pool` lê `scripts/sessions.json` e imprime apenas os campos necessários para `IG_SESSION_POOL` (`account`, `cookie`, `proxy` se existir).

### Opções do script cdp.mjs

| Comando | Comportamento |
|---------|--------------|
| `pnpm cdp:launch` | Lança Chrome sem proxy |
| `pnpm cdp:launch --proxy=9` | Usa proxy da linha 9 de `proxies.txt`, guarda em `.proxy-session` |
| `pnpm cdp:proxy` | Proxy aleatório de `proxies.txt` (ou reutiliza `.proxy-session`) |
| `pnpm cdp:reset` | Limpa `.proxy-session` |
| `pnpm cdp:instagram` | Cria conta Instagram sem proxy |
| `pnpm cdp:instagram:proxy` | Cria conta Instagram com proxy de `.proxy-session` |

---

## 2. Extrair o cookie manualmente (alternativa)

Se preferires criar a conta manualmente, extrai o cookie via DevTools:

1. DevTools → **Network** → qualquer pedido a `i.instagram.com`
2. **Request Headers** → campo `Cookie:`
3. Copia o valor `sessionid=...`

Adiciona a entrada directamente a `scripts/sessions.json` e corre `pnpm cdp:pool`.

---

## 3. Actualizar sessões

### Opção A — Hot-reload (sem redeploy) ✅ recomendado

```bash
curl -X POST https://<api>.up.railway.app/admin/sessions \
  -H "x-admin-key: <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {
        "account": "bot1",
        "cookie": "sessionid=ABC; csrftoken=XYZ; ds_user_id=111; mid=M1; ig_did=D1",
        "proxy": "http://user:pass@proxy:porta"
      }
    ]
  }'
```

O endpoint guarda as sessões em Redis e recarrega imediatamente na API. O Worker apanha a mudança dentro de 60 segundos.

Para adicionar uma segunda conta sem perder a primeira, o script `ig-cookie-helper.mjs` faz o merge automaticamente se `IG_SESSION_POOL` estiver definido no ambiente local.

### Opção B — Env var (com redeploy)

Actualiza `IG_SESSION_POOL` no Railway e faz redeploy. Formato (numa linha):

```
[{"account":"bot1","cookie":"sessionid=...","proxy":"http://user:pass@host:porta"},{"account":"bot2","cookie":"sessionid=..."}]
```

---

## 4. Ver estado das sessões

```bash
curl https://<api>.up.railway.app/admin/sessions \
  -H "x-admin-key: <ADMIN_KEY>"
```

Resposta:

```json
{
  "count": 2,
  "activeCount": 1,
  "sessions": [
    { "account": "bot1", "proxy": "http://...@host:port", "active": true },
    { "account": "bot2", "active": false }
  ]
}
```

`active: false` significa que a sessão foi marcada inválida (401/403). Um redeploy ou POST /admin/sessions resolve.

---

## 5. Alertas automáticos

Quando uma sessão fica inválida, o sistema pode notificar automaticamente via webhook.

### Discord

1. Server Settings → Integrations → Webhooks → New Webhook → copia o URL
2. Adiciona ao Railway: `ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...`

### Slack

1. api.slack.com → Your Apps → Incoming Webhooks → Add New Webhook
2. Adiciona ao Railway: `ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...`

Mensagem enviada quando uma sessão expira:

```
⚠️ Instagram session invalid: `bot1`
Active sessions: 1/2
Renew: `POST /admin/sessions` or update `IG_SESSION_POOL` in Railway.
```

Se todas as sessões ficarem inválidas:

```
🚨 ALL sessions invalid — scraping without authentication!
```

---

## 6. Monitorização

```bash
curl https://<api>.up.railway.app/admin/scrape-health \
  -H "x-admin-key: <ADMIN_KEY>"
```

Mostra error rate, cache hit rate, latência p50/p95 e breakdown por sessão na última hora. Útil para detectar degradação antes de uma sessão ser totalmente bloqueada.

---

## 7. Ciclo de vida esperado

| Evento | Tempo esperado | Acção |
|--------|---------------|-------|
| Cookie válido | Semanas a meses | — |
| Instagram invalida a sessão | Aleatório | Alerta automático + renovar |
| Rate limit 429 | Pontual | Retry automático (ADR-004) |
| `checkpoint_required` | Na criação | Criar conta com proxy activo (secção 1) |

Mantém pelo menos **2 contas** no pool para resiliência — se uma for bloqueada, a outra continua.

---

## 8. Troubleshooting

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| `active: false` na sessão | Cookie expirou ou conta bloqueada | Renovar cookie (secção 2) + POST /admin/sessions |
| `activeCount: 0` | Todas as sessões inválidas | Renovar todas as sessões urgentemente |
| Sem alerta no Discord/Slack | `ALERT_WEBHOOK_URL` não configurado | Adicionar env var no Railway |
| Worker não apanha sessões novas | Redis poll demora até 60s | Aguardar 1 min ou fazer redeploy do worker |
| `checkpoint_required` no scraper | Sessão criada noutro IP | Recriar conta com o proxy activo (secção 1) |

Ver também: [ADR-002 — Session cookies](./adr/ADR-002-session-cookies-instagram.md), [RAILWAY.md](./RAILWAY.md)
