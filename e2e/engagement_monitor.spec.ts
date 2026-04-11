/**
 * Engagement Monitor tab — verify it loads without errors and
 * has zero references to constitution, tools, or Maestra.
 */
import { test, expect } from '@playwright/test'

test.describe('Engagement Monitor — clean of Maestra concepts', () => {
  test('loads with engagement data, no errors, no Maestra references', async ({ page }) => {
    // Collect console errors
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // Collect failed network requests
    const failedRequests: string[] = []
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`)
      }
    })

    await page.goto('/engagements')
    await page.waitForTimeout(3000)

    // Header must say "Engagement Monitor"
    await expect(page.getByText('Engagement Monitor')).toBeVisible()

    // Must NOT contain Maestra, Constitution, or Tools panel text
    const pageText = await page.textContent('body') ?? ''
    expect(pageText).not.toContain('Maestra')
    expect(pageText).not.toContain('Constitution')
    expect(pageText).not.toContain('Available Tools')
    expect(pageText).not.toContain('check_module_status')
    expect(pageText).not.toContain('trigger_pipeline_run')

    // Must show engagement data (not "No active engagement" with no engagement)
    // The engagement_id or entity names should be visible
    const hasEngagement = pageText.includes('3c299509') || pageText.includes('meridian')
    console.log('[EM] Has engagement data:', hasEngagement)
    expect(hasEngagement, 'Engagement data must be visible').toBe(true)

    // No "API route not found" errors
    expect(pageText).not.toContain('API route not found')

    // No failed API requests (except 404s for constitution/tools which are now removed)
    const relevantFailures = failedRequests.filter(
      r => !r.includes('favicon') && !r.includes('hot-update')
    )
    console.log('[EM] Failed requests:', relevantFailures)
    expect(relevantFailures.length, `Unexpected failed requests: ${relevantFailures.join(', ')}`).toBe(0)

    // Check for console errors referencing constitution or tools
    const maestraErrors = consoleErrors.filter(
      e => e.includes('constitution') || e.includes('tools') || e.includes('Maestra')
    )
    expect(maestraErrors.length, `Maestra-related console errors: ${maestraErrors.join(', ')}`).toBe(0)

    await page.screenshot({ path: 'e2e/screenshots/engagement-monitor-clean.png' })
  })
})
