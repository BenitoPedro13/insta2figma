# ADR-001: Scraper próprio vs. serviço externo de scraping

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, arquitetura, build-vs-buy

---

## Context

O insta2figma precisa de aceder a dados de perfis públicos do Instagram (foto de perfil, contagem de posts, feed com thumbnails) em tempo real para mostrar um preview ao utilizador antes de importar. Isso requer fazer pedidos HTTP aos endpoints internos do Instagram — que não são uma API pública oficial com chaves de acesso estáveis.

O scraper actual (`apps/api/src/instagram/instagram-preview.service.ts`) faz pedidos diretamente a partir do servidor Railway sem cookies, sem proxy e sem retry. O resultado é que o servidor recebe 429 com frequência, porque:

1. O Instagram trata IPs de datacenter com suspeita por default.
2. Sem cookies de sessão, os pedidos são tratados como tráfego anónimo/bot.
3. Qualquer burst de pedidos (múltiplos utilizadores simultâneos, ou um utilizador a paginar depressa) queima o threshold muito rapidamente.

Existe também um protótipo Python em `crawler/` (httpx + jmespath) que foi explorado mas nunca integrado na stack de produção.

---

## Problem Statement

**Queremos que o preview de perfis funcione de forma fiável para todos os utilizadores, sem erros 503/429 frequentes.**

A questão de fundo é: devemos melhorar o scraper próprio, ou usar um serviço externo que já resolve o problema de IP e autenticação?

---

## Decision Drivers

1. **Fiabilidade** — o preview deve funcionar em >95% dos pedidos em condições normais.
2. **Latência** — o preview é síncrono (o utilizador espera no plugin), por isso <4s é aceitável, >8s não é.
3. **Custo** — o produto tem plano free e utilizadores pequenos; o custo de infrastructure deve ser proporcional à receita.
4. **Controlo** — ter controlo sobre os headers, cookies e lógica de retry é importante para adaptar rapidamente quando o Instagram muda algo.
5. **Complexidade operacional** — quantos sistemas externos adicionamos e quantas coisas podem falhar.
6. **Alinhamento com a stack existente** — a arquitectura define TypeScript/NestJS como linguagem principal; adicionar Python requer justificação.

---

## Considered Options

### Opção A: Serviço externo de scraping (ex. Apify, Bright Data Scraping Browser, ScraperAPI)

**Como funciona:** em vez de chamar o Instagram diretamente, chamamos uma API do serviço que faz o pedido por nós, usando a sua rede de proxies residenciais e sessões geridas.

**Prós:**
- Zero trabalho de manutenção de sessões ou proxies.
- Rede de IPs residenciais gerida profissionalmente — muito difícil de bloquear.
- Apify tem actores específicos para Instagram com parsing incluído.
- Latência geralmente boa (500ms–2s para dados de perfil).

**Contras:**
- Custo por pedido: Apify cobra ~$0.001–0.005 por chamada; para 10.000 previews/mês = $10–50/mês; para 100.000 = $100–500/mês. Escala mal se o produto crescer rápido.
- Dependência de um terceiro: se o Apify ou ScraperAPI tiver downtime, o produto também para. Dois pontos de falha em vez de um.
- O formato de resposta é o do serviço, não o do Instagram — qualquer mudança no actor pode quebrar o parsing.
- Latência adicional de rede (roundtrip extra ao serviço externo).
- Vendor lock-in: mudar de serviço obriga a reescrever a integração.
- Privacidade: os dados do perfil (username, etc.) passam por um terceiro.

**Quando faz sentido:** produto em fase inicial que precisa de funcionar sem investir em infra, ou volume muito alto onde o custo de manter proxies próprios supera o custo do serviço.

---

### Opção B: Scraper próprio com cookies de sessão + proxy residencial

**Como funciona:** manter o scraper TypeScript existente mas injetar um `Cookie` header com uma sessão válida do Instagram, e encaminhar os pedidos por um proxy residencial (ex. Webshare, Oxylabs, Bright Data).

**Prós:**
- Controlo total sobre headers, endpoints e parsing.
- Custo previsível e baixo: proxies residenciais custam ~$3–15/GB; previews de perfil são pedidos pequeños (<50KB), portanto 100.000 previews ≈ 5GB = ~$15–75/mês no pior caso.
- Sem vendor lock-in no scraping em si: só o proxy é externo.
- Sessões com cookies têm thresholds muito mais altos que pedidos anónimos.
- Alinhado com a stack TypeScript/NestJS existente.
- O scraper já usa os endpoints certos e tem a lógica de parsing correta.

**Contras:**
- Sessões do Instagram expiram (semanas a meses, dependendo do uso) e precisam de ser renovadas manualmente ou automatizadas.
- Se a sessão for bloqueada (ban da conta associada), o serviço pára até nova sessão.
- Gerir um pool de múltiplas sessões para redundância adiciona complexidade.
- Requer configuração de proxy (env vars, testar conectividade).

**Quando faz sentido:** produto com utilizadores reais onde o custo importa e a equipa tem capacidade para manter sessões ocasionalmente.

---

### Opção C: Playwright/Puppeteer headless (browser real)

**Como funciona:** em vez de fetch HTTP direto, usar um browser headless que visita o Instagram como um utilizador real.

**Prós:**
- Fingerprint quase indistinguível de um browser real.
- Suporta fluxos que requerem JavaScript (ex. lazy-loading).

**Contras:**
- Custo de memória/CPU muito alto (cada instância de browser ocupa 200–500MB RAM).
- Latência muito mais alta (3–10s por pedido — inaceitável para preview síncrono).
- Complexidade operacional elevada (gerir pool de browsers, crashes, timeouts).
- O Railway básico não tem RAM suficiente para um pool de browsers.
- Contradiz o princípio de latência aceitável para preview.

**Decisão:** eliminado. Não é viável para o caso de uso de preview síncrono.

---

### Opção D: Python + scraper dedicado (integrar o crawler/ existente)

**Como funciona:** usar o protótipo Python em `crawler/` (httpx + jmespath) como serviço separado.

**Prós:**
- jmespath é expressivo para parsing de JSON aninhado.
- httpx suporta proxies e cookies nativamente.

**Contras:**
- Introduz um segundo runtime (Python) no monorepo, contrariando as regras em `ARQUITETURA-INSTA2FIGMA.md` §5.4.
- O scraper TypeScript já faz o mesmo que o Python faria, com melhor integração com NestJS.
- Mais infra para deployar e monitorizar.
- O `crawler/main.py` é um script de exploração, não um serviço pronto (tem chamadas hardcoded a `scrape_user("google")`).

**Decisão:** eliminado enquanto o TypeScript cobrir os casos de uso. Só reconsiderar se houver requisito específico que o TypeScript não consiga cumprir.

---

## Decision

**Opção B: Scraper próprio TypeScript com cookies de sessão + proxy residencial.**

O scraper existente já tem a estrutura certa (endpoints certos, parsing correto, cache). O que falta é:
1. Injetar cookies de sessão válidos para aumentar drasticamente o threshold de rate limit.
2. Encaminhar os pedidos por um proxy residencial para sair do IP de datacenter do Railway.
3. Adicionar retry com backoff exponencial para absorver 429s ocasionais.

Este conjunto resolve o problema de fiabilidade sem dependência de serviços externos para o scraping em si, e mantém a stack homogénea.

A Opção A (serviço externo) fica como **alternativa de emergência** se a Opção B se provar insuficiente em escala.

---

## Consequences

### Positivo
- O scraper continua a ser TypeScript — sem segundo runtime.
- Custo previsível e baixo no volume actual.
- Controlo total sobre headers e endpoints — adaptação rápida quando o Instagram muda.
- Sessões com cookies têm thresholds muito mais altos — menos 429s.

### Negativo
- A equipa passa a ser responsável por renovar sessões ocasionalmente.
- Se a sessão for bloqueada, o serviço degrada até nova sessão ser configurada.
- Adiciona configuração de proxy como pré-requisito de produção.

### Riscos
- **Sessão expirada sem aviso:** implementar health-check que verifica se a sessão ainda é válida e alerta (via log de erro específico ou notificação Sentry).
- **Mudança do Instagram:** os endpoints `i.instagram.com/api/v1/` já mudaram no passado. Monitorizar respostas inesperadas e ter testes de smoke.
- **IP do proxy bloqueado:** usar um fornecedor com pool grande e rotação automática de IP (ver ADR-003).

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts` — scraper atual
- `crawler/main.py` — protótipo Python (exploração, não produção)
- `docs/ARQUITETURA-INSTA2FIGMA.md` §5.4 — regra sobre Python no worker
- ADR-002 — implementação de cookies de sessão
- ADR-003 — implementação de proxy residencial
- ADR-004 — retry e backoff
