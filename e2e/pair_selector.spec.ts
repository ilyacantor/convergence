// Operator-visible outcome: /engagements/new page renders a two-column tenant selector populated from the AOS catalog API, with Acquirer and Target headers and a disabled Create Engagement button until both sides are selected
import { test, expect } from '@playwright/test';

test.describe('Pair selector page', () => {
  test('loads catalog and renders tenant cards', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const catalogResp = await page.request.get('/api/convergence/catalog');
    const catalog = await catalogResp.json();

    await page.goto('/engagements/new');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('New Engagement')).toBeVisible({ timeout: 5000 });

    const passingTenants = catalog.passing_tenants || [];
    if (passingTenants.length === 0) {
      await expect(page.getByText('No AOS tenants pass the contract check')).toBeVisible({ timeout: 3000 });
    } else {
      await expect(page.getByText('Acquirer')).toBeVisible({ timeout: 3000 });
      await expect(page.getByText('Target')).toBeVisible({ timeout: 3000 });

      for (const tenant of passingTenants) {
        const card = page.locator(`[data-testid="catalog-tenant-${tenant.tenant_id}"]`).first();
        await expect(card).toBeVisible({ timeout: 3000 });
        const cardText = await card.textContent();
        expect(cardText).toContain(tenant.display_name);
      }

      const createBtn = page.getByRole('button', { name: /Create Engagement/i });
      await expect(createBtn).toBeDisabled();
    }

    expect(consoleErrors).toEqual([]);
  });

  test('back button navigates to engagement list', async ({ page }) => {
    await page.goto('/engagements/new');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ has: page.locator('svg') }).first().click();
    await expect(page).toHaveURL(/\/engagements$/);
  });
});
