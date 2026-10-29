import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { one } from '../db/db';
import { isEntitled, EntitlementRow } from '../billing/entitlement-rules';

export interface Session {
  tenantId: string;
  email: string;
}

export const signMagic = (s: Session) => jwt.sign({ ...s, kind: 'magic' }, config.JWT_SECRET, { expiresIn: '15m' });
export const signSession = (s: Session) => jwt.sign({ ...s, kind: 'session' }, config.JWT_SECRET, { expiresIn: '30d' });

export function verify(token: string, kind: 'magic' | 'session'): Session {
  const p = jwt.verify(token, config.JWT_SECRET) as Session & { kind: string };
  if (p.kind !== kind) throw new UnauthorizedException();
  return { tenantId: p.tenantId, email: p.email };
}

/** Requires a valid session cookie/bearer token. */
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();
    try {
      req.session = verify(token, 'session');
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

export const PRODUCT_PARAM = 'paywall:productParam';
/** Marks a route as paywalled; the product slug is read from the named route param. */
export const Paywalled = (param = 'slug') => SetMetadata(PRODUCT_PARAM, param);

/**
 * The paywall. Runs after SessionGuard. Blocks the request unless the tenant
 * holds a live entitlement for the product in the route.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const param = this.reflector.get<string>(PRODUCT_PARAM, ctx.getHandler());
    if (!param) return true;
    const req = ctx.switchToHttp().getRequest();
    const session: Session | undefined = req.session;
    if (!session) throw new UnauthorizedException();
    const slug = req.params[param];
    const row = await one<EntitlementRow>('SELECT status, grace_until FROM entitlements WHERE tenant_id=$1 AND product_slug=$2', [
      session.tenantId,
      slug,
    ]);
    if (!isEntitled(row)) throw new ForbiddenException({ code: 'payment_required', product: slug });
    return true;
  }
}
