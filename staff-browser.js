const { chromium } = require('playwright');
const BASE = 'http://localhost:8811';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const p = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_(TUNNEL|NAME)/.test(m.text()) && !/status of 400/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  p.on('dialog', d => d.accept());

  await p.goto(BASE + '/staff.html');
  await p.waitForSelector('[data-form="login"]');

  /* wrong password first */
  await p.fill('#le', 'mitch@example.com');
  await p.fill('#lp', 'wrongpass');
  await p.click('[data-form="login"] button[type=submit]');
  await p.waitForSelector('.errbox', { timeout: 10000 });
  console.log('bad password       :', (await p.locator('.errbox').innerText()).trim());

  await p.fill('#le', 'mitch@example.com');
  await p.fill('#lp', 'devpass');
  await p.click('[data-form="login"] button[type=submit]');
  await p.waitForSelector('.kpis', { timeout: 15000 });
  console.log('signed in, KPIs    :', (await p.locator('.kpi small').allInnerTexts()).join(' | '));
  await p.screenshot({ path: '/home/claude/live-staff.png', fullPage: true });

  /* add a walk-in for today */
  await p.click('[data-act="addbooking"]');
  await p.waitForSelector('[data-form="addbooking"]');
  await p.selectOption('[data-form="addbooking"] select[name=service]', { index: 0 });
  await p.selectOption('[data-form="addbooking"] select[name=barber]', { index: 0 });
  await p.fill('[data-form="addbooking"] input[name=time]', '12:07');
  await p.fill('[data-form="addbooking"] input[name=name]', 'Walk In Wally');
  await p.fill('[data-form="addbooking"] input[name=phone]', '07700900777');
  await p.click('[data-form="addbooking"] button[type=submit]');
  await p.waitForSelector('.toast', { timeout: 15000 });
  console.log('walk-in added      :', await p.locator('.toast').last().innerText());
  await p.waitForTimeout(1200);
  const rows = await p.locator('table.data tbody tr').count();
  console.log('diary rows today   :', rows);

  /* mark it done -> should stamp the card */
  await p.locator('[data-act="done"]').first().click();
  await p.waitForSelector('.toast', { timeout: 15000 });
  console.log('mark done          :', await p.locator('.toast').last().innerText());
  await p.waitForTimeout(1500);

  /* members tab */
  await p.click('[data-act="tab"][data-tab="members"]');
  await p.waitForSelector('#msearch', { timeout: 10000 });
  console.log('member rows        :', await p.locator('table.data tbody tr').count());
  await p.screenshot({ path: '/home/claude/live-members.png', fullPage: true });

  await p.locator('[data-act="stamp"][data-delta="1"]').first().click();
  await p.waitForSelector('.toast', { timeout: 15000 });
  console.log('manual stamp       :', await p.locator('.toast').last().innerText());
  await p.waitForTimeout(1200);

  /* search box keeps focus */
  await p.fill('#msearch', 'danny');
  await p.waitForTimeout(400);
  console.log('search results     :', await p.locator('table.data tbody tr').count());
  console.log('search kept focus  :', await p.evaluate(() => document.activeElement && document.activeElement.id));

  /* settings tab */
  await p.fill('#msearch', '');
  await p.click('[data-act="tab"][data-tab="settings"]');
  await p.waitForSelector('[data-form="set-shop"]', { timeout: 10000 });
  await p.screenshot({ path: '/home/claude/live-settings.png', fullPage: true });

  await p.fill('[data-form="set-shop"] input[name=phone]', '01843 555111');
  await p.fill('[data-form="set-shop"] input[name=email]', 'hello@mitchsbarbershop.co.uk');
  await p.click('[data-form="set-shop"] button[type=submit]');
  await p.waitForSelector('.toast', { timeout: 15000 });
  console.log('saved shop details :', await p.locator('.toast').last().innerText());
  await p.waitForTimeout(1500);

  /* change a price */
  await p.click('[data-act="tab"][data-tab="settings"]');
  await p.waitForSelector('[data-form="set-services"]');
  const priceInput = p.locator('[data-form="set-services"] input[type=number]').first();
  await priceInput.fill('21');
  await p.click('[data-form="set-services"] button[type=submit]');
  await p.waitForSelector('.toast', { timeout: 15000 });
  console.log('saved services     :', await p.locator('.toast').last().innerText());
  await p.waitForTimeout(1500);

  /* the public site should show the new price and phone number */
  const v = await browser.newPage();
  v.on('pageerror', e => errs.push('SITE PAGEERROR: ' + e.message));
  await v.goto(BASE + '/index.html');
  await v.waitForSelector('.svc article');
  const firstPrice = await v.locator('.svc .price').first().innerText();
  const footer = await v.locator('footer').innerText();
  console.log('public first price :', firstPrice);
  console.log('phone on site      :', /01843 555111/.test(footer) ? 'yes' : 'NO');
  if (!/01843 555111/.test(footer)) errs.push('FAIL: settings change did not reach the public site');

  /* mobile staff view */
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mob.on('pageerror', e => errs.push('MOB PAGEERROR: ' + e.message));
  await mob.goto(BASE + '/staff.html');
  await mob.waitForSelector('[data-form="login"], .kpis', { timeout: 10000 });
  const ov = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('staff mobile overflow:', ov);

  console.log('\nERRORS:', errs.length ? errs : 'none');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
