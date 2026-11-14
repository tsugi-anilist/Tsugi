// Tsugi: a tiny helper that runs inside AniList's own page.
// The extension's main code runs in a separate, private context, so it asks this
// helper for the two things only the page itself can do.
(() => {
  'use strict';

  // Stops the old "AniList Priority" userscript from running a second copy.
  window.__apqLoaded = true;

  // 1. Hand over AniList's session token, so edits work with your normal login.
  window.addEventListener('apq:get-token', () => {
    let token = '';
    try { token = String(window.al_token || ''); } catch { /* not there */ }
    window.dispatchEvent(new CustomEvent('apq:token', { detail: token }));
  });

  // 2. Ask AniList's list page to render more rows without scrolling the page:
  //    for a moment the window reports a very tall height, then it's put back.
  //    AniList adds 30 rows per scroll event and draws them afterwards (its lists bundle, read 2026-11-14:
  //    renderListEntries raises one shared limit, Vue draws on its next tick), so `detail` scroll events in a
  //    row ask for that many times 30 rows, drawn at once (0.12.8; one at a time took a round each).
  window.addEventListener('apq:nudge', (ev) => {
    const times = Math.max(1, Math.min(200, Math.floor(Number(ev && ev.detail) || 1)));
    const html = document.documentElement;
    const tall = Math.max(html.scrollHeight, document.body ? document.body.scrollHeight : 0) * 4 + 100000;
    const undo = [];
    const fake = (obj, key) => {
      const own = Object.getOwnPropertyDescriptor(obj, key);
      try {
        Object.defineProperty(obj, key, { configurable: true, get: () => tall });
        undo.push(() => {
          try { if (own) Object.defineProperty(obj, key, own); else delete obj[key]; } catch { /* ignore */ }
        });
      } catch { /* not overridable */ }
    };
    fake(window, 'innerHeight');
    fake(html, 'clientHeight');
    try {
      for (let i = 0; i < times; i++) window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('scroll'));
    } catch { /* ignore */ }
    setTimeout(() => undo.forEach((f) => f()), 60);
  });

  // 3. Tell the extension about list changes AniList's own page saves (its + buttons, the
  //    Add to List menu), so it can fill in a start or finish date, and about the entries it
  //    removes (its editor's Delete), so the other trackers follow (0.10.1). Requests and answers
  //    are only read, never changed, and anything unexpected is ignored.
  const isListSave = (url, body) => typeof body === 'string' && /graphql/.test(String(url || '')) &&
    /SaveMediaListEntry|DeleteMediaListEntry/.test(body) && /mutation/.test(body);
  const report = (body, json) => {
    try {
      if (!json || !json.data) return;
      const sent = JSON.parse(body);
      window.dispatchEvent(new CustomEvent('apq:site-save', {
        detail: JSON.stringify({ query: sent.query || '', variables: sent.variables || {}, data: json.data }),
      }));
    } catch { /* not for us */ }
  };
  try {
    const realFetch = window.fetch;
    window.fetch = function (input, init) {
      const p = realFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        const body = init && init.body;
        if (isListSave(url, body)) p.then((res) => res.clone().json()).then((json) => report(body, json)).catch(() => {});
      } catch { /* ignore */ }
      return p;
    };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__apqUrl = url; } catch { /* ignore */ }
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (isListSave(this.__apqUrl, body)) {
          this.addEventListener('load', () => {
            try { report(body, JSON.parse(this.responseText)); } catch { /* not json */ }
          });
        }
      } catch { /* ignore */ }
      return send.apply(this, arguments);
    };
  } catch { /* leave the page as it is */ }
})();
