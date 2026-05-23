/* ==========================================================================
   Plik: map-script-v2.js
   Opis: MapLibre GL JS — silnik mapy katastralnej (Faza 2 rdzeń).
         Eksponuje API window.MapV2 dla panels.js.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', initializeAppV2);

let map = null;
let allOwnersData = [];
let allParcelsData = [];
let historicalOpacity = 1.0;

// Cache features po id — paneli i URL parametry mogą szybko sięgnąć po geometrię.
const featuresById = new Map();

// Stan podświetleń
let highlightFeatureIds = new Set();   // żółte/fuksjowe trwałe podświetlenie
let highlightColor = '#ffc107';
let ownerHoverIds = new Set();         // tymczasowe (hover karty właściciela)
let temporaryHighlightIds = new Set(); // tymczasowe (search exact match)
let hoveredFromPanelId = null;         // pojedyncza działka highlightowana z panelu

// Mapa: feature id → { ownerName, ownershipType, ownerLp }
// Pozwala pokazać tooltip na hover zaznaczonej działki bez ponownego skanowania danych.
const highlightOwnerInfo = new Map();

// Markery "Lp.X" — HTML-owe plakietki nakładane na środek zaznaczonych działek.
// MapLibre nie pozwala używać `feature-state` w layout (text-field), więc dla
// dynamicznych etykiet używamy maplibregl.Marker — automatycznie pozycjonują się
// przy panowaniu/zoom mapy. Wpisujemy tu instancje, żeby je później sprzątać.
const lpMarkers = new Map();  // feature id → maplibregl.Marker

// Faza 3: kolorowanie wielu właścicieli (highlightTopOwners) i focus mode (dimming).
// Dla każdej działki możemy zapisać per-feature-state "ownerColor" (string) — paint expression
// pickuje go zamiast standardowego koloru kategorii.
let ownerColoredIds = new Set();
let focusedIds = null;                 // null = brak focus mode; Set = działki w fokusie (reszta dimmed)

const PARCEL_COLORS = {
    budowlana: '#e67e22',
    rolna: '#27ae60',
    las: '#1abc9c',
    droga: '#8B4513',
    rzeka: '#3498db',
    pastwisko: '#f1c40f',
    obrys_miejscowosci: '#ff0000',
    obiekt_specjalny: '#2c3e50',
    default: '#3388ff',
};

const PARCEL_FILL_OPACITY = {
    las: 0.5,
    pastwisko: 0.4,
    default: 0.0,
};

function initializeAppV2() {
    console.log('🚀 MapLibre v2 startuje');
    initializeMapV2();
    fetchDataAndBuildV2();
}

function initializeMapV2() {
    const calibration = window.MAP_CONFIG?.calibration || {
        sw: { lat: 50.0445232994271194, lng: 21.2118218969993393 },
        ne: { lat: 50.0766374787729518, lng: 21.2672168223566409 }
    };
    const defaults = window.MAP_CONFIG?.defaults || {
        center: { lat: 50.0605803891, lng: 21.2395193597 },
        zoom: 14
    };

    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                satellite: {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: 'Tiles &copy; Esri'
                },
                osm: {
                    type: 'raster',
                    tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: '&copy; OpenStreetMap contributors'
                },
                historical: {
                    type: 'image',
                    url: '/mapa/mapa.jpg',
                    coordinates: [
                        [calibration.sw.lng, calibration.ne.lat],
                        [calibration.ne.lng, calibration.ne.lat],
                        [calibration.ne.lng, calibration.sw.lat],
                        [calibration.sw.lng, calibration.sw.lat],
                    ]
                }
            },
            layers: [
                { id: 'satellite-layer', type: 'raster', source: 'satellite' },
                { id: 'osm-layer', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
                { id: 'historical-layer', type: 'raster', source: 'historical', paint: { 'raster-opacity': historicalOpacity } }
            ]
        },
        center: [defaults.center.lng, defaults.center.lat],
        zoom: defaults.zoom,
        minZoom: 12,
        maxZoom: 22,
        maxBounds: [
            [calibration.sw.lng - 0.02, calibration.sw.lat - 0.02],
            [calibration.ne.lng + 0.02, calibration.ne.lat + 0.02]
        ],
        attributionControl: false,
        renderWorldCopies: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on('mousemove', (e) => {
        const div = document.getElementById('mouse-coordinates');
        if (div) div.innerHTML = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
    });

    setupHistoricalOpacityControl();
    console.log('✅ Mapa MapLibre zainicjalizowana');
}

function loadPointIcons() {
    // Te same ikony co w v1 (Flaticon CDN). MapLibre wymaga PNG/SVG-bitmap.
    const icons = {
        'icon-budynek': 'https://cdn-icons-png.flaticon.com/512/25/25694.png',
        'icon-kapliczka': 'https://cdn-icons-png.flaticon.com/512/2133/2133353.png',
        'icon-obiekt-specjalny': 'https://cdn-icons-png.flaticon.com/512/785/785432.png',
    };
    Object.entries(icons).forEach(([name, url]) => {
        if (map.hasImage(name)) return;
        map.loadImage(url).then(img => {
            if (img && !map.hasImage(name)) {
                map.addImage(name, img.data, { pixelRatio: 2 });
            }
        }).catch(err => {
            console.warn(`Nie udało się załadować ikony ${name}:`, err);
        });
    });
}

function setupHistoricalOpacityControl() {
    const slider = document.getElementById('opacitySlider')
        || document.getElementById('historical-opacity')
        || document.getElementById('historical-opacity-slider');
    if (!slider) return;
    slider.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        const opacity = v > 1 ? v / 100 : v;
        historicalOpacity = opacity;
        if (map.getLayer('historical-layer')) {
            map.setPaintProperty('historical-layer', 'raster-opacity', opacity);
        }
        const pct = document.getElementById('opacityPercentage') || document.getElementById('opacity-percentage');
        if (pct) pct.textContent = Math.round(opacity * 100);
    });
}

function fetchDataAndBuildV2() {
    Promise.all([
        fetch('/api/dzialki').then(r => r.json()),
        fetch('/api/wlasciciele').then(r => r.json()),
    ]).then(([dzialki, wlasciciele]) => {
        allParcelsData = dzialki.features || dzialki;
        allOwnersData = wlasciciele.owners || wlasciciele;

        // Index features po id dla szybkiego dostępu z paneli/URL.
        featuresById.clear();
        for (const f of allParcelsData) {
            const id = f.id ?? f.properties?.id;
            if (id != null) {
                f.id = id;
                featuresById.set(String(id), f);
            }
        }

        if (map.isStyleLoaded()) {
            renderMapDataV2();
        } else {
            map.once('load', renderMapDataV2);
        }

        // Inicjalizacja paneli — czekamy aż mapa jest gotowa, ale panele i tak operują na danych.
        if (window.PanelsV2) {
            window.PanelsV2.init({ owners: allOwnersData, parcels: allParcelsData });
        }

        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }).catch(err => {
        console.error('❌ Błąd ładowania danych', err);
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    });
}

function renderMapDataV2() {
    if (!allParcelsData?.length) {
        console.error('❌ Brak działek');
        return;
    }

    const polygons = { type: 'FeatureCollection', features: [] };
    const lines = { type: 'FeatureCollection', features: [] };
    const points = { type: 'FeatureCollection', features: [] };

    for (const f of allParcelsData) {
        if (!f.geometry) continue;
        const t = f.geometry.type;
        if (t === 'Polygon' || t === 'MultiPolygon') polygons.features.push(f);
        else if (t === 'LineString' || t === 'MultiLineString') lines.features.push(f);
        else if (t === 'Point') points.features.push(f);
    }

    // Uwaga: NIE używamy promoteId - GeoJSON features mają id na top-level (z API).
    // promoteId: 'id' szuka id w `properties`, a tam go nie ma → feature.id staje się undefined
    // i wszystkie setFeatureState (highlight/hover) przestają działać.
    map.addSource('parcels', { type: 'geojson', data: polygons, buffer: 64, tolerance: 0.5, maxzoom: 18 });
    map.addSource('lines', { type: 'geojson', data: lines, buffer: 64, tolerance: 0.5, maxzoom: 18 });
    map.addSource('points', { type: 'geojson', data: points, cluster: true, clusterMaxZoom: 16, clusterRadius: 50, buffer: 64, tolerance: 0.5, maxzoom: 18 });

    const NON_OUTLINE_FILTER = ['!=', ['get', 'kategoria'], 'obrys_miejscowosci'];

    map.addLayer({
        id: 'parcels-fill', type: 'fill', source: 'parcels', filter: NON_OUTLINE_FILTER,
        paint: {
            'fill-color': [
                'case',
                ['boolean', ['feature-state', 'ownerColored'], false], ['coalesce', ['feature-state', 'ownerColor'], '#3388ff'],
                ['boolean', ['feature-state', 'highlight'], false], ['coalesce', ['feature-state', 'highlightColor'], '#ffc107'],
                ['boolean', ['feature-state', 'ownerHover'], false], '#a855f7',
                ['boolean', ['feature-state', 'tempHighlight'], false], 'orange',
                ['match', ['get', 'kategoria'],
                    'budowlana', PARCEL_COLORS.budowlana,
                    'rolna', PARCEL_COLORS.rolna,
                    'las', PARCEL_COLORS.las,
                    'pastwisko', PARCEL_COLORS.pastwisko,
                    'obiekt_specjalny', PARCEL_COLORS.obiekt_specjalny,
                    PARCEL_COLORS.default]
            ],
            'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'dimmed'], false], 0.05,
                // Highlight wg protokołu — przezroczyste (cieńsza plama), rzeczywiste — pełne
                ['all',
                    ['boolean', ['feature-state', 'highlight'], false],
                    ['boolean', ['feature-state', 'isProtocol'], false]
                ], 0.22,
                ['boolean', ['feature-state', 'ownerColored'], false], 0.6,
                ['boolean', ['feature-state', 'highlight'], false], 0.55,
                ['boolean', ['feature-state', 'ownerHover'], false], 0.45,
                ['boolean', ['feature-state', 'tempHighlight'], false], 0.4,
                ['boolean', ['feature-state', 'hover'], false], 0.55,
                ['match', ['get', 'kategoria'],
                    'las', PARCEL_FILL_OPACITY.las,
                    'pastwisko', PARCEL_FILL_OPACITY.pastwisko,
                    'budowlana', 0.18,
                    'rolna', 0.22,
                    PARCEL_FILL_OPACITY.default]
            ]
        }
    });

    // Ciemne "halo" pod granicami działek — przywraca czarne krawędzie znane ze starej
    // wersji/oryginalnego podkładu. Rysowane pod kolorową linią, więc kolor kategorii
    // dalej jest widoczny, ale granica ma czytelny czarny kontur.
    map.addLayer({
        id: 'parcels-line-halo', type: 'line', source: 'parcels', filter: NON_OUTLINE_FILTER,
        paint: {
            'line-color': '#111111',
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                12, 1.2,
                15, 1.8,
                18, 3.0,
                22, 4.5
            ],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'dimmed'], false], 0.16,
                0.45
            ]
        }
    });

    map.addLayer({
        id: 'parcels-line', type: 'line', source: 'parcels', filter: NON_OUTLINE_FILTER,
        paint: {
            'line-color': [
                'case',
                ['boolean', ['feature-state', 'ownerColored'], false], ['coalesce', ['feature-state', 'ownerColor'], '#3388ff'],
                ['boolean', ['feature-state', 'highlight'], false], ['coalesce', ['feature-state', 'highlightColor'], '#ffc107'],
                ['boolean', ['feature-state', 'ownerHover'], false], '#a855f7',
                ['boolean', ['feature-state', 'tempHighlight'], false], 'orange',
                ['boolean', ['feature-state', 'hover'], false], '#ff0000',
                ['match', ['get', 'kategoria'],
                    'budowlana', PARCEL_COLORS.budowlana,
                    'rolna', PARCEL_COLORS.rolna,
                    'las', '#16a085',
                    'pastwisko', '#f1c40f',
                    'obrys_miejscowosci', PARCEL_COLORS.obrys_miejscowosci,
                    'obiekt_specjalny', PARCEL_COLORS.obiekt_specjalny,
                    PARCEL_COLORS.default]
            ],
            'line-width': [
                'case',
                ['boolean', ['feature-state', 'ownerColored'], false], 3,
                // Protokół — grubszy obrys (5px), reszta normalnie
                ['all',
                    ['boolean', ['feature-state', 'highlight'], false],
                    ['boolean', ['feature-state', 'isProtocol'], false]
                ], 5,
                ['boolean', ['feature-state', 'highlight'], false], 4,
                ['boolean', ['feature-state', 'ownerHover'], false], 4,
                ['boolean', ['feature-state', 'tempHighlight'], false], 4,
                ['boolean', ['feature-state', 'hover'], false], 4,
                3
            ],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'dimmed'], false], 0.2,
                1
            ]
        }
    });

    // Obrys miejscowości — widoczny, ale NIE jest interaktywny (klik/hover nadal
    // obsługują tylko parcels-fill, który wyklucza obrys). Dzięki temu nie wyskakuje
    // popup obrysu, ale granica miejscowości wraca na mapę.
    map.addLayer({
        id: 'settlement-outline', type: 'line', source: 'parcels',
        filter: ['==', ['get', 'kategoria'], 'obrys_miejscowosci'],
        paint: {
            'line-color': '#ef4444',
            'line-width': 2,
            'line-opacity': 0.65,
            'line-dasharray': ['literal', [3, 1.5]]
        }
    });

    map.addLayer({
        id: 'lines-layer', type: 'line', source: 'lines',
        paint: {
            'line-color': [
                'case',
                ['boolean', ['feature-state', 'highlight'], false], ['coalesce', ['feature-state', 'highlightColor'], '#ffc107'],
                ['match', ['get', 'kategoria'], 'droga', PARCEL_COLORS.droga, 'rzeka', PARCEL_COLORS.rzeka, PARCEL_COLORS.default]
            ],
            'line-width': [
                'case',
                ['boolean', ['feature-state', 'highlight'], false], 6,
                ['match', ['get', 'kategoria'], 'rzeka', 4, 'droga', 3, 2]
            ],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'dimmed'], false], 0.2,
                1
            ]
        }
    });

    map.addLayer({
        id: 'parcels-labels', type: 'symbol', source: 'parcels',
        filter: ['!=', ['get', 'kategoria'], 'obrys_miejscowosci'],
        layout: {
            'text-field': ['get', 'numer_obiektu'],
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'symbol-placement': 'point',
            'text-anchor': 'center',
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }
    });

    map.addLayer({
        id: 'points-clusters', type: 'circle', source: 'points',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': '#4363D8',
            'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 50, 28],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        }
    });
    map.addLayer({
        id: 'points-cluster-count', type: 'symbol', source: 'points',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
        paint: { 'text-color': '#ffffff' }
    });

    // Warstwa ikon — `symbol` z icon-image. Domyślnie używa ikon PNG dodanych w loadPointIcons().
    // Fallback color circle pod spodem (na wypadek gdyby ikony nie zdążyły się załadować).
    map.addLayer({
        id: 'points-circle-fallback', type: 'circle', source: 'points',
        filter: ['all', ['!', ['has', 'point_count']], ['!', ['has', 'icons_loaded']]],
        minzoom: 13,
        paint: {
            'circle-color': ['match', ['get', 'kategoria'], 'budynek', '#e67e22', 'kapliczka', '#9b59b6', 'obiekt_specjalny', '#2c3e50', '#3388ff'],
            'circle-radius': 7,
            'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        }
    });

    map.addLayer({
        id: 'points-icons', type: 'symbol', source: 'points',
        filter: ['!', ['has', 'point_count']],
        minzoom: 13,
        layout: {
            'icon-image': [
                'match', ['get', 'kategoria'],
                'budynek', 'icon-budynek',
                'kapliczka', 'icon-kapliczka',
                'obiekt_specjalny', 'icon-obiekt-specjalny',
                'icon-budynek'
            ],
            'icon-size': [
                'match', ['get', 'kategoria'],
                'budynek', 0.18,
                'kapliczka', 0.16,
                'obiekt_specjalny', 0.18,
                0.16
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-anchor': 'center',
        },
        paint: {
            'icon-opacity': [
                'case',
                ['boolean', ['feature-state', 'dimmed'], false], 0.25,
                1
            ]
        }
    });

    // Halo wokół punktu przy hover/highlight — kolorowe kółko POD ikoną dla wyróżnienia.
    map.addLayer({
        id: 'points-halo', type: 'circle', source: 'points',
        filter: ['!', ['has', 'point_count']],
        minzoom: 13,
        paint: {
            'circle-color': [
                'case',
                ['boolean', ['feature-state', 'highlight'], false], ['coalesce', ['feature-state', 'highlightColor'], '#ffc107'],
                ['boolean', ['feature-state', 'ownerHover'], false], '#a855f7',
                ['boolean', ['feature-state', 'hover'], false], '#ff0000',
                'transparent'
            ],
            'circle-radius': 16,
            'circle-opacity': [
                'case',
                ['any',
                    ['boolean', ['feature-state', 'highlight'], false],
                    ['boolean', ['feature-state', 'ownerHover'], false],
                    ['boolean', ['feature-state', 'hover'], false]
                ], 0.55,
                0
            ],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': [
                'case',
                ['any',
                    ['boolean', ['feature-state', 'highlight'], false],
                    ['boolean', ['feature-state', 'ownerHover'], false],
                    ['boolean', ['feature-state', 'hover'], false]
                ], 0.9,
                0
            ]
        }
    });

    // Layer alias — reszta kodu używa 'points-circle' jako warstwy do hover/click.
    // Dodajemy bezpośredni alias przez delegację eventów na 'points-icons'.

    map.addLayer({
        id: 'points-labels', type: 'symbol', source: 'points',
        filter: ['!', ['has', 'point_count']],
        minzoom: 15,
        layout: {
            'text-field': ['get', 'numer_obiektu'],
            'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top',
            'text-allow-overlap': true, 'text-optional': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }
    });

    setupHoverInteractionsV2();
    setupClickInteractionsV2();
    setupKeyboardZoomAnimation();

    // Ikony dla domów / kapliczek / obiektów specjalnych — ładowane z CDN, dodawane
    // jako sprite'y MapLibre. Po załadowaniu wymieniamy `circle` na `symbol` z icon-image.
    loadPointIcons();

    // Stosujemy parametry URL po wyrenderowaniu — Faza 3 rozszerzy to.
    setTimeout(handleUrlParametersV2, 100);

    console.log(`✅ MapLibre: ${polygons.features.length} poligonów, ${lines.features.length} linii, ${points.features.length} punktów`);
}

let hoveredParcelId = null;

// Tooltip dla hover nad zaznaczoną działką — leniwie utworzony singleton.
let highlightTooltip = null;
function getHighlightTooltip() {
    if (highlightTooltip) return highlightTooltip;
    const el = document.createElement('div');
    el.className = 'maplibre-highlight-tooltip';
    el.style.cssText = [
        'position:absolute', 'pointer-events:none', 'z-index:5',
        'background:rgba(20,20,20,0.92)', 'color:#fff',
        'padding:6px 10px', 'border-radius:6px', 'font-size:12px',
        'font-weight:500', 'line-height:1.35', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
        'border:1px solid rgba(255,255,255,0.15)', 'display:none', 'max-width:260px',
        'transition:opacity 0.12s'
    ].join(';');
    document.getElementById('map')?.appendChild(el);
    highlightTooltip = el;
    return el;
}
function showHighlightTooltip(point, info) {
    if (!info) { hideHighlightTooltip(); return; }
    const el = getHighlightTooltip();
    const lp = info.ownerLp != null ? ` <span style="opacity:.7">Lp.${info.ownerLp}</span>` : '';
    const typeBadge = info.ownershipType === 'Wg Protokołu'
        ? '<span style="background:#a855f7;padding:1px 6px;border-radius:8px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Wg protokołu</span>'
        : '<span style="background:#22c55e;padding:1px 6px;border-radius:8px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Rzeczywiste</span>';
    el.innerHTML = `<div style="margin-bottom:3px">${typeBadge}</div><div><b>${info.ownerName || '—'}</b>${lp}</div>`;
    el.style.left = (point.x + 14) + 'px';
    el.style.top = (point.y + 14) + 'px';
    el.style.display = 'block';
}
function hideHighlightTooltip() {
    if (highlightTooltip) highlightTooltip.style.display = 'none';
}

/**
 * Dodaje plakietkę "Lp.X" w środku działki/punktu.
 * Wykorzystywane przy highlight (jeden lub wielu właścicieli).
 *
 * @param {number} featureId
 * @param {number|string} lp - numer protokołu (Lp.)
 * @param {string} color - tło plakietki w kolorze highlightu
 * @param {boolean} isProtocol - true = paskowane tło (wg protokołu), false = pełne
 */
function addLpMarker(featureId, lp, color, isProtocol) {
    if (lp == null || lp === '') return;
    const markerKey = Number(featureId);
    if (!Number.isFinite(markerKey)) return;

    // Ta sama działka może pojawić się kilka razy w danych właściciela
    // (np. współwłasność / ułamki). Nie tworzymy wtedy wielu plakietek,
    // bo nadpisanie wpisu w Map zostawiłoby stare markery-sieroty na mapie.
    if (lpMarkers.has(markerKey)) return;

    const f = featuresById.get(String(featureId));
    if (!f) return;
    const center = featureCenter(f);
    if (!center) return;

    const el = document.createElement('div');
    el.className = 'lp-marker';
    el.style.cssText = [
        'pointer-events:none',
        'font:600 11px/1 -apple-system,Segoe UI,sans-serif',
        'color:#fff',
        'padding:3px 7px',
        'border-radius:10px',
        'white-space:nowrap',
        'box-shadow:0 1px 4px rgba(0,0,0,0.5)',
        'text-shadow:0 1px 2px rgba(0,0,0,0.5)',
        `background:${isProtocol
            ? `repeating-linear-gradient(45deg, ${color} 0 6px, rgba(0,0,0,0.35) 6px 10px)`
            : color}`,
        'border:1.5px solid #fff',
        'transform:translateY(-14px)', // unieś nad numer działki
    ].join(';');
    el.textContent = `Lp.${lp}`;

    const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(center)
        .addTo(map);
    lpMarkers.set(markerKey, m);
}

function clearLpMarkers() {
    for (const m of lpMarkers.values()) {
        try { m.remove(); } catch {}
    }
    lpMarkers.clear();
}

function setupHoverInteractionsV2() {
    map.on('mousemove', 'parcels-fill', (e) => {
        if (!e.features.length) return;
        const id = e.features[0].id;
        if (hoveredParcelId !== null && hoveredParcelId !== id) {
            map.setFeatureState({ source: 'parcels', id: hoveredParcelId }, { hover: false });
            window.PanelsV2?.clearHoverHighlights();
        }
        hoveredParcelId = id;
        map.setFeatureState({ source: 'parcels', id }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';

        // Synchronizacja z panelem — podświetl kartę właściciela i pozycję działki w panelu.
        const f = featuresById.get(String(id));
        const wl = parseMaybeJson(f?.properties?.wlasciciele) || parseMaybeJson(e.features[0].properties?.wlasciciele);
        window.PanelsV2?.highlightOwnerByFeatureHover(id, wl);

        // Tooltip — gdy działka jest zaznaczona, pokaż info o właścicielu.
        const info = highlightOwnerInfo.get(Number(id));
        if (info) showHighlightTooltip(e.point, info);
        else hideHighlightTooltip();
    });

    map.on('mouseleave', 'parcels-fill', () => {
        if (hoveredParcelId !== null) {
            map.setFeatureState({ source: 'parcels', id: hoveredParcelId }, { hover: false });
            hoveredParcelId = null;
        }
        map.getCanvas().style.cursor = '';
        window.PanelsV2?.clearHoverHighlights();
        hideHighlightTooltip();
    });

    map.on('mouseenter', 'points-icons', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'points-icons', () => map.getCanvas().style.cursor = '');
    map.on('mouseenter', 'points-circle-fallback', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'points-circle-fallback', () => map.getCanvas().style.cursor = '');
    map.on('mouseenter', 'points-clusters', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'points-clusters', () => map.getCanvas().style.cursor = '');
}

function setupClickInteractionsV2() {
    map.on('click', 'parcels-fill', (e) => {
        if (!e.features.length) return;
        handleObjectClick(e.features[0], e.lngLat);
    });
    map.on('click', 'points-icons', (e) => {
        if (!e.features.length) return;
        handleObjectClick(e.features[0], e.lngLat);
    });
    map.on('click', 'points-circle-fallback', (e) => {
        if (!e.features.length) return;
        handleObjectClick(e.features[0], e.lngLat);
    });
    map.on('click', 'points-clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['points-clusters'] })[0];
        if (!f) return;
        const cid = f.properties.cluster_id;
        map.getSource('points').getClusterExpansionZoom(cid).then(zoom => {
            map.easeTo({ center: f.geometry.coordinates, zoom, duration: 600, essential: true });
        });
    });
}

function handleObjectClick(feature, lngLat) {
    const props = feature.properties || {};
    const wlasciciele = uniqueOwners(parseMaybeJson(props.wlasciciele));
    const html = buildFeaturePopupHtml(props, wlasciciele);
    new maplibregl.Popup({ maxWidth: '340px', closeButton: true }).setLngLat(lngLat).setHTML(html).addTo(map);
}

function showOwnerSelectionPopup(wlasciciele, lngLat) {
    let html = '<h3>Ta działka ma wielu właścicieli.<br>Wybierz protokół:</h3><ul>';
    for (const w of wlasciciele) {
        const owner = allOwnersData.find(o => o.id === w.id || o.unikalny_klucz === w.unikalny_klucz);
        const lp = owner ? owner.numer_protokolu : 'N/A';
        html += `<li><a href="#" class="protocol-link-in-popup" data-key="${escapeHtml(w.unikalny_klucz || '')}">${escapeHtml(w.nazwa)} (Lp. ${escapeHtml(String(lp))})</a></li>`;
    }
    html += '</ul>';
    const popup = new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(lngLat).setHTML(html).addTo(map);
    setTimeout(() => {
        popup.getElement()?.querySelectorAll('.protocol-link-in-popup').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const k = link.getAttribute('data-key');
                popup.remove();
                if (k) window.location.href = `../wlasciciele/protokol.html?ownerId=${encodeURIComponent(k)}`;
            });
        });
    }, 0);
}

/* ==========================================================================
   API: window.MapV2
   ========================================================================== */

window.MapV2 = {
    highlightFeatures,
    clearTemporaryHighlight,
    clearAllHighlights,
    setOwnerHoverHighlight,
    setHoverFeature,
    focusFeature,
    fitToAll,
    showOwnerSelectionPopup: (owners, featureId) => {
        const f = featuresById.get(String(featureId));
        const center = featureCenter(f) || map.getCenter();
        showOwnerSelectionPopup(uniqueOwners(owners), center);
    },
    setCategoryVisibility,
    setBaseLayer,
    setMapLayerVisibility,
    setHistoricalOpacity,
    invalidateSize: () => map?.resize(),
    zoomIn: () => map?.zoomIn({ duration: 300 }),
    zoomOut: () => map?.zoomOut({ duration: 300 }),
    // Faza 3
    highlightOwners,           // wielu właścicieli z różnymi kolorami
    highlightRivers,           // rzeki po nazwach
    highlightRoads,            // drogi po nazwach
    setFocusMode,              // dim wszystkie poza listą id
    clearFocusMode,
};

function highlightFeatures(ids, color, opts = {}) {
    clearAllHighlights({ keepHistorical: true });
    if (!Array.isArray(ids) || !ids.length) return;

    highlightColor = color || '#ffc107';
    const stateKey = opts.temporary ? 'tempHighlight' : 'highlight';
    const set = opts.temporary ? temporaryHighlightIds : highlightFeatureIds;
    set.clear();

    // opts.ownerLp — numer protokołu (Lp) właściciela, pokazany na zaznaczonych działkach.
    // opts.isProtocol — true gdy highlight pochodzi z "działek wg protokołu"
    //   (cieńszy fill + grubszy obrys → wizualnie odróżnia od "rzeczywistych").
    const ownerLp = opts.ownerLp != null ? opts.ownerLp : null;
    const isProtocol = !!opts.isProtocol;

    // ownerName + ownershipType używane przez tooltip hover (zapisujemy do globalnej mapy).
    if (!opts.temporary && opts.ownerName) {
        for (const id of ids) {
            const n = Number(id);
            if (Number.isFinite(n)) highlightOwnerInfo.set(n, {
                ownerName: opts.ownerName,
                ownershipType: opts.ownershipType || (isProtocol ? 'Wg Protokołu' : 'Rzeczywiste'),
                ownerLp,
            });
        }
    }

    for (const id of ids) {
        const numId = Number(id);
        if (!Number.isFinite(numId)) continue;
        set.add(numId);
        const stateUpdate = { [stateKey]: true };
        if (!opts.temporary) {
            stateUpdate.highlightColor = highlightColor;
            stateUpdate.isProtocol = isProtocol;
            if (ownerLp != null) stateUpdate.ownerLp = ownerLp;
        }
        // Próbujemy ustawić stan w obu source'ach (parcels i points), tylko jeden zadziała.
        try { map.setFeatureState({ source: 'parcels', id: numId }, stateUpdate); } catch {}
        try { map.setFeatureState({ source: 'points', id: numId }, stateUpdate); } catch {}

        // Dodaj plakietkę "Lp.X" nad działką (jeśli mamy Lp i to nie tymczasowy highlight).
        if (!opts.temporary && ownerLp != null) {
            addLpMarker(numId, ownerLp, highlightColor, isProtocol);
        }
    }

    if (!opts.skipFit) {
        fitToFeatures(ids);
    }

    const ctrl = document.getElementById('highlight-controls');
    if (ctrl && !opts.temporary) ctrl.classList.remove('hidden');
    const cnt = document.getElementById('selected-count');
    if (cnt && !opts.temporary) cnt.textContent = ids.length;
}

function clearTemporaryHighlight() {
    for (const id of temporaryHighlightIds) {
        try { map.setFeatureState({ source: 'parcels', id }, { tempHighlight: false }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { tempHighlight: false }); } catch {}
    }
    temporaryHighlightIds.clear();
}

function clearAllHighlights({ keepHistorical } = {}) {
    for (const id of highlightFeatureIds) {
        try { map.setFeatureState({ source: 'parcels', id }, { highlight: false, isProtocol: false, ownerLp: null }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { highlight: false, isProtocol: false, ownerLp: null }); } catch {}
    }
    highlightFeatureIds.clear();
    highlightOwnerInfo.clear();
    clearLpMarkers();
    hideHighlightTooltip();
    clearTemporaryHighlight();
    setOwnerHoverHighlight(null, false);
    clearOwnerColored();
    clearFocusMode();

    if (!keepHistorical) {
        const ctrl = document.getElementById('highlight-controls');
        if (ctrl) ctrl.classList.add('hidden');
        const cnt = document.getElementById('selected-count');
        if (cnt) cnt.textContent = 0;

        // Wyczyść URL params związane z highlightami.
        const url = new URL(window.location);
        ['highlightByIds', 'highlightTopOwners', 'highlightParcels', 'highlightParcel',
         'highlightRivers', 'highlightRoads', 'findHouseNumber', 'ownerName', 'ownership']
            .forEach(k => url.searchParams.delete(k));
        history.replaceState({}, '', url);
    }
}

function setOwnerHoverHighlight(ids, on) {
    if (!on) {
        for (const id of ownerHoverIds) {
            try { map.setFeatureState({ source: 'parcels', id }, { ownerHover: false }); } catch {}
            try { map.setFeatureState({ source: 'points', id }, { ownerHover: false }); } catch {}
        }
        ownerHoverIds.clear();
        return;
    }
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        ownerHoverIds.add(n);
        try { map.setFeatureState({ source: 'parcels', id: n }, { ownerHover: true }); } catch {}
        try { map.setFeatureState({ source: 'points', id: n }, { ownerHover: true }); } catch {}
    }
}

function setHoverFeature(featureId, on) {
    const id = Number(featureId);
    if (!Number.isFinite(id)) return;
    if (on) {
        if (hoveredFromPanelId !== null && hoveredFromPanelId !== id) {
            try { map.setFeatureState({ source: 'parcels', id: hoveredFromPanelId }, { hover: false }); } catch {}
            try { map.setFeatureState({ source: 'points', id: hoveredFromPanelId }, { hover: false }); } catch {}
        }
        hoveredFromPanelId = id;
        try { map.setFeatureState({ source: 'parcels', id }, { hover: true }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { hover: true }); } catch {}
    } else {
        try { map.setFeatureState({ source: 'parcels', id }, { hover: false }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { hover: false }); } catch {}
        if (hoveredFromPanelId === id) hoveredFromPanelId = null;
    }
}

function focusFeature(featureId, opts = {}) {
    const f = featuresById.get(String(featureId));
    if (!f) return false;

    // "Pokaż na mapie" ma nie tylko dojechać do działki, ale też zostawić
    // wyraźne zaznaczenie. Domyślnie markujemy fuksją; można wyłączyć opts.mark=false.
    if (opts.mark !== false) {
        markSingleFeature(featureId, opts.markColor || 'fuchsia');
    }

    const bbox = featureBBox(f);
    if (bbox) {
        const isPoint = f.geometry.type === 'Point';
        if (isPoint) {
            map.easeTo({
                center: [bbox[0], bbox[1]],
                zoom: Math.max(map.getZoom(), 17),
                duration: 700,
                essential: true,
            });
        } else {
            map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
                padding: 60,
                maxZoom: 19,
                duration: 700,
                essential: true,
            });
        }
    }
    if (opts.openPopup) {
        const center = featureCenter(f) || map.getCenter();
        const props = f.properties || {};
        const wlasciciele = uniqueOwners(parseMaybeJson(props.wlasciciele));
        const html = buildFeaturePopupHtml(props, wlasciciele);
        new maplibregl.Popup({ maxWidth: '340px', closeButton: true }).setLngLat(center).setHTML(html).addTo(map);
    }
    return true;
}

function markSingleFeature(featureId, color = 'fuchsia') {
    clearAllHighlights({ keepHistorical: true });
    const id = Number(featureId);
    if (!Number.isFinite(id)) return;
    highlightFeatureIds.add(id);
    try { map.setFeatureState({ source: 'parcels', id }, { highlight: true, highlightColor: color }); } catch {}
    try { map.setFeatureState({ source: 'points', id }, { highlight: true, highlightColor: color }); } catch {}
    document.getElementById('highlight-controls')?.classList.remove('hidden');
    const cnt = document.getElementById('selected-count');
    if (cnt) cnt.textContent = 1;
}

/**
 * Buduje rich-popup z linkami do protokołów właścicieli.
 */
function buildFeaturePopupHtml(props, wlasciciele) {
    const kat = (props.kategoria || '').replace(/_/g, ' ');
    const numer = props.numer_obiektu || '—';
    let html = `<div class="map-popup">
        <div class="map-popup-title">${escapeHtml(numer)}</div>
        <div class="map-popup-meta"><b>Typ:</b> ${escapeHtml(kat)}</div>`;

    if (wlasciciele.length === 1) {
        const w = wlasciciele[0];
        const url = `../wlasciciele/protokol.html?ownerId=${encodeURIComponent(w.unikalny_klucz || '')}`;
        html += `<div class="map-popup-owners"><b>Właściciel:</b> ${escapeHtml(w.nazwa)}</div>
            <a class="map-popup-btn" href="${url}"><i class="fas fa-file-alt"></i> Otwórz protokół</a>`;
    } else if (wlasciciele.length > 1) {
        html += `<div class="map-popup-owners"><b>Właściciele (${wlasciciele.length}):</b></div>
            <ul class="map-popup-list">`;
        for (const w of wlasciciele) {
            const url = `../wlasciciele/protokol.html?ownerId=${encodeURIComponent(w.unikalny_klucz || '')}`;
            const owner = allOwnersData.find(o => o.unikalny_klucz === w.unikalny_klucz || o.id === w.id);
            const lp = owner?.numer_protokolu;
            html += `<li><a href="${url}">${escapeHtml(w.nazwa)}${lp ? ` <span class="map-popup-lp">Lp. ${escapeHtml(String(lp))}</span>` : ''}</a></li>`;
        }
        html += `</ul>`;
    }

    html += `</div>`;
    return html;
}

function fitToAll() {
    if (!allParcelsData.length) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of allParcelsData) {
        const bb = featureBBox(f);
        if (!bb) continue;
        if (bb[0] < minLng) minLng = bb[0];
        if (bb[1] < minLat) minLat = bb[1];
        if (bb[2] > maxLng) maxLng = bb[2];
        if (bb[3] > maxLat) maxLat = bb[3];
    }
    if (Number.isFinite(minLng)) {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: 60, duration: 800, essential: true,
        });
    }
}

function fitToFeatures(ids) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const id of ids) {
        const f = featuresById.get(String(id));
        if (!f) continue;
        const bb = featureBBox(f);
        if (!bb) continue;
        if (bb[0] < minLng) minLng = bb[0];
        if (bb[1] < minLat) minLat = bb[1];
        if (bb[2] > maxLng) maxLng = bb[2];
        if (bb[3] > maxLat) maxLat = bb[3];
    }
    if (Number.isFinite(minLng)) {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: 80, maxZoom: 18, duration: 800, essential: true,
        });
    }
}

function setCategoryVisibility(kategoria, visible) {
    // Filter na warstwach: pokazujemy te których kategoria != ukryte.
    // Trzymamy listę ukrytych i robimy single composite filter.
    if (!setCategoryVisibility.hidden) setCategoryVisibility.hidden = new Set();
    if (visible) setCategoryVisibility.hidden.delete(kategoria);
    else setCategoryVisibility.hidden.add(kategoria);

    const nonOutline = ['!=', ['get', 'kategoria'], 'obrys_miejscowosci'];
    const buildFilter = (baseFilter, forceNonOutline = false) => {
        const hidden = [...setCategoryVisibility.hidden];
        let filter = baseFilter || null;
        if (forceNonOutline) filter = filter ? ['all', filter, nonOutline] : nonOutline;
        if (!hidden.length) return filter;
        const cat = ['get', 'kategoria'];
        const noneOfHidden = ['all', ...hidden.map(h => ['!=', cat, h])];
        if (!filter) return noneOfHidden;
        return ['all', filter, noneOfHidden];
    };

    const safeSetFilter = (id, filter) => { if (map.getLayer(id)) map.setFilter(id, filter); };

    safeSetFilter('parcels-fill', buildFilter(null, true));
    safeSetFilter('parcels-line-halo', buildFilter(null, true));
    safeSetFilter('parcels-line', buildFilter(null, true));
    safeSetFilter('parcels-labels', buildFilter(nonOutline));
    // Obrys miejscowości jest osobną warstwą, więc najpewniej chowamy go przez
    // layout visibility (filtr z pustym wynikiem bywał mylący przy starym stanie stylu).
    if (map.getLayer('settlement-outline')) {
        map.setLayoutProperty(
            'settlement-outline',
            'visibility',
            setCategoryVisibility.hidden.has('obrys_miejscowosci') ? 'none' : 'visible'
        );
    }
    safeSetFilter('lines-layer', buildFilter(null));
    const pointBase = ['!', ['has', 'point_count']];
    safeSetFilter('points-circle-fallback', buildFilter(pointBase));
    safeSetFilter('points-icons', buildFilter(pointBase));
    safeSetFilter('points-halo', buildFilter(pointBase));
    safeSetFilter('points-labels', buildFilter(pointBase));
}

function setBaseLayer(type) {
    // type: satellite | osm | none
    if (map.getLayer('satellite-layer')) {
        map.setLayoutProperty('satellite-layer', 'visibility', type === 'satellite' ? 'visible' : 'none');
    }
    if (map.getLayer('osm-layer')) {
        map.setLayoutProperty('osm-layer', 'visibility', type === 'osm' ? 'visible' : 'none');
    }
}

function setMapLayerVisibility(group, visible) {
    const v = visible ? 'visible' : 'none';
    const safe = (id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v); };

    if (group === 'historical') safe('historical-layer');
    if (group === 'parcels') ['parcels-fill', 'parcels-line-halo', 'parcels-line', 'settlement-outline', 'lines-layer'].forEach(safe);
    if (group === 'labels') ['parcels-labels', 'points-labels'].forEach(safe);
    if (group === 'points') ['points-clusters', 'points-cluster-count', 'points-circle-fallback', 'points-icons', 'points-halo'].forEach(safe);
}

function setHistoricalOpacity(opacity) {
    historicalOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
    if (map.getLayer('historical-layer')) {
        map.setPaintProperty('historical-layer', 'raster-opacity', historicalOpacity);
    }
}

/* ==========================================================================
   FAZA 3: KOLOROWANIE WIELU WŁAŚCICIELI / RZEKI / DROGI / FOCUS MODE
   ========================================================================== */

const HIGHLIGHT_PALETTE = [
    '#E6194B', '#F58231', '#FFE119', '#BFDF45', '#3CB44B',
    '#42D4F4', '#4363D8', '#911EB4', '#F032E6', '#A9A9A9'
];

function isRealOwnershipType(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') === 'wlasnosc rzeczywista';
}

/**
 * Koloruje działki dla wielu właścicieli różnymi kolorami z palety.
 * @param {string[]} ownerKeys - klucze unikalne właścicieli
 * @param {'wszystkie'|'rzeczywista'|'protokol'} ownershipType
 */
function highlightOwners(ownerKeys, ownershipType = 'wszystkie') {
    clearOwnerColored();
    clearAllHighlights({ keepHistorical: true });

    if (!Array.isArray(ownerKeys) || !ownerKeys.length) return;

    // Mapa kolorów: ownerKey → color (lub {rzeczywista, protokol})
    const colorMap = {};
    let i = 0;
    for (const k of ownerKeys) {
        if (ownershipType === 'wszystkie') {
            colorMap[k] = {
                rzeczywista: HIGHLIGHT_PALETTE[i % HIGHLIGHT_PALETTE.length],
                protokol: HIGHLIGHT_PALETTE[(i + 1) % HIGHLIGHT_PALETTE.length],
            };
            i += 2;
        } else {
            colorMap[k] = HIGHLIGHT_PALETTE[i % HIGHLIGHT_PALETTE.length];
            i++;
        }
    }

    const selectedIds = [];

    // Mapowanie ownerKey → numer protokołu (Lp) — żeby wyświetlić Lp.X na działkach.
    const lpByOwnerKey = new Map();
    for (const o of allOwnersData) {
        if (o.unikalny_klucz && o.numer_protokolu != null) {
            lpByOwnerKey.set(o.unikalny_klucz, o.numer_protokolu);
        }
    }

    for (const f of allParcelsData) {
        const owners = f.properties?.wlasciciele;
        if (!Array.isArray(owners) || !owners.length) continue;

        const matched = findMatchingOwner(owners, colorMap, ownershipType);
        if (!matched) continue;

        const cm = colorMap[matched.unikalny_klucz];
        const isReal = isRealOwnershipType(matched.typ_posiadania);
        const color = (typeof cm === 'object')
            ? (isReal ? cm.rzeczywista : cm.protokol)
            : cm;

        const id = Number(f.id);
        if (!Number.isFinite(id)) continue;
        const ownerLp = lpByOwnerKey.get(matched.unikalny_klucz);
        ownerColoredIds.add(id);
        selectedIds.push(id);
        const stateUpdate = { ownerColored: true, ownerColor: color };
        if (ownerLp != null) stateUpdate.ownerLp = ownerLp;
        try { map.setFeatureState({ source: 'parcels', id }, stateUpdate); } catch {}
        try { map.setFeatureState({ source: 'points', id }, stateUpdate); } catch {}

        // Plakietka Lp.X w kolorze właściciela, paskowana gdy "wg protokołu".
        if (ownerLp != null) {
            addLpMarker(id, ownerLp, color, !isReal);
        }

        // Tooltip info dla hover.
        const ownerObj = allOwnersData.find(o => o.unikalny_klucz === matched.unikalny_klucz);
        highlightOwnerInfo.set(id, {
            ownerName: ownerObj?.nazwa_wlasciciela || matched.nazwa || matched.unikalny_klucz,
            ownershipType: isReal ? 'Rzeczywiste' : 'Wg Protokołu',
            ownerLp,
        });
    }

    if (selectedIds.length) {
        setFocusMode(selectedIds);
        fitToFeatures(selectedIds);
        createOwnerHighlightLegend(ownerKeys, colorMap);
        document.getElementById('highlight-controls')?.classList.remove('hidden');
    }
}

function findMatchingOwner(parcelOwners, colorMap, ownershipType) {
    if (ownershipType === 'rzeczywista') {
        return parcelOwners.find(o => colorMap[o.unikalny_klucz] && isRealOwnershipType(o.typ_posiadania)) || null;
    }
    if (ownershipType === 'protokol') {
        return parcelOwners.find(o => colorMap[o.unikalny_klucz] && !isRealOwnershipType(o.typ_posiadania)) || null;
    }
    return parcelOwners.find(o => colorMap[o.unikalny_klucz]) || null;
}

function clearOwnerColored() {
    for (const id of ownerColoredIds) {
        try { map.setFeatureState({ source: 'parcels', id }, { ownerColored: false, ownerColor: null, ownerLp: null }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { ownerColored: false, ownerColor: null, ownerLp: null }); } catch {}
    }
    ownerColoredIds.clear();
    clearLpMarkers();
    removeOwnerHighlightLegend();
}

function createOwnerHighlightLegend(ownerKeys, colorMap) {
    const legendEl = document.getElementById('legend');
    if (!legendEl) return;
    const list = legendEl.querySelector('.legend-list');
    if (!list) return;

    list.querySelectorAll('.legend-item-owner').forEach(el => el.remove());
    list.querySelector('.legend-separator')?.remove();

    if (!ownerKeys.length) return;

    const sep = document.createElement('hr');
    sep.className = 'legend-separator';
    sep.style.cssText = 'margin:10px 0;border:none;border-top:1px solid var(--border-color);';
    list.appendChild(sep);

    for (const key of ownerKeys) {
        const owner = allOwnersData.find(o => o.unikalny_klucz === key);
        if (!owner) continue;
        const cm = colorMap[key];
        if (typeof cm === 'object') {
            list.appendChild(buildOwnerLegendItem(`${owner.nazwa_wlasciciela} (Rzeczywiste)`, cm.rzeczywista));
            list.appendChild(buildOwnerLegendItem(`${owner.nazwa_wlasciciela} (Wg Protokołu)`, cm.protokol));
        } else {
            list.appendChild(buildOwnerLegendItem(owner.nazwa_wlasciciela, cm));
        }
    }
}

function removeOwnerHighlightLegend() {
    const list = document.getElementById('legend')?.querySelector('.legend-list');
    if (!list) return;
    list.querySelectorAll('.legend-item-owner').forEach(el => el.remove());
    list.querySelector('.legend-separator')?.remove();
}

function buildOwnerLegendItem(label, color) {
    const li = document.createElement('li');
    li.className = 'legend-item legend-item-owner';
    li.style.opacity = '1';
    const box = document.createElement('span');
    box.className = 'legend-color-box';
    box.style.backgroundColor = color;
    const sp = document.createElement('span');
    sp.className = 'legend-label';
    sp.textContent = label;
    sp.style.fontWeight = '600';
    sp.style.color = 'var(--accent-color)';
    li.appendChild(box);
    li.appendChild(sp);
    return li;
}

function highlightRivers(names) {
    if (!Array.isArray(names) || !names.length) return;
    const ids = allParcelsData
        .filter(f => f.properties?.kategoria === 'rzeka' &&
            names.includes(String(f.properties.numer_obiektu || '').trim()))
        .map(f => f.id);
    if (ids.length) highlightFeatures(ids, '#0000FF');
}

function highlightRoads(names) {
    if (!Array.isArray(names) || !names.length) return;
    const ids = allParcelsData
        .filter(f => f.properties?.kategoria === 'droga' &&
            names.includes(String(f.properties.numer_obiektu || '').trim()))
        .map(f => f.id);
    if (ids.length) highlightFeatures(ids, '#FFA500');
}

/**
 * Tryb fokusu — działki z listy są w kolorach, reszta przyciemniona.
 * @param {Array<number>} ids
 */
function setFocusMode(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const focused = new Set(ids.map(Number).filter(n => Number.isFinite(n)));
    focusedIds = focused;

    document.getElementById('map')?.classList.add('selection-focus-mode');

    // Każda działka, która NIE jest w focused, dostaje stan `dimmed`.
    for (const f of allParcelsData) {
        const id = Number(f.id);
        if (!Number.isFinite(id)) continue;
        if (focused.has(id)) {
            try { map.setFeatureState({ source: 'parcels', id }, { dimmed: false }); } catch {}
            try { map.setFeatureState({ source: 'points', id }, { dimmed: false }); } catch {}
        } else {
            try { map.setFeatureState({ source: 'parcels', id }, { dimmed: true }); } catch {}
            try { map.setFeatureState({ source: 'points', id }, { dimmed: true }); } catch {}
        }
    }
}

function clearFocusMode() {
    if (!focusedIds) return;
    document.getElementById('map')?.classList.remove('selection-focus-mode');
    for (const f of allParcelsData) {
        const id = Number(f.id);
        if (!Number.isFinite(id)) continue;
        try { map.setFeatureState({ source: 'parcels', id }, { dimmed: false }); } catch {}
        try { map.setFeatureState({ source: 'points', id }, { dimmed: false }); } catch {}
    }
    focusedIds = null;
}

/* ==========================================================================
   URL PARAMETERS (minimum dla podstawowych przypadków)
   ========================================================================== */

function handleUrlParametersV2() {
    const params = new URLSearchParams(window.location.search);

    const idsParam = params.get('highlightByIds');
    if (idsParam) {
        const ids = idsParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        if (ids.length) highlightFeatures(ids, 'fuchsia');
    }

    // highlightTopOwners — wielu właścicieli, kolorowanie z palety.
    const ownersParam = params.get('highlightTopOwners');
    if (ownersParam) {
        let ownership = params.get('ownership') || 'wszystkie';
        if (ownership === 'real') ownership = 'rzeczywista';
        if (ownership === 'protocol') ownership = 'protokol';
        const keys = [...new Set(ownersParam.split(',').map(s => s.trim()).filter(Boolean))];
        if (keys.length) highlightOwners(keys, ownership);
    }

    const parcelsParam = params.get('highlightParcels') || params.get('highlightParcel');
    if (parcelsParam) {
        const numbers = parcelsParam.split(',').map(s => s.trim()).filter(Boolean);
        const ids = allParcelsData
            .filter(p => numbers.includes(String(p.properties.numer_obiektu)))
            .map(p => p.id);
        if (ids.length) highlightFeatures(ids, '#FF0000');
    }

    const riversParam = params.get('highlightRivers');
    if (riversParam) {
        const names = [...new Set(riversParam.split(',').map(s => s.trim()).filter(Boolean))];
        highlightRivers(names);
    }

    const roadsParam = params.get('highlightRoads');
    if (roadsParam) {
        const names = [...new Set(roadsParam.split(',').map(s => s.trim()).filter(Boolean))];
        highlightRoads(names);
    }

    const houseNumberParam = params.get('findHouseNumber');
    if (houseNumberParam) {
        const ownerName = params.get('ownerName') || '';
        const search = String(houseNumberParam).trim().toLowerCase();
        const f = allParcelsData.find(p =>
            (p.properties.kategoria === 'budynek' || p.properties.kategoria === 'dom') &&
            (p.properties.numer_obiektu || '').toLowerCase() === search);
        if (f) {
            highlightFeatures([f.id], 'fuchsia');
            const center = featureCenter(f);
            if (center) {
                new maplibregl.Popup({ maxWidth: '320px' })
                    .setLngLat(center)
                    .setHTML(`<div style="text-align:center;"><h3>🏠 Dom nr ${escapeHtml(houseNumberParam)}</h3>${ownerName ? `<p><b>Właściciel:</b> ${escapeHtml(ownerName)}</p>` : ''}</div>`)
                    .addTo(map);
            }
        }
    }

    // ownerKey + show=house — pokaż dom konkretnego właściciela.
    const ownerKeyParam = params.get('ownerKey');
    const showParam = params.get('show');
    if (ownerKeyParam && showParam === 'house') {
        showHouseByOwnerKey(ownerKeyParam);
    }
}

async function showHouseByOwnerKey(ownerKey) {
    try {
        const resp = await fetch(`/api/wlasciciel/${encodeURIComponent(ownerKey)}`);
        if (!resp.ok) return;
        const ownerData = await resp.json();
        if (!ownerData) return;

        const houseNo = ownerData.dom_numer || ownerData.numer_domu;
        const objectId = ownerData.dom_obiekt_id;
        const ownerName = ownerData.nazwa_wlasciciela || '';

        let target = null;
        if (objectId != null) target = featuresById.get(String(objectId));
        if (!target && houseNo) {
            target = allParcelsData.find(f => {
                const k = f.properties?.kategoria;
                if (k !== 'budynek' && k !== 'dom') return false;
                if (String(f.properties?.numer_obiektu || '').trim() !== String(houseNo).trim()) return false;
                const owners = f.properties?.wlasciciele;
                if (!Array.isArray(owners) || !owners.length) return true;
                return owners.some(o => String(o.id) === String(ownerData.id) || o.unikalny_klucz === ownerKey);
            });
        }
        if (!target) return;

        highlightFeatures([target.id], 'fuchsia');
        const center = featureCenter(target);
        if (center) {
            new maplibregl.Popup({ maxWidth: '320px' })
                .setLngLat(center)
                .setHTML(`<div><b>🏠 Dom nr ${escapeHtml(houseNo || '—')}</b><br><span>Właściciel: ${escapeHtml(ownerName || 'nieznany')}</span></div>`)
                .addTo(map);
        }
    } catch (e) {
        console.warn('showHouseByOwnerKey błąd:', e);
    }
}

/* ==========================================================================
   GEOMETRY HELPERS
   ========================================================================== */

function featureBBox(f) {
    if (!f?.geometry) return null;
    const g = f.geometry;
    let min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    const eat = ([x, y]) => {
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
    };
    if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1]];
    if (g.type === 'LineString') g.coordinates.forEach(eat);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(line => line.forEach(eat));
    else if (g.type === 'Polygon') g.coordinates.forEach(ring => ring.forEach(eat));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(eat)));
    else return null;
    if (!Number.isFinite(min[0])) return null;
    return [min[0], min[1], max[0], max[1]];
}

function featureCenter(f) {
    const bb = featureBBox(f);
    if (!bb) return null;
    return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
}

function setupKeyboardZoomAnimation() {
    // MapLibre domyślnie animuje keyboard zoom, ale chcemy spójność czasów
    // z naszymi innymi animacjami (700-800ms). Tu nic dodatkowego nie trzeba —
    // ten hook zostawiam jako miejsce na ewentualne tweaki.
}

function parseMaybeJson(v) {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
}

function uniqueOwners(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const w of arr) {
        const k = w?.unikalny_klucz || `id:${w?.id}`;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(w);
    }
    return out;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
