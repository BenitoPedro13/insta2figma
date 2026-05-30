import { BadRequestException } from '@nestjs/common';
import type { CachedPreviewPayload, PreviewDataSource, TelemetryCtx } from './preview-source.types';

/**
 * Encadeia uma fonte primária com fallbacks para o endpoint de profile-preview.
 * Tenta a primária; em falha (excepto BadRequestException) percorre os fallbacks.
 * BadRequestException (404, username inválido) curto-circuita — não vale gastar
 * um fallback pago num perfil que genuinamente não existe.
 */
export class FallbackPreviewSource implements PreviewDataSource {
  readonly name: string;

  constructor(
    private readonly primary: PreviewDataSource,
    private readonly fallbacks: PreviewDataSource[],
  ) {
    this.name = `fallback(${primary.name} → [${fallbacks.map((f) => f.name).join(', ')}])`;
  }

  async fetchPreview(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
    ctx?: TelemetryCtx,
  ): Promise<CachedPreviewPayload> {
    let primaryErr: unknown;

    try {
      return await this.primary.fetchPreview(username, fetchCount, timelineOrder, ctx);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      primaryErr = err;
      console.warn(
        `[preview] "${this.primary.name}" falhou (${err instanceof Error ? err.message : String(err)}); a tentar fallback(s).`,
      );
    }

    for (const fb of this.fallbacks) {
      try {
        const result = await fb.fetchPreview(username, fetchCount, timelineOrder, ctx);
        console.info(`[preview] fallback "${fb.name}" teve sucesso.`);
        return result;
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        console.warn(
          `[preview] fallback "${fb.name}" também falhou (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    }

    throw primaryErr;
  }
}
