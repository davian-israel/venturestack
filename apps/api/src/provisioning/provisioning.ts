import { randomBytes } from 'crypto';
import { bySlug } from '@vs/catalog';
import { config, integrations } from '../config';
import { one, q } from '../db/db';
import { createService, setReplicas, ServiceSpec } from './railway';

const secret = () => randomBytes(24).toString('base64url');

/** Builds the Railway service spec for a client's dedicated open-source instance. */
export function serviceSpecFor(productSlug: string, tenantId: string): ServiceSpec | undefined {
  const product = bySlug(productSlug);
  if (!product?.perClientService) return undefined;
  const short = tenantId.slice(0, 8);
  const name = `${product.perClientService.template}-${short}`;

  switch (product.slug) {
    case 'kpi-dashboards':
      // Metabase with its app DB on a persistent volume (H2). Fine for 5–10 KPIs per client.
      return {
        name,
        image: product.perClientService.image,
        variables: { MB_DB_FILE: '/metabase-data/metabase.db', MB_JETTY_PORT: '3000', PORT: '3000' },
        volumeMountPath: '/metabase-data',
        publicDomain: true,
      };
    case 'digital-archive':
      // Paperless-ngx: SQLite + media on a volume; Redis from the shared platform instance on its own DB index.
      return {
        name,
        image: product.perClientService.image,
        variables: {
          PAPERLESS_REDIS: `${config.REDIS_URL}/${(parseInt(short, 16) % 14) + 2}`,
          PAPERLESS_DATA_DIR: '/data/data',
          PAPERLESS_MEDIA_ROOT: '/data/media',
          PAPERLESS_CONSUMPTION_DIR: '/data/consume',
          PAPERLESS_SECRET_KEY: secret(),
          PAPERLESS_ADMIN_USER: 'admin',
          PAPERLESS_ADMIN_PASSWORD: secret(),
          PAPERLESS_OCR_LANGUAGE: 'eng',
          PAPERLESS_PORT: '8000',
          PORT: '8000',
        },
        volumeMountPath: '/data',
        publicDomain: true,
      };
    case 'ar-recovery':
      // Invoice Ninja v5 needs MySQL; the worker provisions a sibling MySQL service first (see provision()).
      return {
        name,
        image: product.perClientService.image,
        variables: {
          APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
          APP_DEBUG: 'false',
          REQUIRE_HTTPS: 'true',
          IN_USER_EMAIL: config.OWNER_EMAIL,
          IN_PASSWORD: secret(),
          DB_HOST: `mysql-${short}.railway.internal`,
          DB_PORT: '3306',
          DB_DATABASE: 'ninja',
          DB_USERNAME: 'ninja',
          DB_PASSWORD: '${{mysql-' + short + '.MYSQL_PASSWORD}}',
          PORT: '80',
        },
        volumeMountPath: '/var/www/app/public/storage',
        publicDomain: true,
      };
    default:
      return undefined;
  }
}

export async function provision(tenantId: string, productSlug: string): Promise<{ state: string; url?: string }> {
  const existing = await one<{ railway_service_id: string | null; state: string; url: string | null }>(
    'SELECT railway_service_id, state, url FROM provisioned_services WHERE tenant_id=$1 AND product_slug=$2',
    [tenantId, productSlug],
  );
  if (existing?.state === 'live') return { state: 'live', url: existing.url ?? undefined };
  if (existing?.state === 'suspended' && existing.railway_service_id) {
    await setReplicas(existing.railway_service_id, 1);
    await q(`UPDATE provisioned_services SET state='live', updated_at=now() WHERE tenant_id=$1 AND product_slug=$2`, [tenantId, productSlug]);
    return { state: 'live', url: existing.url ?? undefined };
  }

  const spec = serviceSpecFor(productSlug, tenantId);
  if (!spec) {
    // Shared-infrastructure products (Agent Reach, Audit, Voice, Sales, Attribution) need no dedicated service.
    await q(
      `INSERT INTO provisioned_services (tenant_id, product_slug, state) VALUES ($1,$2,'live')
       ON CONFLICT (tenant_id, product_slug) DO UPDATE SET state='live', updated_at=now()`,
      [tenantId, productSlug],
    );
    return { state: 'live' };
  }
  if (!integrations().railway) throw new Error('Railway provisioning not configured (RAILWAY_API_TOKEN/PROJECT_ID/ENVIRONMENT_ID)');

  if (productSlug === 'ar-recovery') {
    const short = tenantId.slice(0, 8);
    await createService({
      name: `mysql-${short}`,
      image: 'mysql:8',
      variables: { MYSQL_DATABASE: 'ninja', MYSQL_USER: 'ninja', MYSQL_PASSWORD: secret(), MYSQL_ROOT_PASSWORD: secret() },
      volumeMountPath: '/var/lib/mysql',
    });
  }

  const svc = await createService(spec);
  await q(
    `INSERT INTO provisioned_services (tenant_id, product_slug, railway_service_id, url, state) VALUES ($1,$2,$3,$4,'live')
     ON CONFLICT (tenant_id, product_slug) DO UPDATE SET railway_service_id=EXCLUDED.railway_service_id, url=EXCLUDED.url, state='live', updated_at=now()`,
    [tenantId, productSlug, svc.id, svc.url ?? null],
  );
  return { state: 'live', url: svc.url };
}

export async function suspend(tenantId: string, productSlug: string): Promise<void> {
  const row = await one<{ railway_service_id: string | null }>(
    'SELECT railway_service_id FROM provisioned_services WHERE tenant_id=$1 AND product_slug=$2',
    [tenantId, productSlug],
  );
  if (row?.railway_service_id) await setReplicas(row.railway_service_id, 0);
  await q(`UPDATE provisioned_services SET state='suspended', updated_at=now() WHERE tenant_id=$1 AND product_slug=$2`, [tenantId, productSlug]);
}
