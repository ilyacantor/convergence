// Operator-visible outcome: the PairSelector at /engagements/new shows shape-compliant entity_ids (e.g. InfoSystems-1KKQ), no fixture names, no raw UUIDs; creating an engagement, activating it, and opening the MergePanel renders the amber generic-policy banner that names both chosen entity_ids.
//
// Strict B17: locator.click / fill / selectOption only. No page.request.*,
// no fetch, no SDK calls, no route stubs. Ground truth comes from DOM
// reads within the same Playwright session.

import { test, expect } from '@playwright/test';

// Shape-compliant entity_id regex — single source of truth lives in
// backend/core/entity_id.py. Any id that fails this regex is banned at
// the UI layer (fixture names, UUIDs, snake_case identifiers all fail).
const ENTITY_ID_SHAPE = /^[A-Z][a-zA-Z]+-[A-Z0-9]{2,6}$/;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

test.describe('Freely-selectable entity_id', () => {
  test('pair selector lists only shape-compliant entity_ids, no fixture names, no UUIDs', async ({ page }) => {
    await page.goto('/engagements/new');
    await expect(page.getByText('New Engagement')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Acquirer')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Target')).toBeVisible({ timeout: 5000 });

    // Harvest every entity_id that the operator can see.
    const cardIds: string[] = await page
      .locator('[data-testid^="catalog-entity-"]')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => (n as HTMLElement).getAttribute('data-testid') ?? '')
          .map((id) => id.replace('catalog-entity-', '')),
      );

    // Deduplicate (the same id renders once in acquirer column and once in target).
    const uniqueIds = Array.from(new Set(cardIds));
    expect(uniqueIds.length, 'at least 2 shape-compliant entities').toBeGreaterThanOrEqual(2);

    for (const id of uniqueIds) {
      // The shape regex excludes fixture names (snake_case fails the start-char rule)
      // AND UUIDs (segment lengths don't match). One check covers both banned forms.
      expect(id, `entity_id ${id} must match shape regex`).toMatch(ENTITY_ID_SHAPE);
    }

    // No UUID appears in the visible text rendered by the selector cards.
    // Inspect only the entity-card region, not the full DOM (test-ids,
    // React-router data attributes, and dev-tools hooks may carry UUIDs).
    const cardTexts = await page
      .locator('[data-testid^="catalog-entity-"]')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).innerText));
    for (const text of cardTexts) {
      expect(text, 'UUID found in a PairSelector entity card').not.toMatch(UUID_PATTERN);
    }
  });

  test('creating an engagement + activating + opening MergePanel renders the generic-policy banner naming both entity_ids', async ({ page }) => {
    await page.goto('/engagements/new');
    await expect(page.getByText('Acquirer')).toBeVisible({ timeout: 15000 });

    // Harvest unique shape-compliant ids.
    const cardIds: string[] = await page
      .locator('[data-testid^="catalog-entity-"]')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => (n as HTMLElement).getAttribute('data-testid') ?? '')
          .map((id) => id.replace('catalog-entity-', '')),
      );
    const uniqueIds = Array.from(new Set(cardIds));
    test.skip(uniqueIds.length < 2, 'Catalog has fewer than 2 entities — run scripts/sync_entity_catalog.py');

    const acquirerId = uniqueIds[0];
    const targetId = uniqueIds[1];

    // Real clicks scoped to the named columns. The PairSelector renders two
    // parallel columns; each card appears once per column, so using the
    // occurrence index (0 = Acquirer, 1 = Target) against the data-testid
    // locator gives a stable selector.
    await page
      .locator(`[data-testid="catalog-entity-${acquirerId}"]`)
      .nth(0)
      .click();
    // Target card: the *same* id appears twice (once per column). Click the
    // second occurrence when target == id; when they differ, pick the one
    // inside the Target column via the text-neighbor heuristic.
    const targetCardLocator = page.locator(`[data-testid="catalog-entity-${targetId}"]`);
    const targetCount = await targetCardLocator.count();
    await targetCardLocator.nth(targetCount - 1).click();

    // Click Create Engagement — React state must have caught both selections.
    const createBtn = page.getByRole('button', { name: /create engagement/i });
    await expect(createBtn).toBeEnabled({ timeout: 10000 });
    await createBtn.click();

    // Land on engagement detail page. Capture the fresh engagement_id from the URL.
    await expect(page).toHaveURL(/\/engagements\/[0-9a-f-]{36}/, { timeout: 15000 });
    const url = page.url();
    const newEngagementId = url.split('/').pop() ?? '';
    expect(newEngagementId).toMatch(/^[0-9a-f-]{36}$/);

    // Activate the engagement so it's selectable in MergePanel and wins the
    // get_active_engagement resolver's ORDER BY updated_at DESC tie-break.
    const activateBtn = page.getByRole('button', { name: /^activate$/i });
    if (await activateBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await activateBtn.click();
      await expect(activateBtn).toBeHidden({ timeout: 10000 });
    }

    // Click the Merge nav link.
    await page.getByRole('link', { name: 'Merge', exact: true }).click();

    // MergePanel renders. Select OUR newly-created engagement explicitly
    // from the engagement dropdown — MergePanel defaults to the first active
    // engagement, and many older active engagements exist under this tenant.
    const engDropdown = page.locator('select[title="Select engagement"]');
    await expect(engDropdown).toBeVisible({ timeout: 15000 });
    await engDropdown.selectOption(newEngagementId);

    // Banner appears because entities have no _policy.md — generic fallback active.
    const banner = page.getByTestId('generic-policy-banner');
    await expect(banner).toBeVisible({ timeout: 30000 });
    const bannerText = (await banner.textContent()) ?? '';
    expect(bannerText).toContain(acquirerId);
    expect(bannerText).toContain(targetId);
    expect(bannerText.toLowerCase()).toContain('generic accounting policy');

    await page.screenshot({
      path: 'e2e/screenshots/freely-selectable-merge-banner.png',
      fullPage: true,
    });
  });
});
