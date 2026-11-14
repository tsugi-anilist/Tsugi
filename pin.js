// Tsugi: picks up your login after you approve the app on AniList.
// AniList sends you to this page with your access token; the extension saves it
// and closes the tab.
(() => {
  'use strict';
  const fromHash = (text) => {
    const m = /(?:^|[#&?])access_token=([^&]+)/.exec(text || '');
    return m ? decodeURIComponent(m[1]) : null;
  };
  const expires = /(?:^|[#&?])expires_in=(\d+)/.exec(location.hash);

  function banner(ok, text) {
    const put = () => {
      const el = document.createElement('div');
      el.setAttribute('style', [
        'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
        'padding:12px 18px', 'border-radius:12px', 'font:600 14px/1.4 system-ui,sans-serif',
        `background:${ok ? '#1f9d55' : '#c53030'}`, 'color:#fff', 'box-shadow:0 12px 30px -10px rgba(0,0,0,.5)',
      ].join(';'));
      el.textContent = text;
      document.body.append(el);
    };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put, { once: true });
  }

  function send(token, expiresIn) {
    try {
      chrome.runtime.sendMessage({ type: 'auth:token', token, expiresIn }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok) banner(true, `Tsugi is connected as ${res.name}. You can close this tab.`);
        else banner(false, `Tsugi couldn't connect: ${(res && res.error) || 'unknown error'}`);
      });
    } catch { /* extension reloaded */ }
  }

  const token = fromHash(location.hash);
  if (token) { send(token, expires ? Number(expires[1]) : null); return; }

  // If AniList shows the token on the page instead of in the address, find it there.
  // The page draws itself after loading, so keep looking for a little while.
  const started = Date.now();
  function look() {
    const texts = Array.from(document.querySelectorAll('textarea, input, code, pre')).map((n) => n.value || n.textContent);
    texts.push(document.body ? document.body.innerText : '');
    for (const t of texts) {
      const m = /eyJ[\w-]+\.[\w-]+\.[\w-]+/.exec(t || '');
      if (m) { send(m[0], null); return; }
    }
    if (Date.now() - started < 20000) setTimeout(look, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look, { once: true });
  else look();
})();
