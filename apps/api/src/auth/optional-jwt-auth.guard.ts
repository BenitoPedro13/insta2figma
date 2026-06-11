import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { ExecutionContext } from '@nestjs/common';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Missing or invalid JWT: swallow the error and continue with req.user = undefined
  // (controller treats undefined user as free-tier anonymous).
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // no-op — unauthenticated request proceeds as guest
    }
    return true;
  }
}
