const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true }); const p = await b.newPage(); const U='http://127.0.0.1:8765/';
  await p.goto(U+'basic.html'); await p.fill('#name','Иван Воронцов'); await p.fill('#email','ivan@example.com'); await p.fill('#phone','+7 914 123-45-67');
  await p.fill('#about','Привет! Съешь же ещё этих мягких французских булок, да выпей чаю.'); await p.selectOption('#city',{label:'Владивосток'}); await p.check('#s_m'); await p.check('#terms');
  await p.fill('#date','2026-11-05'); await p.setInputFiles('#file','/tmp/upload_test.txt'); await Promise.all([p.waitForNavigation(), p.click('text=Отправить')]);
  await p.goto(U+'wizard.html'); await p.fill('#w_name','Иван Воронцов'); await p.fill('#w_email','ivan@example.com'); await p.click('#next1');
  await p.fill('#w_zip','690091'); await p.fill('#w_qty','3'); await p.click('#next2'); await p.click('#back3'); await p.click('#next2');
  await p.click('#color'); await p.click('text=Зелёный'); await Promise.all([p.waitForNavigation(), p.click('text=Оформить заказ')]);
  await p.goto(U+'validate.html'); await p.fill('#login','ivan.v'); await p.fill('#pass','Secret2026'); await p.fill('#pass2','Secret2026'); await p.fill('#age','17'); await p.click('button');
  console.log('err:', await p.textContent('#err')); await p.fill('#login','ivanv'); await p.fill('#age','18'); await Promise.all([p.waitForNavigation(), p.click('button')]);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
