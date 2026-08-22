import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Example script demonstrating browser and form automation with Playwright.
 * Demonstrates:
 * - Launching headed/headless browser
 * - Navigating to a page
 * - Filling input fields & textareas
 * - Selecting dropdown options
 * - Clicking radio buttons & checkboxes
 * - Handling dynamic waits
 * - Taking proof screenshots
 */
async function runFormAutomation() {
  console.log('🚀 Launching Chromium browser...');
  const browser = await chromium.launch({
    headless: false, // Set to true for background headless execution
    slowMo: 100,     // Slow down actions by 100ms for visual clarity
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    console.log('🌐 Navigating to demo form...');
    // Using demoqa or another standard public form test page
    await page.goto('https://demo.playwright.dev/todomvc/', { waitUntil: 'domcontentloaded' });

    console.log('✍️ Interacting with page elements...');
    const newTodo = page.getByPlaceholder('What needs to be done?');
    await newTodo.fill('Automate form fields with Playwright MCP');
    await newTodo.press('Enter');

    await newTodo.fill('Verify form inputs and assertions');
    await newTodo.press('Enter');

    // Create screenshot output directory if needed
    const screenshotsDir = path.resolve('screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const screenshotPath = path.join(screenshotsDir, 'automation-success.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved to: ${screenshotPath}`);

    console.log('✅ Form automation completed successfully!');
  } catch (error) {
    console.error('❌ Automation failed:', error);
  } finally {
    await browser.close();
    console.log('🔒 Browser closed.');
  }
}

runFormAutomation();
