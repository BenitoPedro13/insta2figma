# Billing local — Polar.sh + ngrok

Guia para novos devs testarem **checkout Pro**, **portal** e **webhooks** com a API em `localhost`.

## Pré-requisitos

1. Conta no **[Polar sandbox](https://sandbox.polar.sh)** (ambiente separado de produção).
2. API a correr: `pnpm dev` ou `pnpm dev:api` (porta **3333** por omissão).
3. Variáveis em [`apps/api/.env`](../apps/api/.env) — ver [`.env.example`](../apps/api/.env.example).

## 1. Produto e token no Polar (sandbox)

1. Em [sandbox.polar.sh](https://sandbox.polar.sh), cria um produto **Pro** (subscrição recorrente).
2. Copia o **Product ID** (UUID) → `POLAR_PRODUCT_ID_PRO` no `.env`.
3. **Settings → Organization access tokens** → cria um OAT com scopes mínimos:
   - `customers:read`, `customers:write`
   - `checkouts:read`, `checkouts:write`
   - `customer_sessions:write`
   - `customer_portal:read`, `customer_portal:write`
4. Cola o token em `POLAR_ACCESS_TOKEN`.

```env
POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_SERVER=sandbox
POLAR_PRODUCT_ID_PRO=<uuid-do-produto-pro-no-sandbox>
POLAR_SYNTHETIC_EMAIL_DOMAIN=mailinator.com
POLAR_SUCCESS_URL=https://example.com/billing/success
POLAR_RETURN_URL=
```

> O token e o produto têm de ser do **sandbox**. Tokens de produção não funcionam com `POLAR_SERVER=sandbox`.

Reinicia a API após editar o `.env`.

## 2. Webhooks com ngrok

O Polar envia webhooks **dos servidores deles** — `http://127.0.0.1` não é acessível de fora.

### Arrancar o túnel

Com a API na porta 3333:

```bash
ngrok http 3333
```

Copia a URL HTTPS (ex.: `https://abc123.ngrok-free.app`).

### Configurar no Polar

**Settings → Webhooks** → novo endpoint:

```text
https://<teu-subdominio>.ngrok-free.app/v1/billing/webhooks/polar
```

(use **`/v1` em minúsculas**)

Eventos recomendados:

- `customer.state_changed`
- `subscription.active`
- `subscription.revoked`
- `subscription.canceled`

Copia o **signing secret** → `POLAR_WEBHOOK_SECRET` no `.env` e reinicia a API.

A rota só é registada se `POLAR_WEBHOOK_SECRET` estiver definido (ver [`apps/api/src/main.ts`](../apps/api/src/main.ts)).

### Ver entregas

- UI do ngrok: [http://127.0.0.1:4040](http://127.0.0.1:4040)
- Esperado: `POST /v1/billing/webhooks/polar` com status **200**

Documentação Polar: [Webhooks locally](https://polar.sh/docs/integrate/webhooks/locally)

## 3. Testar pagamento

1. `pnpm bootstrap` (uma vez) e `pnpm dev` (API + worker).
2. Build do plugin: `pnpm build` → importar `apps/figma-plugin/dist/manifest.json` no Figma.
3. Inicia sessão no **Figma** (o plugin usa `figma.currentUser`).
4. No plugin: **Upgrade to Pro** → checkout no browser.
5. Cartão de teste (Stripe via Polar sandbox):

| Campo | Valor |
|--------|--------|
| Número | `4242 4242 4242 4242` |
| Validade | Qualquer data futura |
| CVC | 3 dígitos |

6. Após pagamento: reabre o plugin → banner deve mostrar **Pro** (webhook + `GET /v1/me`).

### Testar só pela API

```bash
BASE=http://localhost:3333

TOKEN=$(curl -s -X POST "$BASE/v1/auth/figma" \
  -H 'content-type: application/json' \
  -d '{"figmaUserId":"dev-local-001"}' | jq -r '.data.accessToken')

curl -s "$BASE/v1/me" -H "authorization: Bearer $TOKEN" | jq

curl -s -X POST "$BASE/v1/billing/checkout-session" \
  -H "authorization: Bearer $TOKEN" | jq
```

Abre o `data.url` no browser.

## 4. Troubleshooting

| Sintoma | Solução |
|---------|---------|
| `500` / email inválido | Email sintético com domínio sem DNS; usa `POLAR_SYNTHETIC_EMAIL_DOMAIN=mailinator.com` e reabre o plugin (novo auth). |
| `400` checkout | Ver mensagem em `error.message`; confirma `POLAR_PRODUCT_ID_PRO` do **sandbox**. |
| Plano não muda após pagar | Webhook não chegou — confirma ngrok + secret + URL `/v1/billing/...`. |
| `syncCustomerState ResourceNotFound` nos logs | Normal **antes** do primeiro checkout; ignorável. |
| `Billing Polar não configurado` | `POLAR_ACCESS_TOKEN` vazio ou API não reiniciada. |

## Referências

- [Polar — Authentication](https://polar.sh/docs/integrate/authentication)
- [Polar — Express adapter](https://polar.sh/docs/integrate/sdk/adapters/express)
- [Polar — Sandbox](https://polar.sh/docs/integrate/sandbox)
