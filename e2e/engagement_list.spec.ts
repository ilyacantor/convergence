// Operator-visible outcome: /engagements page renders a table with one row per engagement returned by the API, each showing short name or entity pair, lifecycle stage badge, and type
import { test, expect } from '@playwright/test';

const TENANT_ID = process.env.VITE_AOS_TENANT_ID || '69688df3-fc8e-51f8-a77c-9c13f9b3a784';

test.describe('Engagement list page', () => {
  test('renders engagement rows matching API data', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    expect(apiResp.ok()).toBe(true);
    const engagements = await apiResp.json();

    await page.goto('/engagements');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Engagements' })).toBeVisible({ timeout: 5000 });

    if (engagements.length === 0) {
      await expect(page.getByText('No engagements yet')).toBeVisible({ timeout: 3000 });
    } else {
      const rows = page.locator('tr[data-testid^="engagement-row-"]');
      await expect(rows).toHaveCount(engagements.length, { timeout: 5000 });

      const first = engagements.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
      const firstRow = page.locator(`tr[data-testid="engagement-row-${first.engagement_id}"]`);
      await expect(firstRow).toBeVisible({ timeout: 3000 });

      const rowText = await firstRow.textContent();
      expect(rowText).toContain(first.lifecycle_stage);
      expect(rowText).toContain(first.engagement_type);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('filter buttons narrow displayed engagements', async ({ page }) => {
    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await apiResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    await page.goto('/engagements');
    await page.waitForLoadState('networkidle');

    const activeCount = engagements.filter((e: any) => e.lifecycle_stage === 'active').length;
    await page.getByRole('button', { name: 'active' }).click();

    const rows = page.locator('tr[data-testid^="engagement-row-"]');
    await expect(rows).toHaveCount(activeCount, { timeout: 3000 });

    await page.getByRole('button', { name: 'all' }).click();
    await expect(rows).toHaveCount(engagements.length, { timeout: 3000 });
  });
});
