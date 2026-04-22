// Operator-visible outcome: /engagements/new renders catalog entities from API, operator selects acquirer and target by entity_id (real names from catalog), clicks Create Engagement navigating to detail page showing both entity_ids, clicks Resolutions tab then Run Resolver — green banner shows domains resolved with auto_accepted/pending_hitl/no_match counts, domain groups with resolution rows appear, COFA and Reports tabs each render their section headings
import { test, expect } from '@playwright/test';

test.describe('Engagement merge flow', () => {
  test('create engagement, run resolver, verify all tabs', async ({ page }) => {
    test.setTimeout(60_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Ground truth: fetch catalog. The engagement-store sanctioned set now
    // accepts any shape-compliant entity_id with active triples in
    // convergence_triples — no Farm triple-configs intersection needed.
    const catalogResp = await page.request.get('/api/convergence/catalog');
    const catalog = await catalogResp.json();

    const entities: { entity_id: string; display_name: string; tenant_id: string }[] =
      catalog.passing_entities || [];
    expect(entities.length).toBeGreaterThanOrEqual(2);

    const acquirer = entities[0];
    const target = entities[1];

    // --- Step 1: Pair selector ---
    await page.goto('/engagements/new');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('New Engagement')).toContainText('New Engagement', { timeout: 5000 });
    const acqCard = page.locator(`[data-testid="catalog-entity-${acquirer.entity_id}"]`).first();
    await expect(acqCard).toContainText(acquirer.display_name, { timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-01-pair-selector.png' });

    // Select acquirer (first column, first entity)
    await acqCard.click();
    await expect(acqCard).toContainText('Acquirer', { timeout: 3000 });

    // Select target (second column, second entity)
    const tgtCard = page.locator(`[data-testid="catalog-entity-${target.entity_id}"]`).nth(1);
    await tgtCard.click();
    await expect(tgtCard).toContainText('Target', { timeout: 3000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-02-pair-selected.png' });

    // --- Step 2: Create engagement ---
    const createBtn = page.getByRole('button', { name: /Create Engagement/i });
    await expect(createBtn).toBeEnabled({ timeout: 3000 });
    await createBtn.click();

    await page.waitForURL(/\/engagements\/[a-f0-9-]+$/, { timeout: 20_000 });

    // Wait for engagement detail to render past Suspense loading
    await expect(page.getByText(`${acquirer.entity_id} + ${target.entity_id}`)).toContainText(acquirer.entity_id, { timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-03-engagement-created.png' });

    // --- Step 3: Resolutions tab ---
    await page.locator('[data-testid="tab-resolutions"]').click();
    await page.waitForLoadState('networkidle');

    // Run Resolver button should be visible (empty state or toolbar)
    const resolverBtn = page.locator('[data-testid="run-resolver-empty-btn"], [data-testid="run-resolver-btn"]').first();
    await expect(resolverBtn).toContainText('Run Resolver', { timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-04-resolutions-empty.png' });

    // --- Step 4: Run resolver ---
    await resolverBtn.click();

    // Wait for resolver completion banner
    const resultBanner = page.locator('[data-testid="resolve-result"]');
    await expect(resultBanner).toContainText('domain', { timeout: 30_000 });

    // Wait for data refresh to complete (Run Resolver button text restored)
    await expect(page.locator('[data-testid="run-resolver-btn"]')).toContainText('Run Resolver', { timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-05-resolver-complete.png' });

    // Verify domain groups appeared — at least one domain header with domain name and stats
    const firstDomainHeader = page.locator('[data-testid^="domain-header-"]').first();
    await expect(firstDomainHeader).toContainText('mapping', { timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-06-resolutions.png' });

    // --- Step 5: COFA tab ---
    await page.locator('[data-testid="tab-cofa"]').click();
    await expect(page.locator('h2').filter({ hasText: 'COFA Merge' })).toContainText('COFA Merge', { timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-07-cofa-tab.png' });

    // --- Step 6: Reports tab ---
    await page.locator('[data-testid="tab-reports"]').click();
    await expect(page.locator('h2').filter({ hasText: 'Reports' })).toContainText('Reports', { timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/merge-08-reports-tab.png' });

    expect(consoleErrors).toEqual([]);
  });
});
