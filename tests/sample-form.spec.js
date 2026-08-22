import { test, expect } from '@playwright/test';

test.describe('Form Automation Test Suite', () => {
  test('fills and verifies sample form inputs', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('Task 1: Setup Playwright MCP');
    await input.press('Enter');

    await input.fill('Task 2: Automate form submissions');
    await input.press('Enter');

    const todoItems = page.getByTestId('todo-title');
    await expect(todoItems).toHaveCount(2);
    await expect(todoItems.first()).toHaveText('Task 1: Setup Playwright MCP');
  });
});
