# Custos — estimativa por utilizador e por request

> Actualizado: 2026-06-11. Valores de quota/preço retirados do código
> (`plan.config.ts`, `plan.service.ts`, `ProUpgradeOverlay.tsx`). Recalcular quando
> mudarem env vars de quota, preços Polar ou tarifas Apify.

## 1. Inputs

### Custos fixos mensais

| Item | Custo/mês | Nota |
|------|-----------|------|
| Cloud (Railway: API + worker + Postgres + Redis) | $5.00 | plano actual |
| Telemóvel p/ verificação de contas IG | $10.00 | amortizado pelas contas do session pool |
| Proxies | $0.00 | **grátis por agora** — rever quando passarem a pagos |
| **Total fixo** | **$15.00/mês** | |

### Custos variáveis (Apify — só fallback)

| Actor | Tarifa | Custo unitário |
|-------|--------|----------------|
| Instagram Profile Scraper (`APIFY_IG_PROFILE_ACTOR`) | $2.60 / 1.000 perfis | **$0.0026 / perfil** |
| Instagram Post Scraper (`APIFY_IG_POST_ACTOR`) | $1.70 / 1.000 posts | **$0.0017 / post** |

O caminho primário é o **scraper próprio** (session pool + proxies grátis) → custo
marginal ≈ $0. O Apify só entra quando as sessões falham. A variável crítica de toda
a estimativa é a **taxa de fallback** (% de requests servidos via Apify) — medível
hoje via `ScrapeTelemetry` / `GET /admin/scrape-health`.

### Receita por plano (Polar)

| Plano | Mensal | Anual (equiv./mês) | Quota imagens/mês (default env) |
|-------|--------|--------------------|---------------------------------|
| Free | $0 | $0 | 100 (`QUOTA_FREE_IMAGES_PER_MONTH`) |
| Pro | $5 | $3 | 10.000 (`QUOTA_PRO_IMAGES_PER_MONTH`) |
| Max | $50 | $30 | 100.000 (`QUOTA_MAX_IMAGES_PER_MONTH`) |

## 2. Custo por request (caminho Apify, worst case)

Página de preview = 12 posts. Free vê ≤3 páginas, Pro ≤12, Max sem limite.

| Request | Cálculo | Custo |
|---------|---------|-------|
| Preview inicial (página 1) | 1 perfil × $0.0026 | **$0.0026** |
| Preview página 2+ (scroll) | 12 posts × $0.0017 | **$0.0204/página** |
| Browse completo free (3 páginas) | $0.0026 + 2×$0.0204 | **$0.043** |
| Browse completo pro (12 páginas) | $0.0026 + 11×$0.0204 | **$0.227** |
| Import de N posts | N × $0.0017 | $0.0017/post |
| Import pequeno (8 posts) | 8 × $0.0017 | **$0.014** |
| Import máximo (50 posts) | 50 × $0.0017 | **$0.085** |

> O Apify factura por **post devolvido**, não por imagem — carrosséis expandidos não
> multiplicam o custo do scrape (multiplicam storage/bandwidth, coberto no fixo).
> O cache Redis de preview (ADR-007) reduz repetições do mesmo perfil.

No **caminho próprio** todos estes valores são ≈ $0 (custo marginal de rede/compute já
dentro dos $5 de cloud).

## 3. Custo mensal por utilizador (cenários)

Persona assumida: ~10 browses de preview/mês + quota de import consumida a X%.

### Worst case — 100% Apify (pool de sessões morto)

| Utilizador | Previews | Imports | Total/mês | Receita | Margem |
|------------|----------|---------|-----------|---------|--------|
| Free (quota cheia: 100 posts) | 10×$0.043 = $0.43 | $0.17 | **$0.60** | $0 | −$0.60 |
| Pro (quota cheia: 10.000 posts) | 10×$0.227 = $2.27 | $17.00 | **$19.27** | $5 (ou $3) | **−$14 a −$16** ⚠️ |
| Pro (uso típico: 10% da quota) | $2.27 | $1.70 | **$3.97** | $5 | +$1 / −$1 anual ⚠️ |
| Max (quota cheia: 100.000 posts) | $2.27 | $170.00 | **$172** | $50 (ou $30) | **−$122 a −$142** ⚠️ |
| Max (uso típico: 10% da quota) | $2.27 | $17.00 | **$19.27** | $50 | +$31 |

### Cenário realista — 20% de fallback Apify

| Utilizador | Custo variável/mês | Receita | Margem |
|------------|--------------------|---------|--------|
| Free (quota cheia) | $0.12 | $0 | −$0.12 |
| Pro (quota cheia) | $3.85 | $5 / $3 | +$1.15 / **−$0.85 anual** ⚠️ |
| Pro (uso típico 10%) | $0.79 | $5 / $3 | +$4.21 / +$2.21 |
| Max (quota cheia) | $34.45 | $50 / $30 | +$15.55 / **−$4.45 anual** ⚠️ |
| Max (uso típico 10%) | $3.85 | $50 / $30 | +$46 / +$26 |

### Caminho próprio saudável — ~0% fallback

Custo variável ≈ $0 para qualquer tier; só pesam os $15 fixos.

## 4. Break-even

Com custo variável ≈ 0 (pool saudável), os $15 fixos cobrem-se com:

- **3 subscritores Pro mensais** ($5), ou
- **5 subscritores Pro anuais** ($3/mês equivalente), ou
- **1 subscritor Max** (qualquer ciclo)

Cada conta IG nova para o pool custa só a fracção do telemóvel ($10/mês cobre o lote
de verificações do mês) — escalar o pool não escala custo de forma relevante.

## 5. Riscos e alavancas

1. **Pro/Max anual com quota cheia via Apify dá prejuízo.** O desconto de 40% do
   anual assume custo variável ≈ 0. Alavanca: manter fallback < ~15% (Pro) — é o
   limiar onde o Pro anual com quota cheia fica negativo.
2. **A taxa de fallback é a métrica de negócio nº 1.** Já existe telemetria
   (`/admin/scrape-health`); definir alerta quando Apify > 15% dos scrapes.
3. **Quotas são env vars** — se o fallback subir de forma sustentada, baixar
   `QUOTA_PRO_IMAGES_PER_MONTH`/`QUOTA_MAX_IMAGES_PER_MONTH` é o travão imediato
   sem deploy de código.
4. **Proxies grátis é temporário.** Quando passarem a pagos (~$1–3/GB residencial),
   somar ao fixo e recalcular — afecta o caminho próprio, que hoje é "grátis".
5. **Utilizadores free custam ≈ $0.12–0.60/mês** no pior caso — aceitável como CAC,
   mas vale cap de previews por dia se houver abuso (já existe rate limit + cache).

## 6. Fórmula rápida

```
custo_var_user = fallback_rate × [ previews × ($0.0026 + (páginas−1) × $0.0204)
                                   + posts_importados × $0.0017 ]
custo_total_mês = $15 + Σ custo_var_user
margem = receita_subscrições − custo_total_mês
```
