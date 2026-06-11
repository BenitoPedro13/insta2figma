# TASK — Formulário "Send feedback" in-plugin (estilo AlignUI contact form)

## Cenário actual

- O item "Send feedback" do menu (`PluginMenuDropdown.tsx:113`) abre um `mailto:` para
  `marcus@mainnet.design` — sem formulário, sem registo em banco, sem contexto de plataforma.
- Não existe tabela de feedback nem endpoint na API.
- O `EmailService` (Gmail API) já existe e é exportado pelo `AuthModule`.
- A UI partilhada já tem componentes AlignUI (`ui/input`, `ui/fancy-button`), mas não tem
  `Textarea`.

## Mudanças planeadas

Referência visual: formulário de contacto da AlignUI (alignui.com/contact), simplificado
para **Full Name + Email + Message** (200 chars). A **platform** (`figma`/`framer`) vai
escondida — injectada pelo host, o utilizador não a vê.

| Ficheiro | Tipo | Mudança |
|----------|------|---------|
| `apps/api/prisma/schema.prisma` | edição | `model Feedback` (id, name, email, message, platform?, userId?, createdAt) + relação opcional com `User` |
| `apps/api/prisma/migrations/...` | novo | Migração `add_feedback_table` |
| `apps/api/src/feedback/feedback.module.ts` | novo | Módulo (importa AuthModule p/ EmailService + guard) |
| `apps/api/src/feedback/feedback.controller.ts` | novo | `POST /v1/feedback` com `OptionalJwtAuthGuard` (userId quando autenticado) |
| `apps/api/src/feedback/feedback.service.ts` | novo | Grava na tabela; envia email (não-fatal se Gmail falhar) |
| `apps/api/src/feedback/dto/create-feedback.dto.ts` | novo | name 1–100, email válido, message 1–200, platform opcional `figma\|framer` |
| `apps/api/src/auth/email.service.ts` | edição | Novo `sendFeedback(...)` → envia para `FEEDBACK_EMAIL_TO ?? GMAIL_FROM` |
| `apps/api/src/app.module.ts` | edição | Registar `FeedbackModule` |
| `apps/api/.env.example` | edição | `FEEDBACK_EMAIL_TO` (opcional) |
| `packages/plugin-ui/src/components/ui/textarea.tsx` | novo | Textarea estilo AlignUI com contador de caracteres |
| `packages/plugin-ui/src/components/ui/index.ts` | edição | Exportar `Textarea` |
| `packages/plugin-ui/src/screens/FeedbackScreen.tsx` | novo | Overlay com o formulário (idle/sending/done/error) |
| `packages/plugin-ui/src/App.tsx` | edição | Estado `showFeedback` + `feedbackState`; handler de `feedback-done`/`feedback-error`; submit via `host.send({type:'feedback-submit',...})` |
| `packages/plugin-ui/src/screens/ImportScreen.tsx` | edição | Prop `onFeedback` → PanelHeader |
| `packages/plugin-ui/src/components/PanelHeader.tsx` | edição | Prop `onFeedback` → PluginMenuDropdown |
| `packages/plugin-ui/src/components/PluginMenuDropdown.tsx` | edição | "Send feedback" abre o formulário em vez do mailto |
| `apps/figma-plugin/src/code.ts` | edição | Handler `feedback-submit` → `POST /v1/feedback` com `platform: 'figma'` (token opcional) |
| `apps/framer-plugin/src/FramerHost.ts` | edição | Case `feedback-submit` → idem com `platform: 'framer'` |
| `apps/api/README.md` | edição | Linha do endpoint na tabela |

## Porquê

Feedback estruturado: chega por email (operacional hoje) **e** fica numa tabela com
`platform` + `userId` para o dashboard futuro. O mailto actual perde tudo isso e abre
o cliente de email do utilizador (fricção). A plataforma vai escondida porque o host
já a conhece — o utilizador não deve preencher nem ver esse campo.

## Ficheiros afectados

Ver tabela acima (5 novos, 11 edições).
