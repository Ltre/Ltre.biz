// 点击扩展图标 → 向当前页面注入申报价模板工具
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['country-price-template.js']
    });
  } catch (err) {
    console.error('注入失败:', err.message);
    // 某些受限页面（chrome:// 等）无法注入，静默忽略
  }
});
