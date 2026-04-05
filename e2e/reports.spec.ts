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

  test('X-Sell tab renders cross-sell pipeline with summary cards', async ({ page }) => {
    await page.getByRole('button', { name: 'X-Sell' }).click();
    await expect(page.locator('text=/Loading cross-sell/i')).not.toBeVisible({ timeout: 30_000 });

    // Summary cards — Pipeline and High Confidence
    await expect(page.locator('text=/Pipeline/').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/High Confidence/').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/candidates/i').first()).toBeVisible({ timeout: 5_000 });

    // Direction toggle buttons (use getByRole with specific text to avoid strict mode)
    await expect(page.getByRole('button', { name: /Meridian Advisory/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Cascadia BPM/ })).toBeVisible({ timeout: 5_000 });

    await waitForDataAndNoErrors(page);
  });

  test('Upsell tab renders upsell opportunities with summary cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Upsell' }).click();
    await expect(page.locator('text=/Loading upsell/i')).not.toBeVisible({ timeout: 30_000 });

    // Summary cards
    await expect(page.locator('text=/Shared Customers/').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/Opportunities/').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=/Expansion ACV/').first()).toBeVisible({ timeout: 5_000 });

    // Direction toggle buttons
    await expect(page.getByRole('button', { name: /Meridian Services/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Cascadia Services/ })).toBeVisible({ timeout: 5_000 });

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
    // Start on P&L with Combined (default)
    await page.getByRole('button', { name: 'P&L' }).click();
    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 15_000 });

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
    await expect(page.getByRole('button', { name: 'X-Sell' })).not.toBeVisible({ timeout: 2_000 });

    // Switch back to Combined
    await page.getByRole('button', { name: 'Combined' }).click();
    await waitForDataAndNoErrors(page);

    // Combined-only tabs should appear
    await expect(page.getByRole('button', { name: 'Combining' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'X-Sell' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'QofE' })).toBeVisible({ timeout: 5_000 });
  });

  test('no error banners on initial load', async ({ page }) => {
    await page.waitForTimeout(3_000);
    await expect(page.locator('text=/Error loading/i')).not.toBeVisible();
    await expect(page.locator('text=/failed/i')).not.toBeVisible();
  });
});
