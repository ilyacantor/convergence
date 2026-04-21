// Operator-visible outcome: /reports page renders P&L, BS, CF, Combining, Overlap, X-Sell, Upsell, Pipeline, What-If, QofE tabs with financial data from the active engagement, entity toggle buttons using real entity names from API, and zero error banners
import { test, expect } from '@playwright/test';

/**
 * Wait for the report portal to be fully ready — dimensions loaded,
 * no "Loading..." spinners visible.
 */
async function waitForPortalReady(page: import('@playwright/test').Page) {
  // Wait for tab bar to appear
  await expect(page.getByRole('button', { name: 'P&L' })).toBeVisible({ timeout: 30_000 });
  // Wait for dimension loading to finish
  await expect(page.locator('text=/Loading available periods/i')).not.toBeVisible({ timeout: 30_000 });
}

/** Wait for any loading spinner to clear and assert no error banners. */
async function waitForDataAndNoErrors(page: import('@playwright/test').Page) {
  await expect(page.locator('text=/Loading/i')).not.toBeVisible({ timeout: 30_000 });
  await expect(page.locator('text=/Error loading/i')).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('text=/query failed/i')).not.toBeVisible({ timeout: 2_000 });
}

async function getEntityNames(page: import('@playwright/test').Page): Promise<{ a: string; b: string }> {
  const resp = await page.request.get('/api/convergence/engagement/active');
  const eng = await resp.json();
  return {
    a: eng.entity_pair?.[0] || eng.entity_a?.id || 'acquirer',
    b: eng.entity_pair?.[1] || eng.entity_b?.id || 'target',
  };
}

// ─── Combined entity tabs ─────────────────────────────────────────────────────

test.describe('Reports Portal — Combined Entity Tabs (B17 Gate)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
    await waitForPortalReady(page);
    // Entity defaults to "combined" — verify Combined button is active
    await expect(page.getByRole('button', { name: 'Combined' })).toBeVisible({ timeout: 10_000 });
  });

  test('P&L tab renders income statement with financial data', async ({ page }) => {
    await page.getByRole('button', { name: 'P&L' }).click();
    await expect(page.locator('text=/Loading Income/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=EBITDA').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Total Revenue').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Net Income').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('BS tab renders balance sheet with assets, liabilities, equity', async ({ page }) => {
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.locator('text=/Loading Balance/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Assets').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Liabilities').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Equity').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Balance Sheet')).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('CF tab renders cash flow with operating, investing, financing', async ({ page }) => {
    await page.getByRole('button', { name: 'CF' }).click();
    await expect(page.locator('text=/Loading Cash/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Operating Activities').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Investing Activities').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Financing Activities').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Net Change in Cash').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Combining tab renders four-column table', async ({ page }) => {
    await page.getByRole('button', { name: 'Combining' }).click();
    await expect(page.locator('text=/Loading Combining/i')).not.toBeVisible({ timeout: 30_000 });

    // Four-column headers
    const combiningHeader = page.locator('th', { hasText: /Adjustments|Combined/ }).first();
    await expect(combiningHeader).toBeVisible({ timeout: 10_000 });

    // Financial line items
    await expect(page.locator('text=/Revenue|EBITDA/i').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Overlap tab renders entity overlap cards and breakdown table', async ({ page }) => {
    const names = await getEntityNames(page);
    await page.getByRole('button', { name: 'Overlap' }).click();
    await expect(page.locator('text=/Loading entity overlap/i')).not.toBeVisible({ timeout: 30_000 });

    // Three domain cards: Vendors, Employees, IT Assets (Customers lives in Cross-Sell/Upsell)
    await expect(page.locator('text=Vendors').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=IT Assets').first()).toBeVisible({ timeout: 5_000 });

    // Breakdown table with entity-name columns
    await expect(page.locator('text=Overlap Breakdown')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('th', { hasText: new RegExp(`${names.a}.*Total`, 'i') })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('th', { hasText: new RegExp(`${names.b}.*Total`, 'i') })).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Overlap tab drill-through — click IT Assets card and entity-only lines', async ({ page }) => {
    const names = await getEntityNames(page);
    await page.getByRole('button', { name: 'Overlap' }).click();
    await expect(page.locator('text=/Loading entity overlap/i')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=Overlap Breakdown')).toBeVisible({ timeout: 10_000 });

    // Click IT Assets KPI card → overlap drill appears with at least one concept row
    await page.getByRole('button', { name: /Drill into IT Assets overlap/i }).click();
    const overlapDrill = page.locator('[data-testid="overlap-drill-it_asset-overlap"]');
    await expect(overlapDrill).toBeVisible({ timeout: 15_000 });
    await expect(overlapDrill.locator('text=/Shared IT Assets — detail/i')).toBeVisible({ timeout: 5_000 });
    await expect(overlapDrill.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 });

    // Click entity-A-only line on the IT Assets card → entity-only drill replaces overlap drill
    await overlapDrill.isVisible();
    const itAssetsCard = page.getByRole('button', { name: /Drill into IT Assets overlap/i }).locator('..');
    const aOnlyPattern = new RegExp(`${names.a}-only:`, 'i');
    await itAssetsCard.getByRole('button', { name: aOnlyPattern }).click();
    const aOnlyDrill = page.locator('[data-testid="overlap-drill-it_asset-a_only"]');
    await expect(aOnlyDrill).toBeVisible({ timeout: 15_000 });
    await expect(aOnlyDrill.locator(`text=/${names.a}-only IT Assets/i`)).toBeVisible({ timeout: 5_000 });
    await expect(aOnlyDrill.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 });

    // Close via the Close button → drill disappears
    await aOnlyDrill.getByRole('button', { name: 'Close' }).click();
    await expect(aOnlyDrill).not.toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('X-Sell tab renders cross-sell pipeline with summary cards', async ({ page }) => {
    await page.getByRole('button', { name: 'X-Sell' }).click();
    await expect(page.locator('text=/Loading cross-sell/i')).not.toBeVisible({ timeout: 30_000 });

    // Summary cards — Pipeline and High Confidence
    await expect(page.locator('text=/Pipeline/').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/High Confidence/').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/candidates/i').first()).toBeVisible({ timeout: 5_000 });

    // Direction toggle buttons — entity names from active engagement
    const xsNames = await getEntityNames(page);
    await expect(page.getByRole('button', { name: new RegExp(xsNames.a, 'i') }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: new RegExp(xsNames.b, 'i') }).first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('X-Sell scores form a distribution, not clustered at one value', async ({ page }) => {
    // Regression guard: before Console's convergence_overlay stage pushed
    // customer.* triples, every opportunity scored ~31/100 because the
    // propensity engine saw empty inputs and fell through to silent defaults.
    // After the fix, scores must span a real range.
    // Hit the API directly (the table view only paginates 50 rows at a time,
    // which is too thin a slice to prove distribution).
    const resp = await page.request.get(
      '/api/convergence/reports/v2/cross-sell?tenant_id=69688df3-fc8e-51f8-a77c-9c13f9b3a784',
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const opps = body.opportunities ?? [];
    expect(opps.length).toBeGreaterThan(100);

    const scores = opps.map((o: { propensity_score: number }) => o.propensity_score);
    const unique = new Set(scores);
    // More than one score bucket means the engine is actually scoring
    expect(unique.size).toBeGreaterThan(10);

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    // Spread must be wider than the 1-point wobble a broken engine would show
    expect(max - min).toBeGreaterThan(20);

    // Verify we render the tab too — this is still a B17 gate
    await page.getByRole('button', { name: 'X-Sell' }).click();
    await expect(page.locator('text=/Loading cross-sell/i')).not.toBeVisible({ timeout: 30_000 });
    await waitForDataAndNoErrors(page);
  });

  test('Upsell tab renders upsell opportunities with summary cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Upsell' }).click();
    await expect(page.locator('text=/Loading upsell/i')).not.toBeVisible({ timeout: 30_000 });

    // Summary cards
    await expect(page.locator('text=/Shared Customers/').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/Opportunities/').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/Expansion ACV/').first()).toBeVisible({ timeout: 5_000 });

    // Direction toggle buttons — entity names from active engagement
    const upNames = await getEntityNames(page);
    await expect(page.getByRole('button', { name: new RegExp(upNames.a, 'i') }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: new RegExp(upNames.b, 'i') }).first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Pipeline tab renders pipeline funnel data', async ({ page }) => {
    await page.getByRole('button', { name: 'Pipeline' }).click();
    await expect(page.locator('text=/Loading pipeline/i')).not.toBeVisible({ timeout: 30_000 });

    // Pipeline panels show entity names and period year
    await expect(page.locator('div >> text="2025"').first()).toBeVisible({ timeout: 10_000 });

    await waitForDataAndNoErrors(page);
  });

  test('What-If tab renders sensitivity levers and presets', async ({ page }) => {
    await page.getByRole('button', { name: 'What-If' }).click();
    await expect(page.locator('text=/Loading what-if/i')).not.toBeVisible({ timeout: 30_000 });

    // Sensitivity levers panel
    await expect(page.locator('text=/Sensitivity Levers/i')).toBeVisible({ timeout: 10_000 });

    // At least one range slider should be present
    await expect(page.locator('input[type="range"]').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('QofE tab renders quality of earnings with score and sub-tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'QofE' }).click();
    await expect(page.locator('text=/Loading Quality/i')).not.toBeVisible({ timeout: 30_000 });

    // Top KPIs
    await expect(page.locator('text=/Sustainability Score/i')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/Adjusted EBITDA/i')).toBeVisible({ timeout: 5_000 });

    // Sub-tabs
    await expect(page.locator('button', { hasText: /EBITDA Bridge/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button', { hasText: /Sustainability/ })).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });
});

// ─── Single entity tabs ───────────────────────────────────────────────────────

test.describe('Reports Portal — Single Entity Tabs (B17 Gate)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
    await waitForPortalReady(page);
    // Switch to Acquiror (single entity)
    await page.getByRole('button', { name: 'Acquiror' }).click();
  });

  test('P&L tab renders single-entity income statement', async ({ page }) => {
    await page.getByRole('button', { name: 'P&L' }).click();
    await expect(page.locator('text=/Loading Income/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=EBITDA').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Income Statement')).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('BS tab renders single-entity balance sheet', async ({ page }) => {
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.locator('text=/Loading Balance/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Assets').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Liabilities').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Equity').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('CF tab renders single-entity cash flow', async ({ page }) => {
    await page.getByRole('button', { name: 'CF' }).click();
    await expect(page.locator('text=/Loading Cash/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Operating Activities').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Net Change in Cash').first()).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Rev/Cust tab renders revenue by customer data', async ({ page }) => {
    await page.getByRole('button', { name: 'Rev/Cust' }).click();
    await expect(page.locator('text=/Loading/i')).not.toBeVisible({ timeout: 30_000 });

    // Revenue by customer table should render with customer data
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Pipeline tab renders single-entity pipeline', async ({ page }) => {
    await page.getByRole('button', { name: 'Pipeline' }).click();
    await expect(page.locator('text=/Loading pipeline/i')).not.toBeVisible({ timeout: 30_000 });

    // Pipeline panels show period year
    await expect(page.locator('div >> text="2025"').first()).toBeVisible({ timeout: 10_000 });

    await waitForDataAndNoErrors(page);
  });
});

// ─── Entity switching ─────────────────────────────────────────────────────────

test.describe('Reports Portal — Entity Switching (B17 Gate)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
    await waitForPortalReady(page);
  });

  test('switching from Combined to Target reloads P&L data', async ({ page }) => {
    // Start on P&L with Combined (default) — use the same wait pattern as the
    // Combined Entity Tabs describe block: wait for Loading Income to clear.
    await page.getByRole('button', { name: 'P&L' }).click();
    await expect(page.locator('text=/Loading Income/i')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 10_000 });

    // Switch to Target
    await page.getByRole('button', { name: 'Target' }).click();
    await expect(page.locator('text=/Loading/i')).not.toBeVisible({ timeout: 30_000 });

    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Income Statement')).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('switching from Acquiror to Combined shows combined-only tabs', async ({ page }) => {
    // Switch to Acquiror first
    await page.getByRole('button', { name: 'Acquiror' }).click();
    await waitForDataAndNoErrors(page);

    // Verify combined-only tabs are NOT visible
    await expect(page.getByRole('button', { name: 'Combining' })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'Overlap' })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'X-Sell' })).not.toBeVisible({ timeout: 2_000 });

    // Switch back to Combined
    await page.getByRole('button', { name: 'Combined' }).click();
    await waitForDataAndNoErrors(page);

    // Combined-only tabs should appear
    await expect(page.getByRole('button', { name: 'Combining' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Overlap' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'X-Sell' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'QofE' })).toBeVisible({ timeout: 5_000 });
  });

  test('no error banners on initial load', async ({ page }) => {
    await page.waitForTimeout(3_000);
    await expect(page.locator('text=/Error loading/i')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/failed/i')).not.toBeVisible({ timeout: 5_000 });
  });
});
