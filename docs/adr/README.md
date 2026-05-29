# Architecture Decision Records — Scraper de Instagram

Este diretório contém os ADRs (Architecture Decision Records) relacionados com a estratégia de scraping do Instagram no insta2figma.

ADRs documentam **decisões técnicas significativas**: o contexto, as opções consideradas, a decisão tomada e as consequências esperadas. O objetivo é que qualquer pessoa (humano ou LLM) que chegue ao código meses depois entenda **porquê** as coisas estão como estão.

## Formato

Cada ADR segue o template MADR com os campos:

- **Status** — `Proposed` → `Accepted` → `Deprecated / Superseded by ADR-XXX`
- **Context** — o problema e o estado do mundo quando a decisão foi tomada
- **Decision Drivers** — critérios que pesam na decisão
- **Options** — alternativas reais consideradas, com prós/contras honestos
- **Decision** — o que foi decidido e porquê
- **Consequences** — o que muda, o que piora, os riscos
- **Implementation** — notas concretas de como implementar

## Índice

| ADR | Título | Status |
|-----|--------|--------|
| [ADR-001](ADR-001-scraper-proprio-vs-servico-externo.md) | Scraper próprio vs. serviço externo de scraping | Accepted |
| [ADR-002](ADR-002-session-cookies-instagram.md) | Gestão de sessões do Instagram (pool de contas) | Revised |
| [ADR-003](ADR-003-proxy-residencial.md) | Routing de pedidos ao Instagram via proxy residencial | Accepted |
| [ADR-004](ADR-004-retry-backoff-429.md) | Retry com backoff exponencial em respostas 429/503 | Accepted |
| [ADR-005](ADR-005-cache-ttl-preview.md) | Estratégia de cache para previews (TTL e Redis) | Accepted |
| [ADR-006](ADR-006-scrape-telemetria.md) | Telemetria de operações de scraping (PostgreSQL) | Accepted |

## Contexto global

O insta2figma faz scraping de perfis públicos do Instagram para mostrar previews no plugin Figma e importar imagens para o canvas. O fluxo actual usa o endpoint não autenticado `i.instagram.com/api/v1/users/web_profile_info/` a partir de um servidor Railway (IP de datacenter), sem cookies, sem proxy e sem retry. Isso resulta em respostas 429 frequentes, especialmente em horas de pico ou depois de burst de pedidos, tornando o produto inutilizável.

Os ADRs neste diretório documentam as decisões para tornar o scraper resiliente.
