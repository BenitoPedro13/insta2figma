import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Envelope `{ data }` conforme docs/ARQUITETURA §7. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<object> {
    return next.handle().pipe(
      map((payload) =>
        typeof payload === 'undefined' ? { data: null } : { data: payload },
      ),
    );
  }
}
