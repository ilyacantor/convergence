/**
 * Upload tab — verify it loads, shows both entity panels,
 * and has working drag-drop zones.
 */
import { test, expect } from '@playwright/test'

test.describe('Upload tab', () => {
  test('loads with engagement context and both entity panels', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const failedRequests: string[] = []
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`)
      }
    })

    await page.goto('/upload')
    await page.waitForTimeout(2000)

    // Upload tab must be visible in nav
    const uploadNav = page.locator('nav a[href="/upload"]')
    await expect(uploadNav).toBeVisible()

    // Page heading
    await expect(page.getByText('Upload', { exact: true }).first()).toBeVisible()

    // Must show entity panels — acquirer and target labels
    const pageText = await page.textContent('body') ?? ''
    const hasAcquirerPanel = pageText.includes('Acquirer')
    const hasTargetPanel = pageText.includes('Target')
    expect(hasAcquirerPanel, 'Acquirer panel must be visible').toBe(true)
    expect(hasTargetPanel, 'Target panel must be visible').toBe(true)

    // Must show drag-drop zones
    expect(pageText).toContain('Drop GL and CoA files here')

    // Intake pipeline section
    expect(pageText).toContain('Intake pipeline')

    // Optional enrichment section
    expect(pageText).toContain('Optional enrichment')

    // Proceed button
    const proceedBtn = page.getByRole('button', { name: /proceed to mapping/i })
    await expect(proceedBtn).toBeVisible()
    await expect(proceedBtn).toBeDisabled()

    // No failed API requests
    const relevantFailures = failedRequests.filter(
      r => !r.includes('favicon') && !r.includes('hot-update')
    )
    console.log('[Upload] Failed requests:', relevantFailures)
    expect(relevantFailures.length, `Unexpected failed requests: ${relevantFailures.join(', ')}`).toBe(0)

    await page.screenshot({ path: 'e2e/screenshots/upload-tab.png' })
  })
})
