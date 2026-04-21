// Operator-visible outcome: /engagements page renders engagement list with real entity_ids from API, zero Mai/Constitution/Tools references, zero console errors, zero failed API requests
import { test, expect } from '@playwright/test';

const TENANT_ID = process.env.VITE_AOS_TENANT_ID || '69688df3-fc8e-51f8-a77c-9c13f9b3a784';

test.describe('Engagement list — clean of Mai concepts', () => {
  test('loads with engagement data, no errors, no Mai references', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const failedRequests: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await apiResp.json();
    expect(engagements.length).toBeGreaterThanOrEqual(1);

    await page.goto('/engagements');
    await expect(page.getByText('Engagements').first()).toContainText('Engagements', { timeout: 10000 });

    const firstEng = engagements[0];
    const eid = firstEng.acquirer_entity_id || firstEng.engagement_id?.slice(0, 8);
    await expect(page.getByText(eid).first()).toContainText(eid, { timeout: 10000 });

    const pageText = await page.textContent('body') ?? '';
    expect(pageText).not.toContain('Mai');
    expect(pageText).not.toContain('Constitution');
    expect(pageText).not.toContain('Available Tools');
    expect(pageText).not.toContain('check_module_status');
    expect(pageText).not.toContain('trigger_pipeline_run');
    expect(pageText).not.toContain('API route not found');

    expect(pageText).toContain(eid);

    const relevantFailures = failedRequests.filter(
      r => !r.includes('favicon') && !r.includes('hot-update'),
    );
    expect(relevantFailures).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await page.screenshot({ path: 'e2e/screenshots/engagement-monitor-clean.png' });
  });
});
