import { and, eq } from 'drizzle-orm';
import { auth } from './auth.js';
import { getAuthDb } from './db.js';
import { memberships, tenants } from './schema.js';
import { HttpError } from './errors.js';
import type { Role, TenantContext } from './types.js';

export async function getContext(headers: Headers, tenantId?: string): Promise<TenantContext> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const rows = await getAuthDb()
    .select()
    .from(memberships)
    .where(eq(memberships.userId, session.user.id));
  const membership = tenantId ? rows.find((r) => r.tenantId === tenantId) : rows[0];
  if (!membership || (membership.role !== 'admin' && membership.role !== 'staff'))
    throw new HttpError(403, 'TENANT_DENIED', 'You do not have access to this business.');
  return {
    tenantId: membership.tenantId,
    actor: { type: membership.role, id: session.user.id },
    role: membership.role as Role,
  };
}
export async function getMemberships(userId: string) {
  return getAuthDb()
    .select({ tenantId: memberships.tenantId, name: tenants.name, role: memberships.role })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(eq(memberships.userId, userId));
}
export async function assertMembership(ctx: TenantContext) {
  if (!ctx.role || ctx.actor.type !== ctx.role)
    throw new HttpError(403, 'INVALID_ACTOR', 'A valid staff session is required.');
  const row = (
    await getAuthDb()
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, ctx.actor.id), eq(memberships.tenantId, ctx.tenantId)))
  )[0];
  if (!row || row.role !== ctx.role)
    throw new HttpError(403, 'MEMBERSHIP_REVOKED', 'Business access has been revoked.');
}
