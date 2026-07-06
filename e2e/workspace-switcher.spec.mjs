import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A132 (rescoped): the workspace-switcher UI over F59's named local workspaces. STAGING ONLY — the
// switcher lives in the sidebar header slot and is gated by isStaging in App.svelte, so prod/demo
// never mount it (asserted at the bottom of this file). Each test gets a fresh, isolated browser
// context (Playwright default), so the workspace registry (Store.local, per F59) starts at the single
// migrated "Default" workspace every time — no cross-test bleed.

const STAGING = '/app/staging.html';
const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};
const bootDashboard = async page => {
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
};

// The switcher trigger's accessible name is "Switch workspace: <active name>" (aria-label), so it
// doubles as both the open-menu control and the "which workspace is active" readout.
const trigger = page => page.getByRole('button', { name: /^Switch workspace: /, exact: false });
const activeName = async page => (await trigger(page).getAttribute('aria-label')).replace('Switch workspace: ', '');

test('workspace switcher: renders on staging with the Default workspace active', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Default');

  // Opening it lists the registry (one entry) with the sync-status stub, and Delete is disabled —
  // the store refuses to delete the last remaining workspace.
  await trigger(page).click();
  await expect(page.getByRole('menuitem', { name: 'Default', exact: true })).toBeVisible();
  await expect(page.getByText('Local only · Sync coming soon')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('workspace switcher: "New workspace…" creates + switches, data is isolated, and rename updates the label', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // Write a journal note on the Default workspace's first traded day.
  await gotoScreen(page, 'Calendar');
  await page.locator('button:has(span.text-chart-2), button:has(span.text-destructive)').first().click();
  await expect(page.getByText('Journal note')).toBeVisible();
  await page.locator('textarea').fill('default-workspace note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(300);

  // Create a second workspace — the dialog's Create switches onto it immediately.
  await trigger(page).click();
  await page.getByRole('menuitem', { name: 'New workspace…' }).click();
  const createDlg = page.getByRole('dialog');
  await expect(createDlg.getByText('New workspace')).toBeVisible();
  await createDlg.getByPlaceholder('Workspace name').fill('Swing Account');
  await createDlg.getByRole('button', { name: 'Create' }).click();
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Swing Account');

  // Isolation: the new workspace's own DB is freshly seeded but carries NO journal note — writes to
  // one workspace's IndexedDB never leak into another's.
  await gotoScreen(page, 'Calendar');
  await page.locator('button:has(span.text-chart-2), button:has(span.text-destructive)').first().click();
  await expect(page.getByText('Journal note')).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue('');

  // Rename the active ("Swing Account") workspace via the switcher.
  await trigger(page).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const renameDlg = page.getByRole('dialog');
  await renameDlg.getByPlaceholder('Workspace name').fill('Renamed Swing');
  await renameDlg.getByRole('button', { name: 'Save' }).click();
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Renamed Swing');

  // Switching back to Default restores its own note — proving each workspace's data round-trips
  // through its OWN isolated database, not a shared one.
  await trigger(page).click();
  await page.getByRole('menuitem', { name: 'Default', exact: true }).click();
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Default');
  await gotoScreen(page, 'Calendar');
  await page.locator('button:has(span.text-chart-2), button:has(span.text-destructive)').first().click();
  await expect(page.locator('textarea')).toHaveValue('default-workspace note');
});

test('workspace switcher: delete removes a workspace and Delete disables again at one workspace', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // Create a second workspace so there's something deletable.
  await trigger(page).click();
  await page.getByRole('menuitem', { name: 'New workspace…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByPlaceholder('Workspace name').fill('Scratch');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Scratch');

  // Deleting the ACTIVE workspace ("Scratch") switches away to the only remaining one (Default).
  await trigger(page).click();
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Default');

  // Back to a single workspace — Delete is disabled again (the store refuses the last one).
  await trigger(page).click();
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toHaveAttribute('aria-disabled', 'true');
});

test('workspace switcher: prod and demo never render it (staging-only, F59 dimension inert elsewhere)', async ({ page }) => {
  await page.goto('/app/app.html', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /^Switch workspace: /, exact: false })).toHaveCount(0);

  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: /^Switch workspace: /, exact: false })).toHaveCount(0);
});
