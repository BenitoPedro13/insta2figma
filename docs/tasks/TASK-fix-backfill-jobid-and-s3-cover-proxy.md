# TASK — Corrigir enqueue backfill (jobId com `:`) e covers S3 não carregarem nos plugins

## Cenário actual

### Bug 1 — Backfill nunca enfileira
Em `IgCatalogService.enqueueBackfill` o job BullMQ é criado com
`jobId: \`media:${p.shortcode}\``. O BullMQ **não permite `:` em custom job IDs**, por
isso cada enqueue falha com:

```
[catalog] enqueue backfill falhou Custom Id cannot contain :
```

Resultado: a fila `media-backfill-v1` nunca recebe jobs novos → covers de posts novos
não são descarregados para S3 pelo write-through.

### Bug 2 — Covers servidos do catálogo (S3) não carregam nos plugins
Com o catálogo activo, a preview passou a servir os covers de posts como **URLs S3
assinadas** (`https://t3.storageapi.dev/...`). Confirmado em produção:

```
postsPreview[].thumbnailUrl -> t3.storageapi.dev   (todos)
profilePicUrlHd             -> scontent-*.cdninstagram.com
```

Mas ambos os plugins embrulham **todas** as thumbnails através do proxy da API
(`${base}/v1/instagram/image?url=...`). O proxy (`InstagramController.proxyImage` +
`isInstagramCdnUrl`) só aceita hosts `cdninstagram.com`/`fbcdn.net` e devolve **400**
para qualquer outro. Logo as URLs S3 → 400 → imagens partidas.

Verificado contra produção:
| Pedido | Resultado |
|--------|-----------|
| proxy sobre URL S3 do cover | **HTTP 400** |
| fetch directo da URL S3 | HTTP 200 (imagem) |
| proxy sobre profilePic cdninstagram | HTTP 200 |

`t3.storageapi.dev` **já está** no `allowedDomains` do manifest Figma e a URL é
directamente carregável — não deve ser proxied. O proxy deve manter-se restrito a IG
CDN (evita ser um open proxy / SSRF).

## Mudanças planeadas

1. **`apps/api/src/instagram/catalog/ig-catalog.service.ts`** — trocar o separador do
   job id de `media:${shortcode}` para `media-${shortcode}` (BullMQ-safe). Actualizar o
   comentário JSDoc que documenta `jobId='media:'+shortcode`.

2. **`apps/figma-plugin/src/code.ts`** — só fazer proxy de URLs de IG CDN. Para `data:`,
   `blob:` e hosts já permitidos no manifest (S3 `t3.storageapi.dev`) usar a URL directa.
   Aplica-se ao loop de thumbnails e ao `profilePicUrlHd`. Adicionar helper `isIgCdnUrl`
   (regex, sem depender de `URL` que pode não existir na sandbox do main thread).

3. **`apps/framer-plugin/src/FramerHost.ts`** — mesma lógica (`isIgCdnUrl`) no loop de
   thumbnails e no `profilePicUrlHd`.

## Porquê
- Bug 1: a fila de backfill está 100% inoperacional; posts novos nunca ganham covers
  persistidos. Fix trivial e sem migração.
- Bug 2: a feature de catálogo (covers S3) é precisamente o que o utilizador está a
  desenvolver; servir S3 directo (em vez de via proxy IG-only) corrige as imagens
  partidas, evita um hop desnecessário pelo Railway, e mantém o proxy seguro/estrito.

## Ficheiros afectados
| Ficheiro | Mudança |
|----------|---------|
| `apps/api/src/instagram/catalog/ig-catalog.service.ts` | edição — jobId `media:`→`media-` + comentário |
| `apps/figma-plugin/src/code.ts` | edição — proxy só p/ IG CDN (thumbs + profilePic) |
| `apps/framer-plugin/src/FramerHost.ts` | edição — proxy só p/ IG CDN (thumbs + profilePic) |
| `CLAUDE.md` | doc — nota sobre proxy IG-only vs covers S3 directos |
