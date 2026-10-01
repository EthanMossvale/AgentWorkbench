/** Follow the visible tabs/disclosures before interacting with a nested control. */
export async function revealControl(page, testId) {
  const target = page.getByTestId(testId);
  const tabId = await target.evaluate(element => element.closest('[role="tabpanel"][hidden]')?.getAttribute('aria-labelledby'));
  if (tabId) await page.locator(`#${tabId}`).click();
  const ancestors = target.locator('xpath=ancestor::details');
  for (let index = 0; index < await ancestors.count(); index++) {
    const details = ancestors.nth(index);
    if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  }
}

/** Settings are reached through the visible bottom-left disclosure. */
export async function openWorkbenchSettings(page, tab='translation') {
  if (!await page.getByTestId('settings-layout').isVisible()) {
    await page.getByTestId('sidebar-footer-menu').click();
    await page.getByTestId('settings-open').click({timeout:5000}).catch(async error=>{if(!await page.getByTestId('settings-layout').isVisible())throw error;});
  }
  await page.getByTestId(tab==='connections'?'nav-connections':tab==='capabilities'?'nav-capabilities':tab==='archive'?'sidebar-archive':`settings-${tab==='translation'?'plugins':tab}`).click();
  if(tab==='translation') { await page.getByRole('tab',{name:'工作台插件',exact:true}).click(); if(await page.getByTestId('translation-plugin-expand').getAttribute('aria-expanded')==='false')await page.getByTestId('translation-plugin-expand').click(); }
}
export async function navigateWorkbench(page, destination) {
  if(destination==='workspace') {
    if(await page.getByTestId('settings-layout').isVisible())await page.getByTestId('nav-workspace').click();
  } else await openWorkbenchSettings(page,destination);
}
