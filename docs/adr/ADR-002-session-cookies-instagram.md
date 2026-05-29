# ADR-002: Gestão de sessões do Instagram

**Status:** Revised — decisão anterior (Opção A) rejeitada; ver secção Decision  
**Date:** 2026-05-29  
**Revised:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, autenticação, cookies, sessão, lifecycle

---

## Context

O scraper actual faz pedidos a `i.instagram.com/api/v1/` sem qualquer cookie ou token de sessão. O Instagram distingue pedidos autenticados de anónimos e aplica thresholds muito mais baixos a pedidos sem sessão — especialmente de IPs de datacenter.

Com cookies de sessão válidos, uma conta Instagram normal aguenta centenas de pedidos de leitura por hora sem 429. A questão não é *se* usar cookies, mas *como gerir o ciclo de vida das sessões* de forma que o serviço não pare quando uma sessão expira ou uma conta é suspensa.

### Por que a gestão de sessões é crítica

O Instagram pode invalidar uma sessão por vários motivos, nem todos controláveis:
- Expiração natural (90 dias sem uso, ou token rotacionado pelo Instagram)
- A conta foi reportada por um utilizador do Instagram
- O padrão de pedidos do servidor foi detectado como bot
- A Meta actualizou o sistema de detecção (acontece sem aviso)
- A password da conta foi alterada (o Instagram força isto ocasionalmente em contas suspeitas)

Sem um plano para estes cenários, **qualquer decisão de sessão que tenha um único ponto de falha vai eventualmente parar o serviço em produção.**

---

## Problem Statement

**Como gerir sessões do Instagram de forma que:**
1. O serviço não pare se uma sessão expirar ou uma conta for suspensa
2. A renovação de sessões não requeira intervenção humana frequente
3. O sistema detecte proactivamente sessões inválidas antes de afectar utilizadores

---

## Decision Drivers

1. **Resiliência a ban** — se uma conta for banida, o serviço deve continuar com outra sessão, não parar.
2. **Frequência de manutenção** — a equipa não deve ter de copiar cookies manualmente mais do que uma vez por mês em condições normais.
3. **Detecção proactiva** — o sistema deve alertar quando uma sessão falha, antes que os utilizadores reportem.
4. **Sem introduzir riscos adicionais de ban** — renovação automática que faz login programático pode acelerar o ban da conta se mal implementada.
5. **Complexidade proporcional ao volume actual** — não construir infra de gestão de sessões para 100k utilizadores quando há 100.

---

## Considered Options

### Opção A: Cookie único como env var (REJEITADA)

**Como funciona:** copiar o header `Cookie` do browser para `IG_SESSION_COOKIE`. Um único cookie para todo o serviço.

**Por que foi rejeitada:**
- Um único ponto de falha. Se a conta for banida ou o cookie expirar, **100% do scraping pára**.
- "Copiar cookies do browser" não é um processo de manutenção — é um processo de emergência. Quando é necessário, significa que o produto já está quebrado para todos os utilizadores.
- Não escala: à medida que o volume cresce, uma conta fica sob mais pressão e o ciclo de vida encurta.

---

### Opção B: Pool de sessões em base de dados PostgreSQL

**Como funciona:** tabela `instagram_sessions` com colunas `cookie_string`, `account_username`, `is_active`, `last_used_at`, `fail_count`, `banned_at`. O scraper escolhe a sessão menos usada recentemente. Quando falha repetidamente, marca como inactiva e alerta.

**Prós:**
- Estado persistente — sobrevive a reinicios.
- Rotação inteligente por frequência de uso.
- Histórico de falhas por sessão.

**Contras:**
- Requer migrations de DB, UI de gestão, lógica de rotação.
- Query de DB em cada pedido de preview (mitigável com cache em memória do pool de sessões activas).
- Overkill para 2–5 contas.

**Quando faz sentido:** >10 contas, equipa com tempo para construir painel de gestão.

---

### Opção C: Pool de sessões como env var JSON (ESCOLHIDA para fase actual)

**Como funciona:** a env var `IG_SESSION_POOL` contém um array JSON de objectos de sessão:

```json
[
  { "account": "insta2figma_bot_1", "cookie": "sessionid=ABC; csrftoken=X; ds_user_id=111; mid=M1; ig_did=D1" },
  { "account": "insta2figma_bot_2", "cookie": "sessionid=DEF; csrftoken=Y; ds_user_id=222; mid=M2; ig_did=D2" }
]
```

O scraper em memória:
1. Carrega o pool no arranque.
2. Rotaciona por round-robin.
3. Quando uma sessão recebe 401 ou `require_login`, marca-a como suspeita **em memória** e usa as restantes.
4. Se todas as sessões ficarem suspeitas, loga um erro crítico e continua sem cookie (degradação graciosa).

**Prós:**
- Sem DB para gerir sessões.
- Se uma conta for banida, as outras continuam a funcionar — sem downtime.
- Actualizar o pool = actualizar a env var + redeploy (< 30 segundos).
- O campo `account` no JSON permite perceber qual conta falhou nos logs.

**Contras:**
- Estado "sessão suspeita" perdido em cada reinicio — uma sessão banida será tentada de novo até falhar outra vez.
- A env var fica mais longa (mas num gestor de secrets isso não é problema).
- Ainda requer intervenção humana para renovar cookies expirados.

**Mitigação do contra principal:** o comportamento de tentar uma sessão banida após reinicio é inócuo — vai falhar rapidamente e ser marcada suspeita novamente.

---

### Opção D: Login programático com username+password

**Como funciona:** guardar `IG_BOT_USERNAME` e `IG_BOT_PASSWORD` como env vars. Quando a sessão expira, o scraper faz login automaticamente via `POST https://www.instagram.com/accounts/login/ajax/` para obter novos cookies.

**Prós:**
- Zero intervenção humana para renovar sessões.
- Completamente automático.

**Contras críticos:**
- O fluxo de login do Instagram tem detecção de bot muito agressiva: IP de datacenter + login programático = alta probabilidade de checkpoint (confirmação por email/SMS, CAPTCHA).
- Um login que falha com checkpoint **bloqueia a conta até resolução manual** — pior que renovar cookies manualmente.
- Mesmo com proxy, o Instagram detecta logins automatizados por fingerprinting do browser (não apenas IP).
- Se a password for alterada pelo Instagram (mecanismo de segurança para contas suspeitas), o serviço fica num loop de logins falhados.
- Guardar password em env var é um risco de segurança maior que guardar cookies (a password permite acesso total à conta; o cookie expira).

**Decisão:** **rejeitado** para produção. O risco de checkpoint supera o benefício da automação.

**Nota:** existe a biblioteca Python `instagrapi` que lida com checkpoints semi-automaticamente. Poderia ser avaliada se o volume justificar (ver crawler/ no repo), mas introduziria um segundo runtime Python e infra adicional.

---

### Opção E: Instagrapi (Python) com gestão de sessão completa

**Como funciona:** usar a biblioteca `instagrapi` no `crawler/` existente como serviço separado que gere autenticação, checkpoints, e exporta cookies para o scraper TypeScript consumir.

**Prós:**
- `instagrapi` tem anos de desenvolvimento especificamente para contornar as protecções do Instagram.
- Suporta checkpoint handling (email/SMS verification).
- Exporta sessão como JSON reutilizável.

**Contras:**
- Segundo runtime (Python) — contradiz `ARQUITETURA-INSTA2FIGMA.md` §5.4 que reserva Python apenas com justificação documentada.
- Mais infra para deployar e monitorizar.
- `instagrapi` usa endpoints privados que podem mudar sem aviso.

**Quando reconsiderar:** se o volume justificar >10 contas e a gestão manual se provar insustentável.

---

## Decision

**Opção C: Pool de sessões como env var JSON, com mínimo de 2 contas.**

Nunca usar uma única sessão em produção. O mínimo operacional é 2 contas — se uma for suspensa, a outra mantém o serviço a funcionar enquanto a terceira está a ser configurada.

### Quantas contas manter

| Volume de previews/dia | Contas recomendadas |
|----------------------|---------------------|
| < 500 | 2 |
| 500–2000 | 3 |
| 2000–10000 | 5 |
| > 10000 | Reconsiderar Opção B ou Apify (ADR-001) |

### Como criar as contas de serviço

1. Criar contas Instagram com emails dedicados (ex. `insta2figma.bot1@gmail.com`).
2. Usar um browser normal (não o browser de desenvolvimento) para fazer login e deixar a conta "envelhecer" — uma conta com 2+ semanas de histórico é muito menos suspeita que uma conta nova.
3. Não usar a conta para nada além de estar logada. Não seguir perfis, não fazer posts.
4. Copiar cookies do browser DevTools após login.

### Renovação de cookies

Cookies com uso activo (o Instagram renova internamente em cada pedido bem-sucedido) duram **meses**. A renovação manual é necessária apenas quando:
- A sessão é explicitamente invalidada (a conta foi suspensa ou a password foi alterada).
- A conta não fez pedidos por >90 dias (sessão expirou por inactividade).

**Expectativa realista:** com 2 contas e proxy, a intervenção humana deve ser necessária menos de uma vez por trimestre em condições normais.

### Detecção proactiva de sessão inválida

O health check `GET /v1/health` deve incluir uma verificação de sessão:
- Fazer um pedido leve ao Instagram (ex. verificar o perfil de uma conta de teste conhecida).
- Se a sessão falhar, incluir `{ "instagram_session": "degraded" }` na resposta de health.
- Isto permite que alertas de monitorização (Uptime Robot, Railway health check) detectem antes dos utilizadores.

---

## Implementation

### Env var

```
IG_SESSION_POOL='[{"account":"bot1","cookie":"sessionid=ABC; csrftoken=X; ds_user_id=111; mid=M1; ig_did=D1"},{"account":"bot2","cookie":"sessionid=DEF; csrftoken=Y; ds_user_id=222; mid=M2; ig_did=D2"}]'
```

### Fallback retrocompatível

Para não quebrar instalações existentes com `IG_SESSION_COOKIE` (string única), o helper suporta ambos:

```typescript
export interface SessionEntry {
  account: string;
  cookie: string;
}

export function loadSessionPool(): SessionEntry[] {
  const poolRaw = process.env.IG_SESSION_POOL?.trim();
  if (poolRaw) {
    try {
      const parsed = JSON.parse(poolRaw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as SessionEntry[];
    } catch {
      console.error('[instagram-scraper] IG_SESSION_POOL inválido — ignorado');
    }
  }
  // Fallback para variável legada de sessão única
  const single = process.env.IG_SESSION_COOKIE?.trim();
  if (single) return [{ account: 'default', cookie: single }];

  console.warn('[instagram-scraper] Nenhuma sessão configurada — operando sem autenticação (rate limits baixos)');
  return [];
}
```

### Rotação round-robin com blacklist em memória

```typescript
export class SessionPool {
  private sessions: SessionEntry[];
  private blacklisted = new Set<string>();
  private index = 0;

  constructor(sessions: SessionEntry[]) {
    this.sessions = sessions;
  }

  next(): SessionEntry | null {
    const active = this.sessions.filter(s => !this.blacklisted.has(s.account));
    if (active.length === 0) {
      console.error('[instagram-scraper] TODAS as sessões estão inválidas — scraping sem autenticação');
      return null;
    }
    const session = active[this.index % active.length];
    this.index++;
    return session;
  }

  markInvalid(account: string): void {
    console.error(`[instagram-scraper] Sessão inválida: conta "${account}" — verificar/renovar IG_SESSION_POOL`);
    this.blacklisted.add(account);
  }
}
```

---

## Consequences

### Positivo
- O serviço continua a funcionar mesmo com uma conta banida (desde que haja ≥1 sessão válida).
- Renovação rara em condições normais (<1x por trimestre).
- Detecção de falha de sessão com log explícito — não falha silenciosamente.

### Negativo
- Requer criar e manter ≥2 contas Instagram.
- Estado de blacklist perdido em reinicio (inócuo — recalcula rapidamente).
- Renovação ainda é manual quando necessária.

### Plano para conta banida

1. O log mostra `Sessão inválida: conta "bot1"`.
2. A conta "bot2" continua a servir pedidos sem interrupção.
3. Criar nova conta de serviço, fazer login no browser, copiar cookies.
4. Actualizar `IG_SESSION_POOL` com a nova entrada e redeploy.
5. Tempo de recuperação: ~10–15 minutos, zero downtime para utilizadores.

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts` — onde integrar `SessionPool`
- `apps/api/.env.example` — adicionar `IG_SESSION_POOL=` e remover `IG_SESSION_COOKIE=`
- `crawler/` — protótipo Python com instagrapi como alternativa futura
- ADR-001 — decisão de manter scraper próprio
- ADR-003 — proxy residencial (complementar)
- ADR-004 — retry/backoff
- ADR-005 — cache TTL (reduz número de pedidos ao Instagram, reduz pressão nas sessões)
