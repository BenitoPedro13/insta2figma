/** Domínios sintéticos que o Polar rejeita (DNS inexistente ou reservados). */
const PLACEHOLDER_EMAIL_SUFFIXES = [
  '@users.insta2figma.app',
  '@example.com',
  '@example.org',
  '@test.com',
];

const DEFAULT_PLACEHOLDER_DOMAIN = 'mailinator.com';

function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLACEHOLDER_EMAIL_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * Email para criar cliente Polar.
 * Domínio configurável via POLAR_SYNTHETIC_EMAIL_DOMAIN (default: mailinator.com).
 */
export function emailForPolar(
  user: {
    id: string;
    email?: string | null;
    figmaUserId?: string | null;
  },
  placeholderDomain = DEFAULT_PLACEHOLDER_DOMAIN,
): string {
  const stored = user.email?.trim();
  if (stored && !isPlaceholderEmail(stored) && stored.includes('@')) {
    return stored;
  }
  const key = (user.figmaUserId ?? user.id.replace(/-/g, ''))
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 48);
  const domain = placeholderDomain.replace(/^@+/, '').trim() || DEFAULT_PLACEHOLDER_DOMAIN;
  return `figma+${key}@${domain}`;
}

/** No checkout, deixar o utilizador introduzir email real no Polar. */
export function shouldOmitCheckoutCustomerEmail(email: string): boolean {
  return isPlaceholderEmail(email);
}

export function isPolarSdkNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ResourceNotFound'
  );
}

export function isPolarSdkValidation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'HTTPValidationError'
  );
}

/** Extrai mensagem legível de erros do SDK Polar. */
export function formatPolarError(err: unknown): string {
  if (typeof err !== 'object' || err === null) {
    return String(err);
  }
  const bodyRaw =
    'body$' in err && typeof (err as { body$: unknown }).body$ === 'string'
      ? (err as { body$: string }).body$
      : 'body' in err && typeof (err as { body: unknown }).body === 'string'
        ? (err as { body: string }).body
        : null;
  if (bodyRaw) {
    try {
      const parsed = JSON.parse(bodyRaw) as {
        detail?: unknown;
      };
      if (Array.isArray(parsed.detail)) {
        return parsed.detail
          .map((d) => {
            if (d && typeof d === 'object' && 'msg' in d) {
              return String((d as { msg: unknown }).msg);
            }
            return JSON.stringify(d);
          })
          .join('; ');
      }
      if (typeof parsed.detail === 'string') return parsed.detail;
    } catch {
      return bodyRaw.slice(0, 400);
    }
  }
  if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Erro Polar desconhecido';
}
