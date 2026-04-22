// Operator-visible outcome: the PairSelector at /engagements/new shows at least two shape-compliant entity_ids in the Acquirer and Target columns (e.g. InfoSystems-1KKQ, NovaDynamics-JYS7), zero fixture names, zero raw UUIDs; selecting a pair and opening the merge page renders the amber generic-policy banner naming both chosen entity_ids.
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
    // data-testid="catalog-entity-<id>" is the existing convention.
    const cardIds = await page
      .locator('[data-testid^="catalog-entity-"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLElement).getAttribute('data-testid')?.replace('catalog-entity-', '') || '')
      );

    expect(cardIds.length).toBeGreaterThanOrEqual(2);

    for (const id of cardIds) {
      // The shape regex excludes fixture names (snake_case, wrong start char)
      // AND UUIDs (segment lengths don't match) AND arbitrary display text.
      expect(id, `entity_id ${id} must match shape regex`).toMatch(ENTITY_ID_SHAPE);
    }

    // Check no UUIDs appear in the Acquirer/Target column bodies.
    const selectorBody = await page.locator('main, [role="main"]').first().textContent();
    expect(selectorBody, 'UUID found in PairSelector primary text').not.toMatch(UUID_PATTERN);
  });

  test('selecting a pair + opening the merge page renders the generic-policy banner naming both entity_ids', async ({ page }) => {
    await page.goto('/engagements/new');
    await expect(page.getByText('Acquirer')).toBeVisible({ timeout: 15000 });

    // Pick the first two shape-compliant entity cards via real clicks.
    const cards = page.locator('[data-testid^="catalog-entity-"]');
    const count = await cards.count();
    test.skip(count < 2, 'Catalog has fewer than 2 entities — run scripts/sync_entity_catalog.py');

    const firstId = await cards.nth(0).getAttribute('data-testid');
    const secondId = await cards.nth(1).getAttribute('data-testid');
    const acquirerId = firstId?.replace('catalog-entity-', '') ?? '';
    const targetId = secondId?.replace('catalog-entity-', '') ?? '';

    // Acquirer column pick.
    await page.locator('[data-testid^="catalog-entity-"]').nth(0).click();
    // Target column pick — UI renders the same cards twice (left + right).
    // The second panel's matching card is the one disabled on the left.
    const targetCard = page
      .locator('[data-testid^="catalog-entity-"]')
      .nth(count + 1); // target panel starts at offset count
    if (await targetCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await targetCard.click();
    } else {
      // Fallback: the second occurrence of the same data-testid.
      await page.locator(`[data-testid="catalog-entity-${targetId}"]`).nth(1).click();
    }

    // Click Create Engagement.
    const createBtn = page.getByRole('button', { name: /create engagement/i });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // We should land on the engagement detail page. Navigate to the merge panel.
    await expect(page).toHaveURL(/\/engagements\/[0-9a-f-]{36}/, { timeout: 15000 });
    await page.goto('/merge');

    // Banner appears because entities have no _policy.md — generic fallback active.
    const banner = page.getByTestId('generic-policy-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });
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
