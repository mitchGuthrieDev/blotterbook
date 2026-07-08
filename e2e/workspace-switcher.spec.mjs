import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A132 (rescoped) / CH16: the workspace-switcher UI over F59's named local workspaces. PROD + STAGING
// (not demo) — the switcher lives in the sidebar header slot; App.svelte passes it in for every
// non-demo surface, so prod renders it too (asserted at the bottom), while demo (in-memory DemoStore,
// no multiple workspaces) never mounts it. Each test gets a fresh, isolated browser context
// (Playwright default), so the workspace registry (Store.local, per F59) starts at the single migrated
// "Default" workspace every time — no cross-test bleed.

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

  // Opening it lists the registry (one entry) with the F63 per-workspace sync-status affordance, and
  // Delete is disabled — the store refuses to delete the last remaining workspace. The e2e static
  // server can't run functions, so /api/me fails → the local tier → the inert "cloud tier required".
  await trigger(page).click();
  await expect(page.getByRole('menuitem', { name: 'Default', exact: true })).toBeVisible();
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await expect(page.getByText('cloud tier required')).toBeVisible();
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

test('workspace switcher: renders on PROD after import (CH16-promoted), sync-status reads inert on local tier', async ({ page }) => {
  test.setTimeout(60_000);
  // A fresh prod install boots to first-run onboarding (nav — and the switcher — hidden). Import a
  // CSV + Launch to reach the dashboard, then the promoted switcher renders.
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto('/app/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toBeVisible({ timeout: 6000 });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 3000 }),
    page.getByRole('button', { name: 'Choose CSV files' }).click(),
  ]);
  await chooser.setFiles([
    {
      name: 'trades.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Time,Action,Realized PnL (value)\n' +
          '2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00\n' +
          '2026-06-02 11:30:00,"Close short position for symbol MNQM2025 at price 18000.00",-20.00\n'
      ),
    },
  ]);
  const launch = page.getByRole('button', { name: /Launch Blotterbook/ });
  await expect(launch).toBeEnabled({ timeout: 6000 });
  await launch.click();
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });

  // CH16: the switcher now ships on prod — the single migrated "Default" workspace is active.
  await expect(trigger(page)).toBeVisible();
  await expect.poll(() => activeName(page)).toBe('Default');

  // The F63 sync-status row reads sensibly (not a broken state) on prod's local tier: the e2e static
  // server can't run functions, so /api/me fails → local tier → the inert "cloud tier required" hint.
  await trigger(page).click();
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await expect(page.getByText('cloud tier required')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook')); // leave the surface clean
});

test('workspace switcher: DEMO never renders it (in-memory DemoStore has no multiple workspaces)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: /^Switch workspace: /, exact: false })).toHaveCount(0);
});

// A256/F63: cloud sync is opt-in PER WORKSPACE. Prod now WRAPS the Store in a CloudStore and configures
// the controller (A256), but with no workspace opted into sync — and no writes — the write-behind push
// never fires, so prod still issues ZERO /api/sync/* traffic no matter what the account looks like.
// Demo never constructs a CloudStore at all.
test('cloud sync: demo and prod never call /api/sync (inert CloudStore off enabled workspaces)', async ({ page }) => {
  const syncCalls = [];
  page.on('request', r => {
    if (r.url().includes('/api/sync')) syncCalls.push(r.url());
  });
  // Even with a cloud-tier account stubbed, prod/demo must not sync.
  await page.route('**/api/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'cloud', cloudSync: true, user: null, passkeys: [] }),
    })
  );

  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);

  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto('/app/app.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  expect(syncCalls, syncCalls.join('\n')).toHaveLength(0);
});

// A306: while the tier probe (/api/me) is still in flight (cloudSync.tier === ''), the switcher shows
// a NEUTRAL "Checking…" — it must NOT mislabel a would-be cloud user "cloud tier required" during the
// window. The full A279/A299 pill state machine (enable → synced → pending → pause + per-workspace
// switch) is driven end-to-end in cloud-sync.spec.mjs.
test('workspace switcher: shows a neutral "checking…" while the tier probe is in flight (A306)', async ({ page }) => {
  await page.route('**/api/me', async route => {
    await new Promise(r => setTimeout(r, 4000)); // hold the probe so tier stays '' when we open the menu
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'cloud', cloudSync: true, user: null, passkeys: [] }),
    });
  });
  // Boot WITHOUT waiting for network idle — `networkidle` would block on the held /api/me above, so by
  // the time the menu opened the probe would already have resolved (tier='cloud') and the transient
  // 'checking' window would be gone. The dashboard renders off the local Store, independent of the probe.
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto(STAGING, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await trigger(page).click();
  await expect(page.getByTestId('sync-checking')).toBeVisible();
  await expect(page.getByText('cloud tier required')).toHaveCount(0);
});

// F63/A336: the per-workspace sync-status affordance renders on STAGING for a cloud-tier account.
// The button is ALWAYS the sync action ("Enable sync"); when the E2E key isn't in memory, clicking
// it opens the inline key prompt as a step of the action (the e2e server can't run /api/sync, so
// this asserts the affordance is present + wired, not a full push/pull — convergence is proven in
// scripts/test-cloudsync.mjs).
test('cloud sync (staging): the switcher shows the sync affordance for a cloud-tier account', async ({ page }) => {
  await page.route('**/api/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'cloud', cloudSync: true, user: null, passkeys: [] }),
    })
  );
  await bootDashboard(page);
  await trigger(page).click();
  await expect(page.getByTestId('sync-status')).toBeVisible();
  // A336: the action button renders directly — no unlock affordance exists anymore.
  await expect(page.getByTestId('sync-enable')).toBeVisible();
  await expect(page.getByTestId('sync-unlock')).toHaveCount(0);
  await expect(page.getByText('cloud tier required')).toHaveCount(0);
});
