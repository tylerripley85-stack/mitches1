const { chromium } = require('playwright');
const BASE = 'http://localhost:8811';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const log = (...a) => console.log(...a);

  function watch(p, tag) {
    p.on('pageerror', e => errs.push(tag + ' PAGEERROR: ' + e.message));
    p.on('console', m => {
      if (m.type() === 'error' && !/ERR_(TUNNEL|NAME|INTERNET)/.test(m.text())) errs.push(tag + ' CONSOLE: ' + m.text());
    });
  }

  /* ---------------- public site ---------------- */
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(p, 'site');
  await p.goto(BASE + '/index.html');
  await p.waitForSelector('.svc article', { timeout: 10000 });
  log('services on page   :', await p.locator('.svc article').count());
  log('team on page       :', await p.locator('.chair').count());
  log('free badge shown   :', await p.locator('.badge').count());
  await p.waitForSelector('.slotline', { timeout: 10000 });
  const names = await p.locator('.slotline .who').allInnerTexts();
  log('next-up barbers    :', names.join(', '));
  await p.screenshot({ path: '/home/claude/live-home.png', fullPage: true });

  /* booking: free apprentice cut should not offer Mitch */
  await p.click('[data-route="book"]');
  await p.waitForSelector('[data-act="svc"]');
  const freeBtn = p.locator('[data-act="svc"]').filter({ hasText: 'Apprentice cut' });
  await freeBtn.click();
  await p.waitForSelector('[data-act="barber"]');
  const barberNames = await p.locator('[data-act="barber"] .nm').allInnerTexts();
  log('barbers for free cut:', barberNames.join(', '));
  if (barberNames.some(n => /Mitch/.test(n))) errs.push('FAIL: Mitch offered for the free apprentice cut');

  /* now a paid cut, full flow */
  await p.click('[data-act="step"][data-step="1"]');
  await p.waitForSelector('[data-act="svc"]');
  await p.locator('[data-act="svc"]').filter({ hasText: 'Skin Fade' }).first().click();
  await p.waitForSelector('[data-act="barber"]');
  await p.locator('[data-act="barber"]').filter({ hasText: 'Ronnie' }).click();
  await p.waitForSelector('.dchip');
  await p.locator('.dchip:not(.shut)').nth(2).click();   // a few days out, so it is movable
  await p.waitForSelector('.tslot', { timeout: 10000 });
  const freeSlots = await p.locator('.tslot:not([disabled])').count();
  const takenSlots = await p.locator('.tslot[disabled]').count();
  log('slots free/taken   :', freeSlots + '/' + takenSlots);
  await p.screenshot({ path: '/home/claude/live-times.png', fullPage: true });
  const chosen = await p.locator('.tslot:not([disabled])').first().innerText();
  await p.locator('.tslot:not([disabled])').first().click();
  await p.waitForSelector('#bn');
  await p.fill('#bn', 'Danny Cole');
  await p.fill('#bp', '07700 900123');
  await p.fill('#be', 'danny@example.com');
  await p.fill('#bnote', 'Number one back and sides.');
  await p.click('button[type="submit"]');
  await p.waitForSelector('.refbox b', { timeout: 15000 });
  const ref = await p.locator('.refbox b').innerText();
  log('booked             :', ref, 'at', chosen);
  log('card on confirm    :', await p.locator('.card .cno').innerText());
  await p.screenshot({ path: '/home/claude/live-confirm.png', fullPage: true });

  const manageHref = await p.locator('a:has-text("Change or cancel")').getAttribute('href');

  /* the slot we just took must now be gone */
  await p.click('[data-route="book"]');
  await p.waitForSelector('[data-act="svc"]');
  await p.locator('[data-act="svc"]').filter({ hasText: 'Skin Fade' }).first().click();
  await p.waitForSelector('[data-act="barber"]');
  await p.locator('[data-act="barber"]').filter({ hasText: 'Ronnie' }).click();
  await p.waitForSelector('.tslot', { timeout: 10000 });
  const stillFree = await p.locator('.tslot:not([disabled])').allInnerTexts();
  log('slot released?     :', stillFree.includes(chosen) ? 'STILL OFFERED (bad)' : 'correctly taken');
  if (stillFree.includes(chosen)) errs.push('FAIL: booked slot still offered');

  /* membership signup */
  await p.click('[data-route="join"]');
  await p.waitForSelector('[data-form="join"]');
  await p.fill('#jn', 'Sam Kent');
  await p.fill('#je', 'sam@example.com');
  await p.click('[data-form="join"] button[type="submit"]');
  await p.waitForSelector('.toast', { timeout: 10000 });
  log('join toast         :', await p.locator('.toast').first().innerText());

  /* ---------------- customer manage page ---------------- */
  const m = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(m, 'manage');
  await m.goto(BASE + '/' + manageHref);
  await m.waitForSelector('.card', { timeout: 10000 });
  log('manage greeting    :', await m.locator('h2.dsp').innerText());
  log('upcoming bookings  :', await m.locator('[data-act="cancel"]').count());
  await m.screenshot({ path: '/home/claude/live-manage.png', fullPage: true });

  /* reschedule */
  await m.click('[data-act="move"]');
  await m.waitForSelector('.dchip');
  await m.locator('[data-act="mdate"]:not(.shut)').nth(3).click();
  await m.waitForSelector('#mtimes .tslot', { timeout: 10000 });
  await m.locator('#mtimes .tslot:not([disabled])').nth(3).click();
  await m.click('[data-act="confirmmove"]');
  await m.waitForSelector('.toast', { timeout: 15000 });
  log('move toast         :', await m.locator('.toast').first().innerText());

  /* cancel */
  m.on('dialog', d => d.accept());
  await m.waitForTimeout(1200);
  await m.click('[data-act="cancel"]');
  await m.waitForTimeout(2500);
  const pills = await m.locator('.pill').allInnerTexts();
  log('after cancel       :', pills.join(', '));

  /* bad token */
  const bad = await browser.newPage();
  watch(bad, 'badtoken');
  await bad.goto(BASE + '/manage.html?t=11111111-1111-1111-1111-111111111111');
  await bad.waitForSelector('.gate', { timeout: 10000 });
  log('bad token page     :', (await bad.locator('.gate h3').innerText()));

  /* ---------------- mobile ---------------- */
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(mob, 'mobile');
  await mob.goto(BASE + '/index.html');
  await mob.waitForSelector('.svc article', { timeout: 10000 });
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log('mobile overflow px :', overflow);
  if (overflow > 0) errs.push('FAIL: mobile page scrolls sideways');
  await mob.screenshot({ path: '/home/claude/live-mobile.png', fullPage: true });

  console.log('\nERRORS:', errs.length ? errs : 'none');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
