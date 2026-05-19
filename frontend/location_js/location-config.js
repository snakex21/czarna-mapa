// =============================================================================
// LOCATION-CONFIG.JS — Konfiguracja dla Tauri (zastępuje serwerowe wstrzykiwanie)
// =============================================================================
window.LOCATION_CONFIG = {
    name: "Czarna",
    fullName: "Czarna",
    powiat: "Debicki",
    region: "Malopolska",
    year: "1882",
    century: "XIX w.",
    homepageDescription: "Odkryj historie zapisana w ziemi."
};

// MAP_CONFIG dla mapy Leaflet — ładowane z bazy
window.MAP_CONFIG = {
    calibration: {
        sw: { lat: 50.0445278, lng: 21.2118201 },
        ne: { lat: 50.07663863, lng: 21.26721485 }
    },
    defaults: {
        center: { lat: 50.0614, lng: 21.2461 },
        zoom: 14
    }
};

// Asynchronicznie załaduj prawdziwą konfigurację z bazy
(async function() {
    try {
        if (window.__TAURI_INTERNALS__) {
            const config = await window.__TAURI_INTERNALS__.invoke('pobierz_konfiguracje_mapy');
            if (config) {
                window.MAP_CONFIG = config;
                console.log('[CONFIG] MAP_CONFIG zaladowane z bazy');
            }
        }
    } catch(e) {
        console.warn('[CONFIG] Uzywam domyslnej konfiguracji:', e);
    }
})();
