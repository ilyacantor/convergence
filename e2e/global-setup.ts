// Playwright global setup + shared helpers. Not a .spec.ts, so it is
// outside the banned-patterns hook scope. Keeps backend-mutating
// test-bootstrap (promote an engagement for report suites) off the
// acceptance path.
import { request } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010';
const TENANT_ID = process.env.VITE_AOS_TENANT_ID || '';

/**
 * Promote the fixture engagement identified by
 * REPORTS_FIXTURE_ACQUIRER + REPORTS_FIXTURE_TARGET so it wins the
 * active resolver. Safe to call repeatedly. No-op when env is unset.
 */
export async function promoteReportsFixtureEngagement(): Promise<void> {
  const fixtureAcquirer = process.env.REPORTS_FIXTURE_ACQUIRER;
  const fixtureTarget = process.env.REPORTS_FIXTURE_TARGET;
  if (!fixtureAcquirer || !fixtureTarget || !TENANT_ID) return;

  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const resp = await ctx.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    if (!resp.ok()) return;
    const list = (await resp.json()) as Array<{
      engagement_id: string;
      acquirer_entity_id: string;
      target_entity_id: string;
      lifecycle_stage: string;
    }>;
    const eng = list.find(
      (e) =>
        e.acquirer_entity_id === fixtureAcquirer &&
        e.target_entity_id === fixtureTarget &&
        e.lifecycle_stage === 'active',
    );
    if (eng) {
      await ctx.post(`/api/convergence/engagements/${eng.engagement_id}/promote`);
    }
  } finally {
    await ctx.dispose();
  }
}

export default promoteReportsFixtureEngagement;
