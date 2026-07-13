import 'webextension-polyfill';

const initBackground = async () => {
  try {
    chrome.runtime.onInstalled.addListener(() => {
      console.log('Background installed');
    });

    console.log('Background loaded');
  } catch (error) {
    console.error('Background initialization failed:', error);
  }
};

void initBackground();
