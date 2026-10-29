import type { ProductSlug } from '@vs/catalog';
import { ProductHandler } from './types';
import { agentReach } from './agent-reach/handler';
import { securityAudit } from './security-audit/handler';
import { voiceStudio } from './voice-studio/handler';
import { salesDept } from './sales-dept/handler';
import { kpiDashboards } from './kpi-dashboards/handler';
import { digitalArchive } from './digital-archive/handler';
import { arRecovery } from './ar-recovery/handler';
import { offlineAttribution } from './offline-attribution/handler';

export const HANDLERS: Record<ProductSlug, ProductHandler> = {
  'agent-reach': agentReach,
  'security-audit': securityAudit,
  'voice-studio': voiceStudio,
  'sales-dept': salesDept,
  'kpi-dashboards': kpiDashboards,
  'digital-archive': digitalArchive,
  'ar-recovery': arRecovery,
  'offline-attribution': offlineAttribution,
};

export const handlerFor = (slug: string): ProductHandler | undefined => (HANDLERS as Record<string, ProductHandler>)[slug];
