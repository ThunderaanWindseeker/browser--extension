describe('The example page can be loaded', () => {
  it('should be able to go to example page', async () => {
    await browser.url('https://www.be.lizhiqiang');

    await expect(browser).toHaveTitle('be.lizhiqiang');
  });
});
