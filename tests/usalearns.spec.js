import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_STUDENT_EMAIL || 'testuser@example.com';
const TEST_PASSWORD = process.env.TEST_STUDENT_PASSWORD || 'password123';

test.describe('USA Learns Student Sign In', () => {
  test('navega al formulario y valida la presencia de campos de login', async ({ page }) => {
    await page.goto('https://www.usalearns.org/student-sign-in');

    await expect(page.locator('#EmailAddress')).toBeVisible();
    await expect(page.locator('#Password')).toBeVisible();
    await expect(page.locator('input[name="submit"]')).toBeVisible();

    await page.locator('#EmailAddress').fill(TEST_EMAIL);
    await page.locator('#Password').fill(TEST_PASSWORD);

    await expect(page.locator('#EmailAddress')).toHaveValue(TEST_EMAIL);
  });
});
