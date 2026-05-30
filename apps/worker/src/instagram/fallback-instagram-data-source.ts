import type {
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { InstagramUpstreamError } from './instagram-upstream-error';
import type { InstagramDataSource } from './http-instagram-data-source';

type NamedSource = { name: string; source: InstagramDataSource };

/**
 * Encadeia uma fonte primária com fallbacks. Tenta a primária; se ela falhar
 * com um erro que NÃO seja "utilizador inexistente", percorre os fallbacks em
 * ordem. Se todos falharem, relança o último erro (preservando `retryable`
 * para que o BullMQ decida re-tentar o job inteiro).
 *
 * `IG_NOT_FOUND` curto-circuita: não vale a pena gastar um fallback pago num
 * username que genuinamente não existe.
 */
export class FallbackInstagramDataSource implements InstagramDataSource {
  private readonly primary: NamedSource;
  private readonly fallbacks: NamedSource[];

  constructor(primary: NamedSource, fallbacks: NamedSource[]) {
    this.primary = primary;
    this.fallbacks = fallbacks;
  }

  private static isDefinitiveNotFound(err: unknown): boolean {
    return err instanceof InstagramUpstreamError && err.code === 'IG_NOT_FOUND';
  }

  async fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    let lastErr: unknown;

    try {
      return await this.primary.source.fetchProfilePostsSample(
        usernameNormalized,
        selectionInput,
        defaults,
      );
    } catch (err) {
      if (FallbackInstagramDataSource.isDefinitiveNotFound(err)) throw err;
      lastErr = err;
      console.warn(
        `[ig-source] primária "${this.primary.name}" falhou (${err instanceof InstagramUpstreamError ? err.code : 'UNKNOWN'}); a tentar fallback(s).`,
      );
    }

    for (const fb of this.fallbacks) {
      try {
        const result = await fb.source.fetchProfilePostsSample(
          usernameNormalized,
          selectionInput,
          defaults,
        );
        console.info(`[ig-source] fallback "${fb.name}" teve sucesso.`);
        return result;
      } catch (err) {
        if (FallbackInstagramDataSource.isDefinitiveNotFound(err)) throw err;
        lastErr = err;
        console.warn(
          `[ig-source] fallback "${fb.name}" falhou (${err instanceof InstagramUpstreamError ? err.code : 'UNKNOWN'}).`,
        );
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new InstagramUpstreamError(
          'IG_UPSTREAM',
          'All Instagram data sources failed.',
          true,
        );
  }
}
