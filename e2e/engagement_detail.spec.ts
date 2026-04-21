// Operator-visible outcome: clicking an engagement row on /engagements navigates to /engagements/{id} showing a detail page with the engagement short name or entity pair in the header, lifecycle stage badge, and four tabs (Overview, Resolutions, COFA, Reports) with Overview active by default displaying the run ledger and human review queue
import { test, expect } from '@playwright/test';

const TENANT_ID = process.env.VITE_AOS_TENANT_ID || '69688df3-fc8e-51f8-a77c-9c13f9b3a784';

test.describe('Engagement detail page', () => {
  test('navigate from list to detail and verify tabs', async ({ page }) => {
    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await apiResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    const eng = engagements[0];

    await page.goto('/engagements');
    await page.waitForLoadState('networkidle');

    await page.locator(`tr[data-testid="engagement-row-${eng.engagement_id}"]`).click();
    await expect(page).toHaveURL(`/engagements/${eng.engagement_id}`);

    const expectedName = eng.engagement_short_name || `${eng.acquirer_entity_id} + ${eng.target_entity_id}`;
    await expect(page.getByText(expectedName, { exact: false })).toBeVisible({ timeout: 5000 });

    await expect(page.getByText(eng.lifecycle_stage)).toBeVisible({ timeout: 3000 });

    const overviewTab = page.locator('[data-testid="tab-overview"]');
    const resolutionsTab = page.locator('[data-testid="tab-resolutions"]');
    const cofaTab = page.locator('[data-testid="tab-cofa"]');
    const reportsTab = page.locator('[data-testid="tab-reports"]');

    await expect(overviewTab).toBeVisible({ timeout: 3000 });
    await expect(resolutionsTab).toBeVisible({ timeout: 3000 });
    await expect(cofaTab).toBeVisible({ timeout: 3000 });
    await expect(reportsTab).toBeVisible({ timeout: 3000 });

    await expect(page.getByText('Run Ledger')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Human Review Queue')).toBeVisible({ timeout: 3000 });
  });

  test('tab switching renders correct content', async ({ page }) => {
    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await apiResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/engagements/${engagements[0].engagement_id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="tab-resolutions"]').click();
    await expect(page.locator('.text-xs').filter({ hasText: 'navigate' })).toContainText('navigate', { timeout: 5000 });

    await page.locator('[data-testid="tab-cofa"]').click();
    await expect(page.locator('h2').filter({ hasText: 'COFA Merge' })).toContainText('COFA Merge', { timeout: 3000 });

    await page.locator('[data-testid="tab-reports"]').click();
    await expect(page.locator('h2').filter({ hasText: 'Reports' })).toContainText('Reports', { timeout: 3000 });

    await page.locator('[data-testid="tab-overview"]').click();
    await expect(page.locator('h2').filter({ hasText: 'Run Ledger' })).toContainText('Run Ledger', { timeout: 3000 });
  });

  test('back button returns to engagement list', async ({ page }) => {
    const apiResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await apiResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/engagements/${engagements[0].engagement_id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ has: page.locator('svg') }).first().click();
    await expect(page).toHaveURL(/\/engagements$/);
  });
});
