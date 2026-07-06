import { test, expect } from '@playwright/test';

// F61b — cloud-sync E2E key setup + unlock UI (staging-gated). These specs exercise the USER-FACING
// crypto flows against a STUBBED F62 transport: the e2e static server (python http.server over dist/)
// can't run functions, so /api/me and /api/sync/wrapped-ik are fulfilled at the network layer. All the
// real key math runs in the browser (Web Crypto + the Argon2id wasm) — no CSP is enforced by the
// static server, so the wasm compiles freely. The wrapped-IK blobs the setup PUTs are opaque
// ciphertext held only in the test's in-memory map (mirroring the dumb-blob-store contract).

const STAGING = '/app/staging.html';

const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoAccount = async page => {
  await nav(page).getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Account');
};

// Stub the account session (logged in) + the F62 wrapped-IK blob store (an in-memory upsert map).
function installStubs(page) {
  const blobs = []; // { method, key_id, wrapped_ik, updated } — opaque ciphertext
  page.route('**/api/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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

  // Lock → the in-memory IK is cleared, the card offers to unlock again.
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByTestId('cloud-unlock-open')).toBeVisible();
  await expect(page.getByTestId('cloud-unlocked')).toHaveCount(0);

  // Unlock modal → passphrase path rebuilds the KEK (Argon2id) and unwraps the IK back into memory.
  await page.getByTestId('cloud-unlock-open').click();
  await page.getByPlaceholder('Your cloud-sync passphrase').fill(PASSPHRASE);
  await page.getByTestId('unlock-passphrase-submit').click();
  await expect(page.getByTestId('cloud-unlocked')).toBeVisible({ timeout: 15_000 });
});

test('cloud sync: demo and prod NEVER render any setup/unlock UI', async ({ page }) => {
  installStubs(page); // even with a logged-in session stubbed, prod/demo must not show it

  // Demo — never gated, never syncs; the card is absent.
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 8000 });
  await nav(page).getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Account');
  await expect(page.getByTestId('cloud-sync-card')).toHaveCount(0);
  await expect(page.getByTestId('cloud-setup-open')).toHaveCount(0);

  // Prod (app.html) — isStaging is false, so the cloud-sync UI is never present on this surface. A
  // fresh prod install boots to first-run onboarding (no seed data), which is exactly the point: the
  // staging-only cloud-sync card + setup control never render anywhere on prod.
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto('/app/app.html#account', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // let boot settle past the splash
  await expect(page.getByTestId('cloud-sync-card')).toHaveCount(0);
  await expect(page.getByTestId('cloud-setup-open')).toHaveCount(0);
  await expect(page.getByTestId('recovery-key')).toHaveCount(0);
});
