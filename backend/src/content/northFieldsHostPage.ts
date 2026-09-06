/**
 * Host page for the mobile app's WebView. It is served from our own API
 * domain (registered with North as an allowed checkout domain) so North's
 * production frame-ancestors policy sees a real, whitelisted parent origin
 * instead of a synthetic one.
 *
 * The page carries no session token. React Native waits for the
 * `host-ready` message, then injects `window.__sfMount(<token>)`; later it
 * injects `window.__sfSubmit()` when the user taps Pay / Save. Results come
 * back as JSON messages: fields-ready | fields-result | fields-error.
 *
 * Pure function of the script URL — unit tested in test/northFieldsHostPage.test.ts.
 */
export function renderNorthFieldsHostPage(scriptUrl: string): string {
  // Escape "<" so the value can never terminate the inline script element.
  const safeScriptUrl = JSON.stringify(scriptUrl).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <title>Secure Payment</title>
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #fields-root { width: 100%; min-height: 260px; padding: 8px; box-sizing: border-box; }
      #fields-root iframe { width: 100% !important; border: 0; display: block; }
      #status { color: #5f6b68; font-size: 14px; text-align: center; margin: 16px 0 8px; }
      #error { color: #c0352b; font-size: 14px; text-align: center; margin: 16px 0; display: none; }
    </style>
  </head>
  <body>
    <div id="status">Loading secure payment form…</div>
    <div id="error"></div>
    <div id="fields-root"></div>
    <script>
      (function () {
        var scriptUrl = ${safeScriptUrl};
        var statusEl = document.getElementById('status');
        var errorEl = document.getElementById('error');
        var busy = false;
        var mounted = false;
        var scriptPromise = null;
        function send(message) {
          if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
            window.ReactNativeWebView.postMessage(JSON.stringify(message));
          }
        }
        function showError(message) {
          if (statusEl) statusEl.style.display = 'none';
          if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = message; }
          send({ type: 'fields-error', message: message });
        }
        function loadScript() {
          if (window.checkout && typeof window.checkout.mount === 'function') return Promise.resolve();
          if (scriptPromise) return scriptPromise;
          scriptPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = scriptUrl;
            script.async = true;
            script.onload = function () {
              if (window.checkout && typeof window.checkout.mount === 'function') resolve();
              else { scriptPromise = null; reject(new Error('North checkout API did not load correctly.')); }
            };
            script.onerror = function () { scriptPromise = null; reject(new Error('Unable to load North checkout script.')); };
            document.head.appendChild(script);
          });
          return scriptPromise;
        }
        window.__sfMount = function (sessionToken) {
          if (mounted || typeof sessionToken !== 'string' || !sessionToken) return;
          mounted = true;
          loadScript()
            .then(function () { return window.checkout.mount(sessionToken, 'fields-root'); })
            .then(function () { if (statusEl) statusEl.style.display = 'none'; send({ type: 'fields-ready' }); })
            .catch(function (err) { mounted = false; showError(err && err.message ? err.message : 'Unable to open the payment form.'); });
        };
        window.__sfSubmit = function () {
          if (busy) return;
          if (!mounted || !window.checkout || typeof window.checkout.submit !== 'function') { showError('The payment form is not ready.'); return; }
          busy = true;
          Promise.resolve(window.checkout.submit())
            .then(function (result) { busy = false; send({ type: 'fields-result', result: result || { type: 'failure', data: {} } }); })
            .catch(function (err) {
              busy = false;
              showError(err && err.message === 'Submit timeout'
                ? 'The payment is taking longer than expected. Please try again.'
                : (err && err.message) || 'The payment could not be submitted.');
            });
        };
        if (!window.ReactNativeWebView) {
          if (statusEl) statusEl.textContent = 'This page is used by the Boxer Solutions app to take payments.';
        }
        send({ type: 'host-ready' });
      })();
    </script>
  </body>
</html>`;
}
