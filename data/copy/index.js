const args = new URLSearchParams(location.search);

let content;
const button = document.getElementById('copy');
button.disabled = true;
const copy = e => navigator.clipboard.writeText(content).then(() => {
  setTimeout(() => chrome.runtime.sendMessage({
    cmd: 'notify',
    message: 'Done',
    badge: '✓',
    color: 'green'
  }, () => window.close()), e && e.isTrusted ? 0 : 1000);
}).catch(error => { if (e?.isTrusted) alert(error.message); });

chrome.runtime.sendMessage({cmd: 'copy-payload', id: args.get('id')}).then(result => {
  if (!result?.ok) throw Error(result?.error || 'Clipboard request unavailable');
  content = result.content;
  button.disabled = false;
  copy();
}).catch(error => { button.value = error.message; });
button.addEventListener('click', copy);
