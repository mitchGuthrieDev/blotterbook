import { test, expect } from '@playwright/test';

// F61b / CH16 — cloud-sync E2E key setup + unlock UI. Promoted to prod + staging (any logged-in
// non-demo user); demo never renders it. These specs exercise the USER-FACING
// crypto flows against a STUBBED F62 transport: the e2e static server (python http.server over dist/)
// can't run functions, so /api/me and /api/sync/wrapped-ik are fulfilled at the network layer. All the
// real key math runs in the browser (Web Crypto + the Argon2id wasm) — no CSP is enforced by the
// static server, so the wasm compiles freely. The wrapped-IK blobs the setup PUTs are opaque
// ciphertext held only in the test's in-memory map (mirroring the dumb-blob-store contract).

const STAGING = '/app/staging.html';

const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};
const gotoAccount = async page => gotoScreen(page, 'Account');

// Stub the account session (logged in) + the F62 wrapped-IK blob store (an in-memory upsert map).
// `tier` defaults to 'cloud' (the entitled path that reaches key setup); pass 'local' to exercise
// the subscribe-CTA gate.
function installStubs(page, { tier = 'cloud' } = {}) {
  const blobs = []; // { method, key_id, wrapped_ik, updated } — opaque ciphertext
  page.route('**/api/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tier,
        cloudSync: tier === 'cloud',
        user: {
          email: 'e2e@blotterbook.test',
          emailVerified: true,
          donated: false,
          donatedAt: null,
          donationTotalCents: 0,
          createdAt: Date.now(),
        },
        passkeys: [],
      }),
    })
  );
  page.route('**/api/sync/wrapped-ik', route => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      const i = blobs.findIndex(b => b.method === body.method && b.key_id === body.key_id);
      const row = { method: body.method, key_id: body.key_id, wrapped_ik: body.wrapped_ik, updated: Date.now() };
      if (i >= 0) blobs[i] = row;
      else blobs.push(row);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wrappedIks: blobs }) });
  });
  return blobs;
}

// A312: stub the F62 SYNC transport (workspaces register/list + push + pull) so the A279 state machine
// can be driven end-to-end against the static server. First-writer-wins register echoes the effective
// wrapped_dek (A304); pull returns an empty page; push/pull are counted so control EFFECTS are
// assertable. `pushDelayMs` lets a test hold a push open long enough to observe the 'pending' state.
function installSyncTransport(page, { pushDelayMs = 0 } = {}) {
  const s = { workspaces: {}, pushCount: 0, pullCount: 0, pushDelayMs };
  page.route('**/api/sync/workspaces', route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      if (!s.workspaces[body.workspace_id]) s.workspaces[body.workspace_id] = body.wrapped_dek; // never overwrite (A304)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workspace_id: body.workspace_id, wrapped_dek: s.workspaces[body.workspace_id] }),
      });
    }
    const list = Object.entries(s.workspaces).map(([id, dek]) => ({ workspace_id: id, wrapped_dek: dek }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspaces: list }) });
  });
  page.route('**/api/sync/push', async route => {
    s.pushCount++;
    if (s.pushDelayMs) await new Promise(r => setTimeout(r, s.pushDelayMs));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  page.route('**/api/sync/pull**', route => {
    s.pullCount++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ records: [], nextSince: 0, more: false }),
    });
  });
  return s;
}

// Reach an unlocked cloud-sync session from the Account screen (setup with a confirmed recovery key).
async function setupAndUnlock(page) {
  await gotoAccount(page);
  await page.getByTestId('cloud-setup-open').click();
  await page.getByTestId('cloud-generate').click();
  await expect(page.getByTestId('recovery-key')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('recovery-saved').click();
  await page.getByTestId('cloud-finish').click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('cloud-sync-panel')).toBeVisible();
}

const wsTrigger = page => page.getByRole('button', { name: /^Switch workspace: /, exact: false });

// Boot staging with the F56 launch gate forced OFF (these specs exercise cloud sync, not the gate).
async function bootStaging(page) {
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 8000 });
}

const PASSPHRASE = 'correct horse battery';

test('cloud sync (staging): setup blocks finishing until the recovery key is confirmed saved', async ({ page }) => {
  installStubs(page);
  await bootStaging(page);
  await gotoAccount(page);

  const card = page.getByTestId('cloud-sync-card');
  await expect(card).toBeVisible();
  await page.getByTestId('cloud-setup-open').click();

  // Generate → the recovery key is rendered ONCE.
  await page.getByTestId('cloud-generate').click();
  const key = page.getByTestId('recovery-key');
  await expect(key).toBeVisible({ timeout: 8000 });
  const keyText = (await key.textContent())?.trim() ?? '';
  expect(keyText.length).toBeGreaterThan(20); // a real base64 256-bit key

  // Finish is BLOCKED until the "I've saved my recovery key" confirmation — even after a passphrase.
  const finish = page.getByTestId('cloud-finish');
  await expect(finish).toBeDisabled();
  await page.getByLabel('Also set a passphrase (optional)').click();
  await page.getByLabel('Cloud-sync passphrase').fill(PASSPHRASE);
  await expect(finish).toBeDisabled(); // still blocked — the confirmation is mandatory

  // Confirm saved → Finish unlocks, and the account IK is now unlocked in memory for the session.
  await page.getByTestId('recovery-saved').click();
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });
});

test('cloud sync (staging): a LOCAL-tier user sees the subscribe CTA, not the key-setup form', async ({ page }) => {
  installStubs(page, { tier: 'local' });
  await page.route('**/api/checkout', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/app/app.html#account' }) })
  );
  await bootStaging(page);
  await gotoAccount(page);

  const card = page.getByTestId('cloud-sync-card');
  await expect(card).toBeVisible();
  // The tier gate: a local-tier account gets the subscribe CTA, and the key-setup entry point is absent
  // (so a free user can't generate keys the server's A253 entitlement gate would reject on write).
  await expect(page.getByTestId('cloud-subscribe')).toBeVisible();
  await expect(page.getByTestId('cloud-setup-open')).toHaveCount(0);

  // A278: the CTA now reveals the IN-APP subscription form, which immediately creates the
  // incomplete subscription server-side (POST /api/subscription/create — the account linkage +
  // price stay server-resolved). Register the request wait BEFORE the click — the fetch fires as
  // the form mounts, so an after-the-fact wait would race. (On this static test server the API
  // 404s, so the form settles into its error/fallback state — the wiring is what's asserted.)
  const [createReq] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/api/subscription/create') && r.method() === 'POST'),
    page.getByTestId('cloud-subscribe').click(),
  ]);
  expect(createReq.method()).toBe('POST');
  await expect(page.getByTestId('subscribe-form')).toBeVisible();
});

test('cloud sync (staging): lock, then unlock the IK with the passphrase', async ({ page }) => {
  installStubs(page);
  await bootStaging(page);
  await gotoAccount(page);

  // Run setup with a passphrase (same flow as above).
  await page.getByTestId('cloud-setup-open').click();
  await page.getByTestId('cloud-generate').click();
  await expect(page.getByTestId('recovery-key')).toBeVisible({ timeout: 8000 });
  await page.getByLabel('Also set a passphrase (optional)').click();
  await page.getByLabel('Cloud-sync passphrase').fill(PASSPHRASE);
  await page.getByTestId('recovery-saved').click();
  await page.getByTestId('cloud-finish').click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });

  // A279: unlocked → the reworked card shows the parity sync panel (staging runs the sync engine) and
  // the passkey-vs-passphrase explainer — replacing the old bare lock/unlock framing.
  await expect(page.getByTestId('cloud-sync-panel')).toBeVisible();
  await expect(page.getByText('How sign-in and encryption relate')).toBeVisible();

  // Lock → the in-memory IK is cleared, the card offers to unlock again.
  await page.getByTestId('cloud-lock').click();
  await expect(page.getByTestId('cloud-unlock-open')).toBeVisible();
  await expect(page.getByTestId('cloud-unlocked')).toHaveCount(0);

  // Unlock modal → passphrase path rebuilds the KEK (Argon2id) and unwraps the IK back into memory.
  await page.getByTestId('cloud-unlock-open').click();
  await page.getByPlaceholder('Your cloud-sync passphrase').fill(PASSPHRASE);
  await page.getByTestId('unlock-passphrase-submit').click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });
});

test('cloud sync (staging): A279/A299 state machine — enable → synced, controls, pending, pause/resume, per-workspace', async ({
  page,
}) => {
  test.setTimeout(90_000);
  installStubs(page); // /api/me (cloud) + the wrapped-IK blob store
  // Push starts INSTANT so the initial full reconcile (12-record batches over the seeded staging data,
  // A253) settles fast; the delay is turned on only around the 'pending' observation below.
  const sync = installSyncTransport(page, { pushDelayMs: 0 });
  await bootStaging(page);
  await setupAndUnlock(page);

  const panelPill = page.getByTestId('cloud-sync-panel').getByTestId('sync-state');

  // Enable sync for the active workspace from the switcher → the pill runs syncing → synced.
  await wsTrigger(page).click();
  await page.getByTestId('sync-enable').click();
  await page.keyboard.press('Escape');
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });

  // The direction controls now render + have REAL effects (each hits the stubbed transport).
  let pulls = sync.pullCount;
  let pushes = sync.pushCount;
  await page.getByTestId('cloud-pull').click();
  await expect.poll(() => sync.pullCount).toBeGreaterThan(pulls);
  expect(sync.pushCount).toBe(pushes); // pull-only never pushes (A299 pending-clear parity)
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });

  pushes = sync.pushCount;
  await page.getByTestId('cloud-push').click();
  await expect.poll(() => sync.pushCount).toBeGreaterThan(pushes);

  pulls = sync.pullCount;
  pushes = sync.pushCount;
  await page.getByTestId('cloud-sync-now').click();
  await expect.poll(() => sync.pullCount).toBeGreaterThan(pulls);
  await expect.poll(() => sync.pushCount).toBeGreaterThan(pushes);
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });

  // A279 PENDING: a local write (a journal note) marks the workspace "pending upload" until the
  // (slow) debounced push reaches the server, then settles back to 'synced'. Slow the push down NOW
  // (a single-record batch) so 'pending' is observable — the initial full reconcile above ran instant.
  sync.pushDelayMs = 1200;
  await gotoScreen(page, 'Calendar');
  await page.locator('button:has(span.text-chart-2), button:has(span.text-destructive)').first().click();
  await expect(page.getByText('Journal note')).toBeVisible();
  await page.locator('textarea').fill('pending-state note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await gotoAccount(page);
  await expect(panelPill).toHaveAttribute('data-status', 'pending', { timeout: 4000 });
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });
  sync.pushDelayMs = 0; // Resume below does a full re-push — keep it instant so it settles fast.

  // PAUSE → the pill reads 'paused' (distinct from never-synced) and a Resume control appears.
  await page.getByTestId('cloud-pause').click();
  await expect(panelPill).toHaveAttribute('data-status', 'paused', { timeout: 8000 });
  await expect(page.getByTestId('cloud-resume')).toBeVisible();

  // RESUME → back to synced, direction controls return.
  await page.getByTestId('cloud-resume').click();
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });
  await expect(page.getByTestId('cloud-pull')).toBeVisible();

  // A299 PER-WORKSPACE: create a second workspace + switch to it — the pill must re-derive to 'off'
  // (the new workspace is NOT enabled), NOT carry the Default workspace's 'synced'. Switching back
  // restores 'synced'.
  await wsTrigger(page).click();
  await page.getByRole('menuitem', { name: 'New workspace…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByPlaceholder('Workspace name').fill('Second');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(wsTrigger(page)).toHaveAttribute('aria-label', /Second/, { timeout: 8000 });
  await expect(panelPill).toHaveAttribute('data-status', 'off', { timeout: 8000 });

  await wsTrigger(page).click();
  await page.getByRole('menuitem', { name: 'Default', exact: true }).click();
  await expect(wsTrigger(page)).toHaveAttribute('aria-label', /Default/, { timeout: 8000 });
  await expect(panelPill).toHaveAttribute('data-status', 'synced', { timeout: 20_000 });
});

test('cloud sync (demo): NEVER renders any setup/unlock UI (in-memory DemoStore never syncs)', async ({ page }) => {
  installStubs(page); // even with a logged-in session stubbed, demo must not show it

  // Demo — never gated, never syncs; the card is absent (demo also skips the /api/me probe, so
  // account.user stays null and cloudSyncOn is false on top of the isDemo guard).
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 8000 });
  await nav(page).getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Account');
  await expect(page.getByTestId('cloud-sync-card')).toHaveCount(0);
  await expect(page.getByTestId('cloud-setup-open')).toHaveCount(0);
  await expect(page.getByTestId('recovery-key')).toHaveCount(0);
});

test('cloud sync (prod): renders the cloud-sync card for a logged-in user (CH16-promoted)', async ({ page }) => {
  test.setTimeout(60_000);
  installStubs(page); // logged-in /api/me session + the wrapped-IK blob store

  // A fresh prod install boots to first-run onboarding; import a CSV + Launch to reach the app shell.
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto('/app/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toBeVisible({ timeout: 8000 });

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
  await expect(launch).toBeEnabled({ timeout: 8000 });
  await launch.click();
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 8000 });

  // Account screen (logged in via the stub) → the promoted cloud-sync card + setup control now render
  // on prod. On prod's local tier the feature stays inert until the user is cloud-tier, but the card
  // itself is present (it was staging-only before CH16).
  await gotoAccount(page);
  await expect(page.getByTestId('cloud-sync-card')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('cloud-setup-open')).toBeVisible();

  // A279/CH16 (2026-07-07): cloud sync is LIVE on prod, not just staging — the CloudStore wraps every
  // non-demo Store (A256) and configureCloudSync runs on prod, so cloudSync.configured is true here.
  // Complete setup + unlock and confirm the reworked parity panel + passkey/passphrase explainer render
  // on the PROD surface (the same UI staging gets).
  await page.getByTestId('cloud-setup-open').click();
  await page.getByTestId('cloud-generate').click();
  await expect(page.getByTestId('recovery-key')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('recovery-saved').click();
  await page.getByTestId('cloud-finish').click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('cloud-sync-panel')).toBeVisible();
  await expect(page.getByText('How sign-in and encryption relate')).toBeVisible();

  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook')); // leave the surface clean
});
