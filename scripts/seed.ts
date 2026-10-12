import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { defaultConfig } from '../packages/core/src/policy.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import type { WorkflowDefinition } from '../packages/core/src/types.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';

process.loadEnvFile('.env');
assertLocalDemoDatabase();
process.env.AFTERHOURS_SEED_SIGNUP = '1';
const { auth } = await import('../packages/core/src/auth.js');
const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const accessFile = '.data/demo-access.json';
const access = existsSync(accessFile)
  ? (JSON.parse(readFileSync(accessFile, 'utf8')) as { password: string })
  : { password: randomBytes(18).toString('base64url') };
writeFileSync(accessFile, JSON.stringify(access, null, 2) + '\n', { mode: 0o600 });
const demoTenants = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Mavi Atölye',
    email: 'admin@afterhours.local',
    staff: 'staff@afterhours.local',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Ada Pansiyon',
    email: 'other@afterhours.local',
    staff: null,
  },
];
try {
  for (const tenant of demoTenants) {
    await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      tenant.id,
      tenant.name,
    ]);
    for (const [email, role] of [
      [tenant.email, 'admin'],
      ...(tenant.staff ? [[tenant.staff, 'staff']] : []),
    ]) {
      if (!email) continue;
      let row = (
        await owner.query<{ id: string }>('SELECT id FROM auth."user" WHERE email=$1', [email])
      ).rows[0];
      if (!row)
        row = (
          await auth.api.signUpEmail({
            body: {
              name: role === 'admin' ? 'İşletme Yöneticisi' : 'Operasyon Ekibi',
              email,
              password: access.password,
            },
          })
        ).user;
      await owner.query(
        'INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [tenant.id, row.id, role],
      );
    }
    await tenantDb(tenant.id, async (db) => {
      if (!(await db.select().from(s.configurations)).length)
        await db
          .insert(s.configurations)
          .values({ tenantId: tenant.id, version: 1, value: defaultConfig(tenant.name) });
      const browserId =
        tenant.id === '11111111-1111-4111-8111-111111111111'
          ? '31111111-1111-4111-8111-111111111111'
          : '32222222-2222-4222-8222-222222222222';
      const channelId =
        tenant.id === '11111111-1111-4111-8111-111111111111'
          ? '41111111-1111-4111-8111-111111111111'
          : '42222222-2222-4222-8222-222222222222';
      await db
        .insert(s.connections)
        .values({
          id: browserId,
          tenantId: tenant.id,
          name: 'Talep kayıt sitesi',
          kind: 'browser',
          purpose: 'Müşteri ve servis taleplerini kaydeder. Yerel test sistemidir.',
          status: 'awaiting_test',
          config: {
            startUrl: 'http://127.0.0.1:4001/requests/new',
            allowedOrigins: ['http://127.0.0.1:4001'],
            mode: 'demo',
          },
          permissions: ['browser.execute', 'teaching.record'],
          agents: ['admin', 'staff', 'customer', 'cron'],
        })
        .onConflictDoNothing();
      await db
        .insert(s.connections)
        .values({
          id: channelId,
          tenantId: tenant.id,
          name: 'WhatsApp test kanalı',
          kind: 'whatsapp',
          purpose: 'Panelden girilen test mesajları. Gerçek WhatsApp hesabı bağlı değildir.',
          status: 'ready',
          config: { mode: 'demo' },
          permissions: ['message.send'],
          agents: ['admin', 'staff', 'customer'],
        })
        .onConflictDoNothing();
      const def: WorkflowDefinition = {
        name: 'Müşteri talebi oluştur',
        purpose:
          'Ad, iletişim bilgisi ve talep açıklamasını test sitesine kaydeder; oluşan kaydı referansıyla okuyarak doğrular.',
        connectionId: browserId,
        inputs: [
          { key: 'customerName', label: 'Müşteri adı', required: true },
          { key: 'customerAddress', label: 'İletişim', required: true },
          { key: 'description', label: 'Talep açıklaması', required: true },
        ],
        steps: [
          { action: 'goto', url: 'http://127.0.0.1:4001/requests/new' },
          { action: 'fill', selector: '[name="customerName"]', value: '{{customerName}}' },
          { action: 'fill', selector: '[name="customerAddress"]', value: '{{customerAddress}}' },
          { action: 'fill', selector: '[name="description"]', value: '{{description}}' },
          { action: 'fill', selector: '[name="reference"]', value: '{{reference}}' },
          { action: 'click', selector: 'button[type="submit"]' },
        ],
        verification: {
          selector: '#request-record',
          recordIdSelector: '#request-id',
          expected: '{{description}}',
        },
        idempotency: {
          lookupUrl: 'http://127.0.0.1:4001/requests/by-reference/{{reference}}',
          recordIdSelector: '#request-id',
          absentSelector: '[data-afterhours-lookup="absent"]',
        },
        requiresApproval: false,
      };
      if (
        !(await db.select().from(s.workflows).where(eq(s.workflows.connectionId, browserId))).length
      )
        await db.insert(s.workflows).values({
          tenantId: tenant.id,
          name: def.name,
          purpose: def.purpose,
          connectionId: browserId,
          definition: def,
          status: 'awaiting_test',
        });
      await db
        .insert(s.runtime)
        .values({ tenantId: tenant.id, key: 'demo.seed', value: { version: 1 } })
        .onConflictDoNothing();
    });
  }
  console.log('Two isolated demo businesses and admin/staff memberships are ready.');
  console.log('Demo password is stored only in .data/demo-access.json (mode 0600).');
  console.log(
    'Automation and payments remain disabled. Reference workflow requires three verified trials before publication.',
  );
} finally {
  await owner.end();
  await closeDb();
}
