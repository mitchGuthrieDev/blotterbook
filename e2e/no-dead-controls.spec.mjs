import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

/* "No dead controls" sweep (R1 pass-5 follow-through). The fifth audit found shipped controls that
   silently did nothing (the onboarding CSV CTA, the Blotter drawer's Save/Tag/Delete, the Calendar
   lightbox) — a class no static gate catches. This sweep clicks EVERY visible, enabled <button>
   (incl. role=switch) inside the content column of every screen on the DEMO surface (seeded
   in-memory DemoStore → deterministic, nothing persists) and asserts each click has an observable
   effect: a DOM mutation, a native file chooser, or a JS dialog. A button with none of those must
   be on the explicit allow-list below — otherwise it's reported dead and the test fails.

   Buttons are swept in REVERSE document order so view-switching toolbar toggles (Calendar
   Month→Year, page-size pills) don't detach the deeper controls before they're exercised; a click
   intercepted by an open overlay is retried once after Escape. Demo-disabled controls are skipped
   by the :enabled filter (their guards are covered in interactions.spec.mjs).

   ARCHIVE FREEZE (2026-07-08, docs/archive-freeze.md): no allow-list change needed here. The sweep
   is scoped to `main button` per screen (Dashboard/Calendar/Analytics/Blotter/CSV Library/Trade
   Editor/Reports) — it never reaches the sidebar (the now-removed Account nav item) or the site's
   homepage pricing CTA (a different surface entirely). The homepage's frozen "Synced workspaces"
   CTA is a `disabled` button, which the same `:enabled`-filter exemption this file already relies on
   for demo-disabled controls would cover if it were ever swept. */

const DEMO = '/app/demo.html';
const SCREENS = ['Dashboard', 'Calendar', 'Analytics', 'Blotter', 'CSV Library', 'Trade Editor', 'Reports'];

// Controls that legitimately produce no DOM mutation on SOME clicks. Keep this list justified:
//  - export actions fire a download / clipboard write / mailto / print, not a DOM change
//    (they're also skipped from clicking so the sweep doesn't spray downloads);
//  - single-select segments / pills / templates are no-ops when already active (their inactive
//    siblings still prove the wiring);
//  - overlay toggles keep ≥1 series on (clicking the last active one is a guarded no-op);
//  - "Latest" is a no-op when the calendar cursor is already on the latest month;
//  - the corner resize handle (role=slider, A271/CH16) is a drag/keyboard control — a bare
//    zero-distance click is a no-op by design (its liveness is covered by the promoted keyboard
//    test in interactions.spec.mjs + the drag engine tests in staging-redesign.spec.mjs).
const ALLOW = [
  /^(All time|This month|Month|Year|Custom)$/,
  /^(25|50|100|All)$/,
  /^(Gross|Net|Take-home)$/,
  /^Latest$/,
  /^(Performance|Cost & break-even|Tax \(1256\)|Full \/ custom)$/,
  /^Resize .+ module$/,
];
const SKIP_CLICK = [/^(PDF|Markdown|CSV|Email|Copy)$/];

const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};

for (const screen of SCREENS) {
  test(`demo: ${screen} — every enabled control does something`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);

    // Liveness signals that don't touch the DOM: a native file chooser or a JS dialog.
    let chooserOpened, dialogOpened;
    page.on('filechooser', async fc => {
      chooserOpened = true;
      await fc.setFiles([]).catch(() => {});
    });
    page.on('dialog', async d => {
      dialogOpened = true;
      await d.dismiss().catch(() => {});
    });

    await page.goto(DEMO, { waitUntil: 'networkidle' });
    await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
    await gotoScreen(page, screen);

    // Count every DOM mutation under <body> (portalled dialogs/menus included).
    await page.evaluate(() => {
      window.__mut = 0;
      new MutationObserver(m => (window.__mut += m.length)).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });

    const els = await page.locator('main button').elementHandles();
    const dead = [];
    let clicked = 0,
      skipped = 0;
    for (const el of els.reverse()) {
      if (!(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) {
        skipped++;
        continue;
      }
      const label = ((await el.getAttribute('aria-label').catch(() => '')) || (await el.innerText().catch(() => '')) || '(unnamed)')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60);
      if (SKIP_CLICK.some(r => r.test(label))) {
        skipped++;
        continue;
      }
      chooserOpened = dialogOpened = false;
      const before = await page.evaluate(() => window.__mut);
      let landed = true;
      try {
        await el.click({ timeout: 1500 });
      } catch {
        // Likely covered by an overlay a prior click opened — close it and retry once.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        landed = await el
          .click({ timeout: 1500 })
          .then(() => true)
          .catch(() => false);
      }
      if (!landed) {
        skipped++;
        continue;
      }
      clicked++;
      const mutated = await page
        .waitForFunction(c => window.__mut > c, before, { timeout: 700 })
        .then(() => true)
        .catch(() => false);
      if (!mutated && !chooserOpened && !dialogOpened && !ALLOW.some(r => r.test(label))) dead.push(label);
      // Dismiss whatever the click opened so the next click isn't intercepted.
      await page.keyboard.press('Escape');
    }

    expect(clicked, `sweep exercised no controls on ${screen} (skipped ${skipped})`).toBeGreaterThan(0);
    expect(dead, `dead controls on ${screen} (no mutation/chooser/dialog): ${dead.join(' · ')}`).toEqual([]);
    // The sweep must also be error-free — a control that throws on click is as broken as a dead one.
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
}
