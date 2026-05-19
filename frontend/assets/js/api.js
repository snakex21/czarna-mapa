// =============================================================================
// TAURI API POLYFILL v2 — backend zwraca identyczny format jak Flask.
// Polyfill tylko przekierowuje fetch -> invoke, bez transformacji.
// =============================================================================

(function() {
    'use strict';

    const originalFetch = window.fetch;

    // Mapa endpointów Flask → Tauri invoke() (back-end zwraca identyczny JSON)
    const API_MAP = {
        '/api/dzialki':                 { cmd: 'api_dzialki' },
        '/api/wlasciciele':             { cmd: 'api_wlasciciele' },
        '/api/stats':                   { cmd: 'pobierz_statystyki' },
        '/api/graph-data':              { cmd: 'pobierz_dane_grafu' },
        '/api/genealogia/persons-format':{ cmd: 'api_genealogia_persons' },
    };

    function matchDynamic(url) {
        let m = url.match(/\/api\/wlasciciel\/(.+)/);
        if (m) return { cmd: 'api_wlasciciel', args: { klucz: m[1] } };
        m = url.match(/\/api\/genealogia\/(.+)/);
        if (m) return { cmd: 'pobierz_genealogie_wlasciciela', args: { klucz: m[1] } };
        return null;
    }

    async function tauriInvoke(cmd, args) {
        if (window.__TAURI_INTERNALS__?.invoke) {
            return await window.__TAURI_INTERNALS__.invoke(cmd, args || {});
        }
        console.warn('[TAURI-MOCK]', cmd, args);
        return null;
    }

    window.fetch = async function(url, options) {
        const urlStr = typeof url === 'string' ? url : url.url;
        let handler = API_MAP[urlStr] || matchDynamic(urlStr);

        if (handler) {
            try {
                const data = await tauriInvoke(handler.cmd, handler.args || {});
                console.log('[API]', handler.cmd, '<-', JSON.stringify(data).substring(0, 300));
                return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
            } catch (e) {
                console.error('[API ERROR]', handler.cmd, e);
                return { ok: false, status: 500, json: async () => { throw new Error(String(e)); } };
            }
        }
        return originalFetch(url, options);
    };

    console.log('[TAURI] Polyfill v2 — zgodny z formatem Flask API');
})();
