# ADR-003: Routing de pedidos ao Instagram via proxy residencial

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, proxy, rede, infraestrutura

---

## Context

O servidor de produção corre no Railway, cujos IPs pertencem a blocos de datacenter conhecidos (AWS, GCP, etc.). O Instagram mantém internamente classificações de reputação por IP e aplica thresholds de rate limit muito mais agressivos a IPs de cloud do que a IPs residenciais.

Mesmo com cookies de sessão válidos (ADR-002), pedidos que chegam de um IP de datacenter são tratados com mais desconfiança. Em condições de carga moderada (vários utilizadores a pedir previews ao mesmo tempo), o IP do Railway atinge o threshold e começa a receber 429 para todos os pedidos, independentemente da sessão.

Um proxy residencial encaminha o pedido por um IP de um utilizador doméstico real — o Instagram não consegue distingui-lo de tráfego orgânico. O threshold é ordens de magnitude mais alto.

### Estado actual

```
Plugin → API (Railway IP: 34.x.x.x) → Instagram
                  ↑ flagged as datacenter
```

### Estado alvo

```
Plugin → API (Railway) → Proxy Residencial (IP: 82.x.x.x casa em Lisboa) → Instagram
                                         ↑ looks organic
```

---

## Problem Statement

**Como encaminhar pedidos HTTP do scraper para o Instagram por um IP residencial, de forma transparente, segura e com custo proporcional ao volume actual?**

---

## Decision Drivers

1. **Transparência** — o proxy deve ser configurável via env var sem alterar a lógica de scraping.
2. **Custo** — o volume actual não justifica fornecedores premium caros. Pagar apenas pelo que se usa.
3. **Compatibilidade** — o scraper usa `fetch` nativo do Node; o proxy deve ser compatível (HTTP CONNECT ou SOCKS5 com biblioteca de suporte).
4. **Latência** — o proxy adiciona latência; deve ser <200ms adicional para não piorar a experiência de preview.
5. **Redundância** — se o proxy falhar, o sistema deve degradar graciosamente (tentar sem proxy, logar aviso).

---

## Considered Options

### Opção A: Nenhum proxy (estado actual)

**Como funciona:** pedidos vão diretamente do Railway para o Instagram.

**Prós:** sem configuração, sem custo.

**Contras:** IP de datacenter → 429 frequente, especialmente em horas de pico. Não resolve o problema.

**Decisão:** rejeitado (é o problema que queremos resolver).

---

### Opção B: Proxy residencial pago — Webshare

**Como funciona:** Webshare tem um tier gratuito (10 proxies residenciais, 1GB/mês) e tiers pagos (~$2.99/mês para 10GB). Fornece proxy HTTP/SOCKS5 com autenticação por user:password.

**Prós:**
- Tier gratuito suficiente para desenvolvimento e volume baixo (preview = ~20KB por pedido; 1GB = ~50.000 previews/mês).
- Setup simples: URL no formato `http://user:password@proxy.webshare.io:80`.
- IPs residenciais com boa reputação.
- Suporte a rotação automática de IP (usar endpoint de rotação).

**Contras:**
- Tier gratuito tem 10 IPs fixos (não rotativos).
- Tiers pagos adicionam custo mensal fixo mesmo se o volume for baixo.

---

### Opção C: Proxy residencial — Bright Data (ex-Luminati)

**Como funciona:** maior rede de proxies residenciais do mercado. Preço: ~$8.4/GB (pay-as-you-go) ou planos mensais.

**Prós:**
- Pool de milhões de IPs residenciais em todo o mundo.
- Rotação automática por pedido.
- Uptime SLA de 99.9%.
- Suporte a sticky sessions (mesmo IP durante N segundos).

**Contras:**
- Custo: $8.4/GB × volume → para 50.000 previews/mês ≈ 1GB ≈ $8.4/mês. Aceitável, mas mais caro que Webshare.
- Overkill para o volume actual.

---

### Opção D: Proxy residencial — Oxylabs

**Como funciona:** similar ao Bright Data. Preços competitivos (~$8/GB para residencial, com plano mínimo mensal de ~$60).

**Prós:**
- Rede grande, boa reputação.
- Bom suporte técnico.

**Contras:**
- Plano mínimo mensal muito alto para o volume actual.

**Decisão:** rejeitado para fase inicial. Reconsiderar se o volume crescer.

---

### Opção E: Proxy SOCKS5 auto-gerido (VPS doméstico)

**Como funciona:** um VPS num ISP residencial (ex. Hetzner com IP residencial, ou um Raspberry Pi em casa) corre um servidor SOCKS5.

**Prós:**
- Custo muito baixo (~€4/mês para um VPS).
- Controlo total.

**Contras:**
- Operacional: se o VPS cair, o scraping pára.
- Um único IP: se ficar bloqueado, não há rotação.
- Responsabilidade operacional adicional.

**Decisão:** rejeitado. Adiciona infra para gerir sem redundância.

---

## Decision

**Opção B: Webshare, começando no tier gratuito.**

Webshare tier gratuito cobre o volume actual (desenvolvimento + utilizadores early access). Quando o volume ultrapassar 1GB/mês ou se os 10 IPs fixos ficarem queimados, migrar para o tier pago com rotação ($2.99–15/mês).

A implementação usa `HTTP_PROXY_URL` como env var (formato standard), o que torna trivial mudar de fornecedor sem alterar código.

### Por que não Bright Data logo?

O custo de Bright Data é justificado quando o produto tem receita que o suporta. O tier gratuito do Webshare é suficiente para validar que o proxy resolve o problema antes de comprometer custos maiores.

### Fallback sem proxy

Se `HTTP_PROXY_URL` não estiver configurada, o scraper funciona sem proxy (comportamento actual). Isso permite:
- Desenvolvimento local sem configurar proxy.
- Degradação graciosa se o proxy falhar.

---

## Implementation

### Fetch nativo do Node.js não suporta proxy HTTP nativamente

O `fetch` global do Node.js (v18+) **não respeita** as variáveis de ambiente `HTTP_PROXY` / `HTTPS_PROXY`. É necessário usar um `dispatcher` (undici) ou uma biblioteca como `https-proxy-agent`.

**Solução recomendada:** `https-proxy-agent` (leve, sem dependências pesadas, compatível com `fetch`).

```bash
pnpm add --filter api https-proxy-agent
```

### Helper de proxy

Criar `apps/api/src/instagram/instagram-proxy.ts`:

```typescript
import { HttpsProxyAgent } from 'https-proxy-agent';

let _agent: HttpsProxyAgent<string> | undefined;

export function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = process.env.HTTP_PROXY_URL?.trim();
  if (!url) return undefined;
  if (!_agent) {
    _agent = new HttpsProxyAgent(url);
    console.info('[instagram-scraper] proxy configurado:', url.replace(/:\/\/[^@]+@/, '://***@'));
  }
  return _agent;
}
```

O módulo cria o agente uma vez (singleton) para reutilizar a conexão TCP ao proxy.

### Integração no scraper

Em `instagram-preview.service.ts`, ao chamar `fetch`:

```typescript
import { getProxyAgent } from './instagram-proxy';

// No fetch call:
const agent = getProxyAgent();
res = await fetch(url, {
  method: 'GET',
  headers: this.buildIgHeaders(),
  signal: AbortSignal.timeout(25_000),
  ...(agent ? { dispatcher: agent } : {}),
});
```

**Nota:** `https-proxy-agent` implementa a interface `Dispatcher` do undici que o `fetch` do Node usa internamente.

### Env var

```
HTTP_PROXY_URL="http://username:password@proxy.webshare.io:80"
```

Para Webshare com rotação de IP a cada pedido, usar o endpoint rotativo:
```
HTTP_PROXY_URL="http://username:password@rotating-residential.webshare.io:9000"
```

### Registo de configuração no `.env.example`

```bash
# Proxy residencial para pedidos ao Instagram (opcional mas recomendado em produção)
# Formato: http://user:pass@host:port
# Sem esta variável, os pedidos vão directamente do Railway (IP de datacenter)
HTTP_PROXY_URL=
```

### Configuração no Railway

Railway > insta2figma-api > Variables > Add Variable:
- Name: `HTTP_PROXY_URL`
- Value: `http://username:password@rotating-residential.webshare.io:9000`

A password não é exposta em logs porque o helper redacta a URL (ver `redactUrl()` em `plugin-fetch.ts` para o padrão a seguir).

### Testar o proxy

```bash
# Verificar qual IP o proxy usa
curl -x "http://user:pass@host:port" https://httpbin.org/ip

# Deve mostrar um IP residencial, não Railway
```

---

## Consequences

### Positivo
- O Instagram vê IPs residenciais → thresholds muito mais altos.
- Combinado com cookies de sessão (ADR-002), o risco de 429 em condições normais é muito baixo.
- Mudar de fornecedor de proxy é uma mudança de env var — sem alterar código.

### Negativo
- Latência adicional de 50–150ms por pedido (roundtrip ao proxy).
- O proxy é mais um ponto de falha. Se o Webshare tiver downtime, os previews degradam.
- Custo mensal quando o tier gratuito esgotar.

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| IPs do Webshare ficam queimados | Média (com tier fixo) | Migrar para tier rotativo ($2.99/mês) ou Bright Data |
| Proxy em downtime | Baixa | Fallback sem proxy (degradação graciosa); alertar em logs |
| Credenciais do proxy em logs | Baixa | Redactar URL nos logs (substituir `user:pass` por `***`) |
| Latência inaceitável | Baixa | Medir latência com proxy; se >500ms, trocar datacenter do proxy |

### Evolução

Quando o volume ultrapassar ~50.000 previews/mês:
1. Migrar para Webshare tier pago com rotação automática de IP.
2. Se ainda houver 429s, avaliar Bright Data ou Oxylabs.
3. Considerar pool de proxies com health-check e failover (ADR futuro).

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts` — onde integrar o proxy agent
- `apps/api/.env.example` — adicionar `HTTP_PROXY_URL=`
- [Webshare docs](https://help.webshare.io/) — configuração de proxy HTTP
- [https-proxy-agent npm](https://www.npmjs.com/package/https-proxy-agent) — biblioteca de proxy
- ADR-002 — cookies de sessão (complementar)
- ADR-004 — retry/backoff (complementar)
