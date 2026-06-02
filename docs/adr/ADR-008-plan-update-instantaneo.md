# ADR-008: Atualização instantânea do plano após checkout (long-polling vs SSE)

**Status:** Accepted (long-polling) — SSE no iframe documentado como caminho de upgrade futuro
**Date:** 2026-06-02
**Deciders:** Benito Pedro
**Tags:** billing, plugin, realtime, sse, long-polling, redis, architecture

---

## Context

Depois de um utilizador completar o checkout do Polar, o plugin precisa de refletir o novo plano (`free → pro → max`) na UI. Hoje isso é feito por **polling** no `code.ts`:

```ts
// apps/figma-plugin/src/code.ts:947
async function pollForPlanChange(base, token, knownTier) {
  const MAX_ATTEMPTS = 60;
  const INTERVAL_MS = 5_000;          // 5 segundos
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    const me = await fetchMe(base, token);
    if (me.planTier !== knownTier) { /* atualiza UI */ return; }
  }
}
```

Chamado após abrir o checkout e o portal (`code.ts:1379` e `code.ts:1393`).

### O caminho de dados actual

1. Utilizador paga no Polar.
2. Polar envia webhook (`subscription.active` / `order.paid`) para `POST /v1/billing/webhooks/polar`.
3. `BillingService.handleWebhook` → `syncCustomerState(userId, force=true)` → consulta a Polar (`getStateExternal`) → `applyCustomerState` actualiza `user.planTier` na BD (`billing.service.ts:253`).
4. O plugin faz polling a `/v1/me` de 5 em 5s; `MeController.me` lê `planTier` da BD (`me.controller.ts:19`).

### Porque demora ~1 minuto

Foram observados ~60s de atraso. Há duas causas que se somam:

1. **Intervalo de polling de 5s** — no pior caso, +5s.
2. **`MeController.me` chama `syncCustomerState` sem `force`, com throttle de 60s** (`SYNC_TTL_MS = 60_000`, `billing.service.ts:44`). Se o webhook do Polar atrasar ou falhar, a única forma de o plano aparecer é o sync throttled de `/v1/me` expirar — o que dá exactamente os ~60s observados.

Ou seja: quando o webhook funciona, o atraso devia ser pequeno; quando o webhook atrasa/falha, caímos no fallback de 60s. O polling de 5s nunca é "instantâneo" e desperdiça pedidos.

### Restrição técnica fundamental: o `fetch` do main thread do Figma é *buffered*

O `code.ts` corre no **main thread (sandbox) do Figma**, não num browser real. O `fetch` aí disponível **não é o fetch nativo do browser** — é um proxy que serializa o pedido via `postMessage` para o host do Figma, espera a resposta **completa**, e devolve-a. Confirmado num stack trace de erro real:

```
fetch @ 2923-….min.js.br:1016
postMessageAndWait @ 2923-….min.js.br:1016   ← espera a resposta inteira
```

**Consequência:** não é possível ler um corpo de resposta incrementalmente (`res.body.getReader()`) a partir do `code.ts`. **Server-Sent Events (SSE) verdadeiro é impossível no main thread**, porque SSE depende exactamente de ler um stream que nunca "fecha".

---

## Problem Statement

**Como atualizar o plano no plugin quase instantaneamente após o checkout, dado que (a) o main thread do Figma não suporta streaming/SSE, (b) o webhook do Polar pode atrasar ou falhar, e (c) a API pode escalar para múltiplas réplicas no Railway?**

---

## Decision Drivers

1. **Latência percebida** — o utilizador acabou de pagar e está a olhar para o plugin; o ideal é < 2s.
2. **Restrição do Figma** — sem streaming no main thread (ver Context). Qualquer solução tem de funcionar com um `fetch` que devolve uma resposta única e completa.
3. **Robustez a webhook atrasado/falhado** — não pode depender exclusivamente do webhook do Polar chegar a tempo.
4. **Multi-réplica** — a API pode correr com N réplicas no Railway; o webhook pode aterrar numa réplica diferente daquela que está à espera.
5. **Sem nova infraestrutura** — Redis já existe (BullMQ + cache de preview, ver ADR-007).
6. **Custo de pedidos** — eliminar o polling de 5s reduz pedidos redundantes a `/v1/me`.

---

## Considered Options

### Opção A: Reduzir o intervalo de polling (5s → 1–2s)

**Como:** baixar `INTERVAL_MS` e desativar/baixar o throttle de `syncCustomerState` em `/v1/me`.

**Prós:** mudança trivial (uma linha).

**Contras:**
- Continua a não ser instantâneo (janela de 1–2s).
- Multiplica os pedidos a `/v1/me` e as chamadas à API do Polar (cada `me` força sync) — pressão e custo.
- Não resolve a causa real (dependência do throttle/webhook).

**Decisão:** rejeitado — trata o sintoma, piora a carga.

### Opção B: SSE verdadeiro a partir do `code.ts` (main thread)

**Como:** abrir `GET /v1/me/events` e ler o stream com `EventSource`/`ReadableStream`.

**Contras:** **impossível.** O `fetch` do main thread é buffered (ver Context); não existe `EventSource` no sandbox. O corpo só é entregue quando a resposta fecha — o oposto de SSE.

**Decisão:** rejeitado — tecnicamente inviável na plataforma.

### Opção C: SSE no iframe da UI (`ui-src/`)

**Como:** o iframe é um contexto de browser real; podia abrir `EventSource`/streaming `fetch` e atualizar o estado React diretamente.

**Prós:** server push verdadeiro.

**Contras:**
- O JWT vive em `figma.clientStorage`, **só acessível pelo main thread**. Para o iframe abrir a ligação autenticada, o token teria de ser passado para o iframe e enviado **na query string** (`EventSource` não suporta headers) — token em URL/logs, pior postura de segurança.
- O iframe corre em `origin: null` (sandbox) e está sujeito ao `networkAccess.allowedDomains` do manifest; mais superfície de configuração e de falha.
- Duplica o caminho de rede: hoje **toda** a rede passa pelo `code.ts`. Introduzir rede no iframe parte a arquitetura de mensagens existente.

**Decisão:** rejeitado para já — ganho marginal sobre a Opção D a um custo de complexidade e segurança maior.

### Opção D: HTTP long-polling a partir do main thread (recomendado)

**Como:** o servidor expõe `GET /v1/me/plan-events?currentTier=X` que **segura a ligação aberta** até o plano mudar (evento) ou até um timeout (~25s), e então devolve uma resposta JSON única. O main thread chama este endpoint num loop. Como a resposta é única e completa, **funciona com o `fetch` buffered do Figma**.

O servidor sabe quando o plano mudou através de um **event emitter em processo**, acordado pelo webhook do Polar. Para o caso multi-réplica, o evento é propagado via **Redis pub/sub**. Para o caso de o webhook nunca chegar, cada ciclo de long-poll faz um **`syncCustomerState(force)` no timeout** como rede de segurança.

**Prós:**
- Quase instantâneo (resolve no momento em que o webhook corre `applyCustomerState`).
- Funciona com a restrição do Figma (resposta única).
- Reusa a infraestrutura de rede e auth existente do `code.ts` (JWT no header, `apiFetch`).
- Robusto: o `force sync` no timeout garante ≤ 25s mesmo se o webhook falhar.
- Reduz pedidos: 1 ligação segurada por ~25s em vez de 12 polls por minuto.

**Contras:**
- Mantém uma ligação HTTP aberta ~25s (dentro de qualquer timeout do Railway/Figma).
- Precisa de um emitter + (para multi-réplica) Redis pub/sub — ~80 linhas no total.

**Decisão:** **adoptado.**

---

## Decision

**Opção D: long-polling com event emitter em processo, propagação cross-réplica via Redis pub/sub, e `syncCustomerState(force)` no timeout como garantia de correção.**

### Porque long-polling e não SSE

Numa app web normal, SSE seria a escolha. Aqui, o main thread do Figma não suporta streaming, e o iframe (Opção C) obrigaria a expor o JWT na query string. O long-polling entrega a **mesma latência percebida** (resolve no instante do webhook) com **uma resposta única** que o `fetch` buffered consegue consumir, sem mexer na fronteira main-thread/iframe nem na postura de segurança do token.

### Garantia de correção (o ponto mais importante)

O Redis pub/sub é a **otimização do fast path** (push cross-réplica). O **`syncCustomerState(force)` executado no timeout de cada ciclo** é a **garantia de correção**: mesmo que o webhook do Polar nunca chegue, ou que o pub/sub falhe, o plano aparece em ≤ 25s. Isto torna toda a feature degradável de forma graciosa.

### Fecho de race condition

Se o utilizador pagar tão depressa que o webhook corre **antes** de o long-poll abrir, o endpoint compara `currentTier` (query) com o `planTier` actual da BD **no início** e devolve imediatamente `changed: true` sem esperar. Sem janela perdida.

---

## Implementation Plan

### Backend

#### 1. `PlanEventsService` (novo) — emitter + Redis pub/sub

Ficheiro: `apps/api/src/plan/plan-events.service.ts`
Módulo: `apps/api/src/plan/plan-events.module.ts` (`@Global()`, à imagem do `RedisCacheModule` do ADR-007).

```ts
@Injectable()
export class PlanEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly waiters = new Map<string, Set<() => void>>();
  private subscriber: Redis | null = null;
  private static readonly CHANNEL = 'plan-updates';

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CACHE_CLIENT) private readonly publisher: Redis, // PUBLISH não bloqueia
  ) {}

  async onModuleInit(): Promise<void> {
    // Conexão dedicada: em modo subscribe o ioredis não aceita outros comandos.
    this.subscriber = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    try {
      await this.subscriber.subscribe(PlanEventsService.CHANNEL);
      this.subscriber.on('message', (_ch, msg) => {
        try { this.notifyLocal(JSON.parse(msg).userId); } catch { /* ignore */ }
      });
    } catch (e) {
      // pub/sub indisponível → fast path cross-réplica desligado; fallback de 25s cobre.
      this.subscriber = null;
    }
  }

  async onModuleDestroy(): Promise<void> { await this.subscriber?.quit(); }

  /** Resolve true se notificado dentro do timeout, false se expirou. */
  waitForChange(userId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (changed: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.removeWaiter(userId, waiter);
        resolve(changed);
      };
      const waiter = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.addWaiter(userId, waiter);
    });
  }

  /** Chamado pelo BillingService quando um plano muda. */
  async publishChange(userId: string): Promise<void> {
    this.notifyLocal(userId); // mesma réplica: imediato
    try {
      await this.publisher.publish(
        PlanEventsService.CHANNEL,
        JSON.stringify({ userId }),
      );
    } catch { /* fallback de 25s cobre */ }
  }

  private notifyLocal(userId: string): void {
    const set = this.waiters.get(userId);
    if (!set) return;
    for (const w of [...set]) w();
  }
  // addWaiter / removeWaiter: gerem o Map<string, Set<fn>>
}
```

#### 2. `BillingService.applyCustomerState` — publicar evento

Injetar `PlanEventsService` (sem ciclo: `PlanEventsService` não depende de `BillingService`). No fim de `applyCustomerState` (`billing.service.ts:253`), após o `prisma.user.update`:

```ts
await this.planEvents.publishChange(userId);
```

#### 3. Endpoint long-poll em `MeController`

`apps/api/src/users/me.controller.ts` — injetar `PlanEventsService`:

```ts
@Get('me/plan-events')               // → /v1/me/plan-events
@UseGuards(AuthGuard('jwt'))
async planEvents(
  @Req() req: AuthedRequest,
  @Query('currentTier') currentTier?: string,
) {
  const userId = req.user.userId;
  const HOLD_MS = 25_000;

  // Fecho de race: já mudou antes de abrirmos?
  let me = await this.plan.buildMeResponse(userId);
  if (currentTier && me.planTier !== currentTier) return { changed: true, ...me };

  const notified = await this.planEvents.waitForChange(userId, HOLD_MS);
  if (notified) {
    me = await this.plan.buildMeResponse(userId);
    return { changed: !currentTier || me.planTier !== currentTier, ...me };
  }

  // Timeout: rede de segurança caso o webhook não tenha chegado.
  await this.billing.syncCustomerState(userId, true);
  me = await this.plan.buildMeResponse(userId);
  return { changed: !!currentTier && me.planTier !== currentTier, ...me };
}
```

A resposta passa pelo `TransformInterceptor` → `{ data: { changed, planTier, quotas, ... } }`. Sem problemas de content-type (é JSON normal, não SSE).

#### 4. Wiring

- `PlanEventsModule` (`@Global`) registado no `AppModule`.
- `BillingModule` ganha `PlanEventsService` nos imports (via módulo global, sem alterar imports explícitos).

### Plugin

#### 5. Substituir `pollForPlanChange` por `longPollForPlanChange`

`apps/figma-plugin/src/code.ts:947`. Mesma assinatura, dois call sites inalterados (`:1379`, `:1393`).

```ts
async function longPollForPlanChange(base: string, token: string, knownTier: string): Promise<void> {
  const DEADLINE = Date.now() + 5 * 60_000; // desiste após 5 min totais
  while (Date.now() < DEADLINE) {
    try {
      const res = await apiFetch(
        `${base}/v1/me/plan-events?currentTier=${encodeURIComponent(knownTier)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = body.data as Record<string, unknown> | undefined;
      if (res.ok && data?.changed === true) {
        const me = parseSessionPayload(data);           // reusar parser de fetchMe
        figma.ui.postMessage({ type: 'session-data', ...me });
        figma.notify(`✅ Plan updated to ${me.planTier}!`);
        return;
      }
      // changed:false → o servidor já segurou ~25s; volta ao loop imediatamente
    } catch {
      await new Promise((r) => setTimeout(r, 3_000)); // backoff só em erro de rede
    }
  }
}
```

Nota: extrair o parsing do `me` que hoje está dentro de `fetchMe` para uma função `parseSessionPayload(data)` reutilizável por ambos.

### Fora de scope (mantém-se como está)

- O polling proativo de refresh de JWT no `bootstrapSession` (não relacionado).
- O `syncCustomerState` throttled em `GET /v1/me` (continua útil como sync passivo ao abrir o plugin).

---

## Consequences

### Positivo
- Atualização do plano quase instantânea (resolve no instante em que o webhook corre `applyCustomerState`).
- Funciona dentro da restrição do Figma (resposta única, sem streaming).
- Degradação graciosa: webhook falhado ou pub/sub em baixo → ainda ≤ 25s via `force sync` no timeout.
- Menos pedidos: 1 ligação segurada/25s vs. 12 polls/min.
- Reusa Redis existente; sem nova infraestrutura (alinhado com ADR-007).

### Negativo
- Uma ligação HTTP segurada ~25s por ciclo. Ocupa um worker da API durante a espera (event-driven, custo de CPU ~0; é I/O à espera). Aceitável para o volume actual.
- Segunda conexão Redis (subscriber dedicado) — custo negligenciável (ADR-007 já estabeleceu o padrão).
- `MeController` ganha dependência de `PlanEventsService` e `BillingService` (já tinha ambos os serviços de plano/billing).

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Webhook do Polar nunca chega | Média | `syncCustomerState(force)` no timeout de cada ciclo → ≤ 25s |
| Redis pub/sub em baixo (cross-réplica) | Baixa | `notifyLocal` cobre a mesma réplica; `force sync` cobre o resto |
| Timeout de proxy do Railway < 25s | Baixa | 25s é conservador; validar e baixar `HOLD_MS` se necessário (open question) |
| `fetch` do Figma aborta ligação longa | Baixa | Sem `AbortSignal` no `apiFetch`; 25s < qualquer timeout observado; `HOLD_MS` configurável |
| Muitas ligações seguradas (escala) | Baixa hoje | Event-driven, não thread-per-request bloqueante; reavaliar se concorrência crescer |

---

## Open Questions antes da implementação

1. **Timeout de pedido do proxy Railway.** Confirmar que segurar 25s não é cortado pelo edge do Railway. Se for, baixar `HOLD_MS` para ~20s (o loop do cliente reabre na mesma).
2. **Quantas réplicas da API correm hoje?** Se for 1, o `notifyLocal` já dá fast path instantâneo e o Redis pub/sub é só preparação para scale-out — mas incluí-lo agora é barato e correto.
3. **`POLAR_SUCCESS_URL`** redireciona o utilizador para fora do browser; confirmar que o long-poll do plugin continua a correr em paralelo (corre — é independente do browser do checkout).

---

## References

- `apps/figma-plugin/src/code.ts:947` — `pollForPlanChange` (a substituir por `longPollForPlanChange`)
- `apps/figma-plugin/src/code.ts:1379,1393` — call sites (billing-checkout / billing-portal)
- `apps/figma-plugin/src/plugin-fetch.ts` — `apiFetch` (fetch buffered do main thread)
- `apps/api/src/billing/billing.service.ts:253` — `applyCustomerState` (onde publicar o evento)
- `apps/api/src/billing/billing.service.ts:44` — `SYNC_TTL_MS = 60_000` (causa do fallback de 60s)
- `apps/api/src/users/me.controller.ts` — onde adicionar `GET /me/plan-events`
- `apps/api/src/plan/plan.service.ts:131` — `buildMeResponse` (shape da resposta)
- `apps/api/src/cache/redis-cache.module.ts` — modelo para a conexão Redis dedicada
- ADR-007 — Redis cache; estabelece o padrão de conexão Redis dedicada via DI
- `docs/AUTH.md` — sessão/JWT do plugin (contexto de onde vive o token)
```
