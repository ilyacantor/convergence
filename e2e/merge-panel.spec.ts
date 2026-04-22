// Operator-visible outcome: MergePanel renders COFA Merge heading, entity cards with display names from /merge/overview API, FS Impact table with Category/Dollar Impact/EBITDA headers and a Combined row, Conflict Resolution button with N total / N pending counts, conflict table with Type/Description/Annual Impact headers, engagement dropdown populated from API, and per-bucket FS impact cells with non-zero dollar values for recognition/capitalization/policy buckets
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
    const acquirerLabel = page.locator('text=Acquirer').first();
    await expect(acquirerLabel).toBeVisible({ timeout: 15_000 });

    const targetLabel = page.locator('text=Target').first();
    await expect(targetLabel).toBeVisible({ timeout: 5000 });

    const overviewResp = await page.request.get('/api/convergence/merge/overview');
    const overview = await overviewResp.json();
    const acqName = overview.acquirer?.display_name;
    const tgtName = overview.target?.display_name;
    expect(typeof acqName, 'acquirer display_name missing from overview API').toBe('string');
    expect(typeof tgtName, 'target display_name missing from overview API').toBe('string');
    // entity_id may appear multiple times (card header, generic-policy banner,
    // entity badges). .first() is sufficient to prove the name is rendered.
    await expect(page.getByText(acqName, { exact: true }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(tgtName, { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('shows triple counts for both entities', async ({ page }) => {
    await expect(page.locator('text=Acquirer').first()).toBeVisible({ timeout: 15_000 });

    const triplesLabels = page.locator('text=triples');
    await expect(triplesLabels.first()).toBeVisible({ timeout: 5000 });
    const count = await triplesLabels.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('shows Financial Statement Impact table', async ({ page }) => {
    const impactHeading = page.locator('text=Financial Statement Impact');
    await expect(impactHeading).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('th', { hasText: 'Category' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('th', { hasText: 'Dollar Impact' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('th', { hasText: 'EBITDA' }).first()).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByRole('cell', { name: 'Combined', exact: true })
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows Conflict Resolution section with conflicts', async ({ page }) => {
    const conflictBtn = page.getByRole('button', { name: /Conflict Resolution/ });
    await expect(conflictBtn).toBeVisible({ timeout: 15_000 });

    await expect(conflictBtn).toContainText(/\d+ total/);
    await expect(conflictBtn).toContainText(/\d+ pending/);

    await expect(page.locator('th', { hasText: 'Type' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('th', { hasText: 'Description' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('th', { hasText: 'Annual Impact' })).toBeVisible({ timeout: 5000 });
  });

  test('engagements load from Platform via HTTP contract', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'COFA Merge' })).toBeVisible({ timeout: 15_000 });

    await page.waitForResponse(resp =>
      resp.url().includes('/api/convergence/engagements') && resp.ok(),
      { timeout: 15_000 }
    );

    await expect(page.locator('text=No engagements')).not.toBeVisible({ timeout: 5000 });

    const dropdown = page.locator('select').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
  });

  test('no "not found" or error state visible', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'COFA Merge' })).toBeVisible({ timeout: 15_000 });

    const loadingText = page.locator('text=Loading merge overview...');
    await expect(loadingText).not.toBeVisible({ timeout: 10_000 });

    const retryButton = page.locator('button', { hasText: 'Retry' });
    await expect(retryButton).not.toBeVisible({ timeout: 5000 });
  });

  test('merge overview API returns real data (not 404)', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/convergence/merge/overview') && resp.ok()
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
        resp.url().includes('/api/convergence/merge/conflicts') && resp.ok()
      ),
      page.goto('/'),
    ]);

    const body = await response.json();
    expect(body.conflicts).toBeDefined();
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.summary).toBeDefined();
    expect(body.summary.total).toBeGreaterThan(0);
  });

  test('Financial Statement Impact renders non-zero numbers across buckets', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'COFA Merge' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Financial Statement Impact')).toBeVisible({ timeout: 20_000 });

    const expectedBuckets = ['recognition', 'capitalization', 'policy'];
    const parseMoney = (raw: string): number => {
      const t = raw.trim();
      if (!t || t === '\u2014') return NaN;
      const m = t.match(/-?\$?([\d.]+)\s*([KMB]?)/i);
      if (!m) return NaN;
      const n = parseFloat(m[1]);
      const unit = (m[2] || '').toUpperCase();
      const mult = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
      const sign = t.trim().startsWith('-') ? -1 : 1;
      return sign * n * mult;
    };

    const impactsByBucket: Record<string, { revenue: number; expense: number; ebitda: number }> = {};
    for (const type of expectedBuckets) {
      const revCell = page.locator(`[data-testid="fs-impact-${type}-revenue"]`);
      const expCell = page.locator(`[data-testid="fs-impact-${type}-expense"]`);
      const ebCell = page.locator(`[data-testid="fs-impact-${type}-ebitda"]`);
      await expect(revCell, `revenue cell missing for bucket ${type}`).toBeVisible({ timeout: 5000 });
      await expect(expCell, `expense cell missing for bucket ${type}`).toBeVisible({ timeout: 5000 });
      await expect(ebCell, `ebitda cell missing for bucket ${type}`).toBeVisible({ timeout: 5000 });

      const revText = (await revCell.textContent() ?? '').trim();
      const expText = (await expCell.textContent() ?? '').trim();
      const ebText = (await ebCell.textContent() ?? '').trim();

      const cells = [
        { label: 'revenue', text: revText },
        { label: 'expense', text: expText },
        { label: 'ebitda', text: ebText },
      ];
      const numeric = cells
        .filter(c => c.text !== '\u2014')
        .map(c => ({ ...c, value: parseMoney(c.text) }));
      expect(numeric.length, `bucket ${type}: every FS line rendered em-dash (no real data)`).toBeGreaterThan(0);
      for (const { label, text, value } of numeric) {
        expect(Number.isFinite(value), `bucket ${type} ${label} not numeric: "${text}"`).toBe(true);
      }

      const rev = revText === '\u2014' ? 0 : parseMoney(revText);
      const exp = expText === '\u2014' ? 0 : parseMoney(expText);
      const eb = ebText === '\u2014' ? 0 : parseMoney(ebText);
      impactsByBucket[type] = { revenue: rev, expense: exp, ebitda: eb };
    }

    const anyNonZero = Object.values(impactsByBucket).some(
      v => v.revenue !== 0 || v.expense !== 0 || v.ebitda !== 0,
    );
    expect(anyNonZero, `all FS impact values zero across ${JSON.stringify(impactsByBucket)}`).toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/merge-panel-fs-impact.png', fullPage: true });
  });
});
