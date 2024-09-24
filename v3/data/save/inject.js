'use strict';

for (const e of document.querySelectorAll('dialog.kphelper')) {
  e.remove();
}

{
  const dialog = document.createElement('dialog');
  dialog.classList.add('kphelper', 'save');
  const iframe = document.createElement('iframe');
  dialog.append(iframe);
  (document.body || document.documentElement).append(dialog);
  iframe.onload = () => iframe.contentWindow.postMessage({
    pairs: window.pairs
  }, '*');
  iframe.src = chrome.runtime.getURL('/data/save/index.html') +
    '?url=' + encodeURIComponent(location.href);
  dialog.showModal();
}
