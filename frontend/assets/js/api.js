// =============================================================================
// API BRIDGE — HTTP RPC zamiast Tauri invoke
// Wszystkie wywołania idą przez POST /api/rpc
// =============================================================================

(function() {
    'use strict';

    /**
     * Uniwersalne wywołanie RPC — zastępuje Tauri invoke.
     */
    async function rpcInvoke(cmd, args = {}) {
        const resp = await fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd, args })
        });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText || 'RPC error: ' + cmd);
        }
        return await resp.json();
    }

    // =========================================================================
    // FETCH POLYFILL — przekierowuje stare Flaskowe /api/* na RPC
    // =========================================================================
    const originalFetch = window.fetch;

    const API_MAP = {
        '/api/dzialki':                  { cmd: 'api_dzialki' },
        '/api/wlasciciele':              { cmd: 'api_wlasciciele' },
        '/api/stats':                    { cmd: 'pobierz_statystyki' },
        '/api/graph-data':               { cmd: 'pobierz_dane_graful' },
        '/api/genealogia/persons-format': { cmd: 'api_genealogia_persons' },
    };

    function matchDynamic(url) {
        let m = url.match(/\/api\/wlasciciel\/(.+)/);
        if (m) return { cmd: 'api_wlasciciel', args: { klucz: m[1] } };
        m = url.match(/\/api\/genealogia\/(.+)/);
        if (m) return { cmd: 'api_genealogia_tree', args: { klucz: m[1] } };
        return null;
    }

    window.fetch = async function(url, options) {
        const urlStr = typeof url === 'string' ? url : url.url;
        let handler = API_MAP[urlStr] || matchDynamic(urlStr);

        if (handler) {
            try {
                const data = await rpcInvoke(handler.cmd, handler.args || {});
                return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
            } catch (e) {
                console.error('[API ERROR]', handler.cmd, e);
                return { ok: false, status: 500, json: async () => { throw new Error(String(e)); } };
            }
        }
        return originalFetch(url, options);
    };

    console.log('[API] HTTP RPC bridge — gotowy');

    // =========================================================================
    // OBIEKT API — bezpośredni wrapper dla kodu JS
    // =========================================================================
    window.API = {
        async _invoke(cmd, args = {}) {
            return await rpcInvoke(cmd, args);
        },

        wlasciciele: {
            pobierzWszystkich() {
                return API._invoke('pobierz_wszystkich_wlascicieli');
            },
            pobierz(id) {
                return API._invoke('pobierz_wlasciciela', { id });
            },
            szukaj(query) {
                return API._invoke('szukaj_wlascicieli', { query });
            },
            dodaj(wlasciciel) {
                return API._invoke('dodaj_wlasciciela', wlasciciel);
            },
            aktualizuj(wlasciciel) {
                return API._invoke('aktualizuj_wlasciciela', wlasciciel);
            },
            usun(id) {
                return API._invoke('usun_wlasciciela', { id });
            },
            pobierzObiekty() {
                return API._invoke('pobierz_wszystkie_obiekty_admin');
            },
            zapiszAdmin(data) {
                return API._invoke('zapisz_wlasciciela_admin', data);
            },
        },

        mapa: {
            pobierzObiektyWidok(swLat, swLng, neLat, neLng) {
                return API._invoke('pobierz_obiekty_widok', { sw_lat: swLat, sw_lng: swLng, ne_lat: neLat, ne_lng: neLng });
            },
            pobierzWlascicieliObiektu(obiektId) {
                return API._invoke('pobierz_wlascicieli_obiektu', { obiekt_id: obiektId });
            },
        },

        genealogia: {
            pobierzDrzewo() {
                return API._invoke('pobierz_drzewo_genealogiczne');
            },
            pobierzEditor() {
                return API._invoke('pobierz_genealogie_editor');
            },
            zapiszEditor(people) {
                return API._invoke('zapisz_genealogie_editor', { people });
            },
        },

        demografia: {
            pobierz() {
                return API._invoke('pobierz_demografie');
            },
            zapisz(rows) {
                return API._invoke('zapisz_demografie', { rows });
            },
        },

        miejscowosci: {
            lista() {
                return API._invoke('miejscowosci_lista');
            },
            aktywna() {
                return API._invoke('miejscowosci_aktywna');
            },
            ustawAktywna(id) {
                return API._invoke('miejscowosci_ustaw_aktywna', { id });
            },
            ustawAutostart(autoOpen) {
                return API._invoke('miejscowosci_ustaw_autostart', { auto_open: autoOpen });
            },
            dodaj(location) {
                return API._invoke('miejscowosci_dodaj', location);
            },
            aktualizuj(location) {
                return API._invoke('miejscowosci_aktualizuj', location);
            },
            usun(id) {
                return API._invoke('miejscowosci_usun', { id });
            },
            infoMapy() {
                return API._invoke('miejscowosci_info_mapy');
            },
            zapiszKalibracje(calibration, defaults) {
                return API._invoke('miejscowosci_zapisz_kalibracje', { calibration, defaults });
            },
            zapiszMape(dataUrl) {
                return API._invoke('miejscowosci_zapisz_mape', { data_url: dataUrl });
            },
            dodajZdjecieHistorii(dataUrl, filename, caption) {
                return API._invoke('miejscowosci_dodaj_zdjecie_historii', { data_url: dataUrl, filename, caption });
            },
            dodajZdjeciaHistorii(photos) {
                return API._invoke('miejscowosci_dodaj_zdjecia_historii', { photos });
            },
            usunZdjecieHistorii(filename) {
                return API._invoke('miejscowosci_usun_zdjecie_historii', { filename });
            },
            zmienPodpisZdjeciaHistorii(filename, caption) {
                return API._invoke('miejscowosci_zmien_podpis_zdjecia_historii', { filename, caption });
            },
            przesunZdjecieHistorii(filename, direction) {
                return API._invoke('miejscowosci_przesun_zdjecie_historii', { filename, direction });
            },
            ustawKolejnoscZdjecHistorii(filenames) {
                return API._invoke('miejscowosci_ustaw_kolejnosc_zdjec_historii', { filenames });
            },
            eksportJSON() {
                return API._invoke('miejscowosci_eksport_json');
            },
            pelnyBackup(options) {
                return API._invoke('miejscowosci_pelny_backup', options || {});
            },
            importJSON(files) {
                return API._invoke('miejscowosci_import_json', { files });
            },
        },

        protokoly: {
            lista() {
                return API._invoke('lista_protokolow');
            },
            pobierzListe() {
                return API._invoke('lista_protokolow');
            },
            ladujZdjecia(klucz) {
                return API._invoke('laduj_zdjecia_protokolu', { nazwa_wlasciciela: klucz });
            },
            listaZdjec(klucz) {
                return API._invoke('lista_zdjec_protokolu', { nazwa_wlasciciela: klucz });
            },
            dodajZdjecie(klucz) {
                return API._invoke('dodaj_zdjecie_protokolu', { nazwa_wlasciciela: klucz });
            },
            usunZdjecie(klucz, nazwaPliku) {
                return API._invoke('usun_zdjecie_protokolu', { nazwa_wlasciciela: klucz, nazwa_pliku: nazwaPliku });
            },
            pobierzZdjecie(klucz, nazwaPliku) {
                return API._invoke('pobierz_zdjecie_protokolu', { nazwa_wlasciciela: klucz, nazwa_pliku: nazwaPliku });
            },
            ustawNumer(klucz, nazwaPliku, nowyNumer) {
                return API._invoke('ustaw_numer_zdjecia_protokolu', { nazwa_wlasciciela: klucz, nazwa_pliku: nazwaPliku, nowy_numer: nowyNumer });
            },
            przesun(klucz, nazwaPliku, kierunek) {
                return API._invoke('przesun_zdjecie_protokolu', { nazwa_wlasciciela: klucz, nazwa_pliku: nazwaPliku, kierunek });
            },
        },
    };

})();
