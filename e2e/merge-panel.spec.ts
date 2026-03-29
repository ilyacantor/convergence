import { test, expect } from '@playwright/test';

test.describe('MergePanel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads and shows COFA Merge heading', async ({ page }) => {
    const heading = page.locator('h2', { hasText: 'COFA Merge' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('shows entity cards for Acquirer and Target', async ({ page }) => {
    // Wait for data to load — entity labels appear after fetch completes
    const acquirerLabel = page.locator('text=Acquirer').first();
    await expect(acquirerLabel).toBeVisible({ timeout: 15_000 });

    const targetLabel = page.locator('text=Target').first();
    await expect(targetLabel).toBeVisible();

    // Entity display names from the merge overview
    await expect(page.locator('text=Meridian')).toBeVisible();
    await expect(page.locator('text=Cascadia')).toBeVisible();
  });

  test('shows triple counts for both entities', async ({ page }) => {
    // Wait for merge overview data
    await expect(page.locator('text=Acquirer').first()).toBeVisible({ timeout: 15_000 });

    // Both entities should show triple counts (non-zero)
    const triplesLabels = page.locator('text=triples');
    await expect(triplesLabels.first()).toBeVisible();
    const count = await triplesLabels.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('shows Financial Statement Impact table', async ({ page }) => {
    const impactHeading = page.locator('text=Financial Statement Impact');
    await expect(impactHeading).toBeVisible({ timeout: 15_000 });

    // Table headers
    await expect(page.locator('th', { hasText: 'Category' })).toBeVisible();
    await expect(page.locator('th', { hasText: 'Dollar Impact' }).first()).toBeVisible();
    await expect(page.locator('th', { hasText: 'EBITDA' }).first()).toBeVisible();

    // Combined row at the bottom of the impact table
    await expect(page.locator('td', { hasText: 'Combined' })).toBeVisible();
  });

  test('shows Conflict Resolution section with conflicts', async ({ page }) => {
    const conflictSection = page.locator('text=Conflict Resolution').first();
    await expect(conflictSection).toBeVisible({ timeout: 15_000 });

    // Should show total/resolved/pending counts
    await expect(page.locator('text=/\\d+ total/')).toBeVisible();
    await expect(page.locator('text=/\\d+ pending/')).toBeVisible();

    // Conflict table headers
    await expect(page.locator('th', { hasText: 'Type' }).first()).toBeVisible();
    await expect(page.locator('th', { hasText: 'Description' }).first()).toBeVisible();
    await expect(page.locator('th', { hasText: 'Annual Impact' })).toBeVisible();
  });

  test('engagement error shows Platform auth requirement', async ({ page }) => {
    // Platform requires authentication — MergePanel should surface this clearly
    await expect(page.locator('h2', { hasText: 'COFA Merge' })).toBeVisible({ timeout: 15_000 });

    // Should show "No engagements" with a clear error about Platform auth
    await expect(page.locator('text=No engagements')).toBeVisible({ timeout: 10_000 });
  });

  test('no "not found" or error state visible', async ({ page }) => {
    // Wait for the page to finish loading
    await expect(page.locator('h2', { hasText: 'COFA Merge' })).toBeVisible({ timeout: 15_000 });

    // Should not show loading spinner after data loads
    const loadingText = page.locator('text=Loading merge overview...');
    await expect(loadingText).not.toBeVisible({ timeout: 10_000 });

    // No error messages should be visible
    const retryButton = page.locator('button', { hasText: 'Retry' });
    await expect(retryButton).not.toBeVisible();
  });

  test('merge overview API returns real data (not 404)', async ({ page }) => {
    // Intercept the API call and verify it returns 200
    const [response] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/convergence/merge/overview') && resp.status() === 200
      ),
      page.goto('/'),
    ]);

    const body = await response.json();
    expect(body.acquirer).toBeDefined();
    expect(body.target).toBeDefined();
    expect(body.overview).toBeDefined();
    expect(body.overview.entities.length).toBeGreaterThanOrEqual(2);
  });

  test('conflicts API returns real data', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/convergence/merge/conflicts') && resp.status() === 200
      ),
      page.goto('/'),
    ]);

    const body = await response.json();
    expect(body.conflicts).toBeDefined();
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.summary).toBeDefined();
    expect(body.summary.total).toBeGreaterThan(0);
  });
});
