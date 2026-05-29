# ADR-004: Retry com backoff exponencial em respostas 429/503

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, resiliência, retry, backoff, rate-limit

---

## Context

O scraper actual tem comportamento **fail-fast** em respostas 429 e 503: recebe o erro e imediatamente propaga uma excepção, que resulta numa mensagem de erro visível ao utilizador do plugin ("Instagram rate-limited preview requests. Wait about a minute and try again.").

Nem o Instagram respeita limites fixos nem as condições de rede são estáveis. Um 429 pode ser transitório — causado por um burst de pedidos nos últimos 10 segundos — e o Instagram pode aceitar o próximo pedido passados 5–15 segundos. Um único retry após uma espera curta resolveria a maioria dos casos sem o utilizador sequer notar.

Com as melhorias de cookies (ADR-002) e proxy (ADR-003), os 429s devem ser raros em condições normais. O retry é a **última linha de defesa** para absorver os casos residuais.

### Comportamento actual

```
fetch(IG) → 429 → throw ServiceUnavailableException → 503 para o plugin → erro no UI
```

### Comportamento alvo

```
fetch(IG) → 429 → wait 3s → retry → OK → retornar resultado (utilizador não vê nada)
fetch(IG) → 429 → wait 3s → retry → 429 → wait 9s → retry → OK → retornar resultado
fetch(IG) → 429 → wait 3s → retry → 429 → wait 9s → retry → 429 → throw (só agora o utilizador vê erro)
```

---

## Problem Statement

**Qual é a estratégia de retry certa para pedidos ao Instagram que recebem 429 ou erros transitórios de rede, tendo em conta que o preview é síncrono (o utilizador está à espera) e que o timeout total deve ser razoável?**

---

## Decision Drivers

1. **Transparência ao utilizador** — um retry de <5s total é invisível; um retry de >10s é perceptível mas aceitável com spinner; >20s total é inaceitável.
2. **Não amplificar o problema** — retries agressivos sem espera podem piorar o rate limit. O backoff é obrigatório.
3. **Jitter** — retries simultâneos de múltiplos utilizadores sem jitter criam thundering herd e amplificam o problema. Adicionar jitter aleatório.
4. **Diferenciação de erros** — nem todos os erros devem ter retry. 404 (username não existe) não deve ser retentado. 429 e erros de rede transitórios sim.
5. **Simplicidade** — a implementação não deve introduzir complexidade desnecessária. Não usar bibliotecas de retry externas quando a lógica é simples de escrever.

---

## Considered Options

### Opção A: Sem retry (estado actual)

**Como funciona:** fail-fast em qualquer erro.

**Prós:** simples, previsível, sem risco de amplificar problemas.

**Contras:** 429 transitório = erro visível ao utilizador, mesmo que passassem 5 segundos e funcionasse. UX má.

**Decisão:** rejeitado (é o problema que queremos resolver).

---

### Opção B: Retry fixo com delay constante

**Como funciona:** em caso de 429, esperar sempre X segundos e tentar uma vez mais.

```typescript
if (res.status === 429) {
  await sleep(5_000);
  res = await fetch(url, ...);
  if (res.status === 429) throw ...;
}
```

**Prós:** simples de implementar e entender.

**Contras:**
- Sem jitter → se vários utilizadores recebem 429 ao mesmo tempo, todos esperam 5s e retentem ao mesmo tempo → thundering herd.
- Delay fixo pode ser demasiado longo (5s para um erro que passa em 1s) ou demasiado curto (5s para um rate limit de 60s).

---

### Opção C: Backoff exponencial com jitter (estratégia escolhida)

**Como funciona:** na tentativa N, esperar `min(base * 2^N + jitter, maxDelay)` segundos antes de tentar.

Com `base=2s`, `maxDelay=15s`, `jitter=[0, 1s]`:
- Tentativa 1: wait ~2–3s → retry
- Tentativa 2: wait ~4–5s → retry
- Tentativa 3: throw

Total máximo com 2 retries: ~9s (invisível com spinner, aceitável).

**Prós:**
- Jitter dispersa thundering herd.
- Backoff aumenta a espera se o rate limit persistir.
- Cap no delay máximo evita esperas excessivas.
- Estratégia bem documentada (AWS, Google Cloud todas usam isto).

**Contras:**
- Ligeiramente mais complexo que delay fixo.
- Ainda pode falhar se o rate limit for de 60s+ (mas nesses casos o erro é inevitável).

---

### Opção D: Usar biblioteca de retry (ex. `p-retry`, `retry`)

**Como funciona:** usar `p-retry` ou similar que implementa o backoff por configuração.

**Prós:** menos código, mais testado.

**Contras:**
- Mais uma dependência para uma lógica que cabe em ~20 linhas.
- Menos controlo sobre o comportamento (ex.: quais erros retentam e quais não).
- `p-retry` está desactualizado (última versão ESM-only, incompatível com NestJS CommonJS).

**Decisão:** rejeitado. A lógica é simples o suficiente para implementar inline.

---

## Decision

**Opção C: Backoff exponencial com jitter, máximo 2 retries.**

### Parâmetros escolhidos

| Parâmetro | Valor | Razão |
|-----------|-------|-------|
| `baseDelayMs` | 2000 (2s) | Delay mínimo razoável sem ser imperceptível |
| `maxDelayMs` | 12000 (12s) | Acima disso a UX degrada; o utilizador prefere ver um erro a esperar >15s |
| `maxAttempts` | 3 (1 original + 2 retries) | 2 retries cobrem a maioria dos casos transitórios sem atrasar demasiado |
| `jitterMs` | [0, 1000] | Dispersa retries simultâneos |
| `backoffFactor` | 2 | Exponencial standard |

**Esperas por tentativa:**
- Retry 1: `2000 + rand(0–1000)` ms ≈ 2–3s
- Retry 2: `4000 + rand(0–1000)` ms ≈ 4–5s
- Total máximo: ~7–8s de espera + latência de rede

### Erros que têm retry

| Código HTTP | Tem retry? | Razão |
|-------------|-----------|-------|
| 429 | **Sim** | Rate limit transitório |
| 503 | **Sim** | Instagram temporariamente indisponível |
| Erro de rede (fetch exception) | **Sim** | Problema de rede transitório |
| 404 | **Não** | Username não existe — retry não ajuda |
| 400 | **Não** | Pedido inválido — retry não ajuda |
| 401 | **Não** | Sessão inválida — retry sem mudar cookie não ajuda |
| 403 | **Não** | Forbidden — tentar de novo agravaria |

---

## Implementation

### Helper de retry

Criar `apps/api/src/instagram/instagram-retry.ts`:

```typescript
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 12_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 503]);

function sleepWithJitter(attempt: number): Promise<void> {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.random() * 1_000;
  return new Promise((resolve) => setTimeout(resolve, exp + jitter));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { dispatcher?: unknown },
  label: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      console.warn(
        `[instagram-scraper] ${label} tentativa ${attempt + 1}/${MAX_ATTEMPTS} após ${Math.round(BASE_DELAY_MS * 2 ** (attempt - 1) / 1000)}s`,
      );
      await sleepWithJitter(attempt - 1);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Erro de rede — retentável
      lastError = err;
      continue;
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      lastError = new Error(`HTTP ${res.status}`);
      continue;
    }

    // 2xx, 4xx (não retentável), ou qualquer outra coisa — retornar tal qual
    return res;
  }

  // Esgotaram as tentativas
  throw lastError ?? new Error('Esgotadas as tentativas de fetch ao Instagram');
}
```

### Integração no scraper

Em `instagram-preview.service.ts`, substituir:

```typescript
// Antes:
res = await fetch(url, { method: 'GET', headers: this.buildIgHeaders(), signal: AbortSignal.timeout(25_000) });

// Depois:
res = await fetchWithRetry(
  url,
  { method: 'GET', headers: this.buildIgHeaders(), signal: AbortSignal.timeout(25_000), ...(agent ? { dispatcher: agent } : {}) },
  'profile-preview',
);
```

O mesmo para o endpoint de paginação do feed.

### Tratamento de 429 após retries

Depois de `fetchWithRetry`, o código de verificação de status existente ainda deve existir — mas só vai ser atingido se todos os retries também retornarem 429 (muito improvável com proxy + cookies):

```typescript
if (res.status === 429) {
  throw new ServiceUnavailableException(
    'Instagram rate-limited preview requests. Wait about a minute and try again.',
  );
}
```

### Timeout total

O `AbortSignal.timeout(25_000)` aplica-se a cada tentativa individual, não ao total. Com 2 retries, o timeout total pode ser até `3 × 25s + 7s de espera = ~82s` no pior caso.

Isso é demasiado para um preview síncrono. **Solução:** usar um AbortSignal com timeout total:

```typescript
const totalTimeout = AbortSignal.timeout(20_000); // 20s total para toda a operação

res = await fetchWithRetry(
  url,
  { method: 'GET', headers: this.buildIgHeaders(), signal: totalTimeout, ...agentOpts },
  'profile-preview',
);
```

Com timeout de 20s total, cada retry usa o tempo restante. Se o timeout expirar durante a espera do backoff, o `AbortSignal` cancela a operação.

---

## Consequences

### Positivo
- 429 transitórios são absorvidos silenciosamente — o utilizador não vê erro.
- Jitter previne thundering herd.
- Erros não-retentáveis (404, 400) continuam a falhar imediatamente — sem delay desnecessário.
- A lógica é isolada num helper testável.

### Negativo
- Latência do preview aumenta quando há retry (2–8s adicional).
- O serviço pode demorar mais a responder em condições degradadas — o Railway pode timeout a ligação antes do retry terminar se o request timeout do Railway for < 20s.

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Retry amplifica rate limit | Baixa | Backoff + jitter dispersa pedidos; 2 retries máximo |
| Railway timeout < retry total | Média | Verificar timeout do Railway (default: 30s); o timeout de 20s fica dentro do limite |
| Retry em 503 que é persistente | Baixa | Após 3 tentativas, falha normalmente; o utilizador vê a mensagem correcta |

### Evolução

Se o volume crescer e os 429s persistirem mesmo com proxy + cookies + retry:
1. Aumentar `MAX_ATTEMPTS` para 4 (mas aumentar `maxDelayMs` para compensar).
2. Considerar fila de preview assíncrono (preview não síncrono mas notificado via webhook/polling) — permite retries mais longos sem degradar UX.
3. Adicionar circuit breaker: se >50% dos pedidos dos últimos 60s falharam com 429, parar de tentar e retornar erro imediatamente até a janela recuperar.

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts` — onde integrar `fetchWithRetry`
- `apps/api/src/instagram/instagram-retry.ts` — ficheiro a criar
- [AWS: Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — referência sobre o algoritmo
- ADR-002 — cookies de sessão (reduz necessidade de retry)
- ADR-003 — proxy residencial (reduz necessidade de retry)
