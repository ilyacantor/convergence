// Operator-visible outcome: the Resolutions tab on /engagements/{id} renders resolver decisions grouped by domain, each group showing a domain header with pending count badge, and each decision row displaying acquirer record, target record, confidence percentage bar, tier number, HITL state badge, and Accept/Reject/Defer action buttons for pending decisions
import { test, expect } from '@playwright/test';

const TENANT_ID = process.env.VITE_AOS_TENANT_ID || '69688df3-fc8e-51f8-a77c-9c13f9b3a784';

test.describe('Resolutions tab — HITL surface', () => {
  test('renders domain groups with decision data from API', async ({ page }) => {
    const engResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await engResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    const eng = engagements.find((e: any) => e.lifecycle_stage === 'active') || engagements[0];
    const resResp = await page.request.get(
      `/api/convergence/engagements/${eng.engagement_id}/resolutions`,
    );
    const resolutions = await resResp.json();

    await page.goto(`/engagements/${eng.engagement_id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="tab-resolutions"]').click();
    await page.waitForTimeout(1000);

    const domains = resolutions.domains || [];
    if (domains.length === 0) {
      await expect(page.getByText('No resolver decisions found')).toBeVisible({ timeout: 5000 });
    } else {
      for (const domainGroup of domains) {
        const header = page.locator(`[data-testid="domain-header-${domainGroup.domain}"]`);
        await expect(header).toBeVisible({ timeout: 5000 });
        const headerText = await header.textContent();
        expect(headerText?.toLowerCase()).toContain(domainGroup.domain);

        if (domainGroup.mappings.length !== 0) {
          const firstDecision = domainGroup.mappings[0];
          const row = page.locator(`[data-testid="resolution-row-${firstDecision.id}"]`);
          await expect(row).toBeVisible({ timeout: 3000 });

          const rowText = await row.textContent();
          const expectedPct = `${Math.round(firstDecision.confidence * 100)}%`;
          expect(rowText).toContain(expectedPct);
          expect(rowText).toContain(`T${firstDecision.tier_matched}`);
        }
      }
    }
  });

  test('summary bar counts match API summary', async ({ page }) => {
    const engResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await engResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    const eng = engagements.find((e: any) => e.lifecycle_stage === 'active') || engagements[0];
    const sumResp = await page.request.get(
      `/api/convergence/engagements/${eng.engagement_id}/resolutions/summary`,
    );
    const summary = await sumResp.json();

    await page.goto(`/engagements/${eng.engagement_id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="tab-resolutions"]').click();
    await page.waitForTimeout(1000);

    const pendingCount = summary.totals?.pending_hitl || 0;
    const pendingBtn = page.getByRole('button', { name: /pending/i }).first();
    if (pendingCount > 0) {
      const btnText = await pendingBtn.textContent();
      expect(btnText).toContain(String(pendingCount));
    }
  });

  test('keyboard hint renders', async ({ page }) => {
    const engResp = await page.request.get(
      `/api/convergence/engagements?tenant_id=${TENANT_ID}`,
    );
    const engagements = await engResp.json();
    if (engagements.length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/engagements/${engagements[0].engagement_id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="tab-resolutions"]').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('navigate', { exact: false })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('accept', { exact: false })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('reject', { exact: false })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('defer', { exact: false })).toBeVisible({ timeout: 3000 });
  });
});
