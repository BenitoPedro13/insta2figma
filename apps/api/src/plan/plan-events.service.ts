import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CACHE_CLIENT } from '../cache/redis-cache.module';

/**
 * Notifica long-polls abertos quando o plano de um utilizador muda (ADR-008).
 *
 * - `waitForChange` regista um waiter que resolve quando o plano muda ou no timeout.
 * - `publishChange` (chamado pelo BillingService) acorda waiters locais e propaga
 *   via Redis pub/sub para as outras réplicas.
 * - O subscriber Redis é uma conexão dedicada (em modo subscribe o ioredis não
 *   aceita outros comandos). Se o pub/sub falhar, o fast path cross-réplica fica
 *   desligado, mas o fallback de `syncCustomerState(force)` no MeController cobre.
 */
@Injectable()
export class PlanEventsService implements OnModuleInit, OnModuleDestroy {
  private static readonly CHANNEL = 'plan-updates';
  private readonly log = new Logger(PlanEventsService.name);
  private readonly waiters = new Map<string, Set<() => void>>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CACHE_CLIENT) private readonly publisher: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
      });
      await this.subscriber.subscribe(PlanEventsService.CHANNEL);
      this.subscriber.on('message', (_channel, raw) => {
        try {
          const { userId } = JSON.parse(raw) as { userId?: string };
          if (userId) this.notifyLocal(userId);
        } catch {
          /* mensagem malformada — ignorar */
        }
      });
      this.log.log('Plan events: Redis pub/sub activo.');
    } catch (e) {
      this.subscriber = null;
      this.log.warn(
        'Plan events: pub/sub indisponível — fast path cross-réplica desligado (fallback de timeout cobre).',
        e as Error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } finally {
      this.subscriber = null;
    }
  }

  /** Resolve `true` se notificado dentro do timeout, `false` se expirou. */
  waitForChange(userId: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (changed: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.removeWaiter(userId, waiter);
        resolve(changed);
      };
      const waiter = (): void => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.addWaiter(userId, waiter);
    });
  }

  /** Chamado pelo BillingService quando um plano muda. */
  async publishChange(userId: string): Promise<void> {
    this.notifyLocal(userId);
    try {
      await this.publisher.publish(
        PlanEventsService.CHANNEL,
        JSON.stringify({ userId }),
      );
    } catch {
      /* fallback de timeout no MeController cobre */
    }
  }

  private notifyLocal(userId: string): void {
    const set = this.waiters.get(userId);
    if (!set) return;
    for (const w of [...set]) w();
  }

  private addWaiter(userId: string, waiter: () => void): void {
    let set = this.waiters.get(userId);
    if (!set) {
      set = new Set();
      this.waiters.set(userId, set);
    }
    set.add(waiter);
  }

  private removeWaiter(userId: string, waiter: () => void): void {
    const set = this.waiters.get(userId);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.waiters.delete(userId);
  }
}
