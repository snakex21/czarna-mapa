/* ==========================================================================
   Plik: map-script.js
   Opis: Główny skrypt interaktywnej mapy katastralnej gminy Czarna.
         Zarządza renderowaniem GeoJSON, interakcjami użytkownika oraz
         integracją z API backendowym.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", initializeApp);

/* ==========================================================================
   ZMIENNE GLOBALNE I KONFIGURACJA
   ========================================================================== */

/* Instancje głównych obiektów */
let map = null;
let allOwnersData = [];
let allParcelsData = [];
let geojsonLayer = null;
let historicalMapOverlay = null;
let layersByCategory = {};
let markerClusterGroup = null;
let parcelLabelLayer = null;

/* Cache dla szybkiego wyszukiwania warstw - optymalizacja wydajności */
let layersById = new Map();

/* Stan interfejsu */
let isInCompareMode = false;
let selectedForCompare = [];

/* Warstwy podświetleń */
let highlightedLayer = null;
let ownerHighlightLayer = null;
let focusedParcelIds = null;

/* Paleta kolorów dla właścicieli */
const HIGHLIGHT_COLORS = [
    "#E6194B", "#F58231", "#FFE119", "#BFDF45", "#3CB44B",
    "#42D4F4", "#4363D8", "#911EB4", "#F032E6", "#A9A9A9"
];

/* ==========================================================================
   FUNKCJE POMOCNICZE - OPTYMALIZACJA WYDAJNOŚCI
   ========================================================================== */

/**
 * Throttle - ogranicza częstotliwość wywoływania funkcji.
 * Funkcja zostanie wywołana maksymalnie raz na określony czas.
 * @param {Function} func - Funkcja do throttlingu
 * @param {number} limit - Minimalny odstęp między wywołaniami w ms
 * @returns {Function} - Funkcja z throttlingiem
 */
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Debounce - opóźnia wywołanie funkcji do momentu, gdy przestanie być wywoływana.
 * @param {Function} func - Funkcja do debounce
 * @param {number} wait - Czas oczekiwania w ms
 * @returns {Function} - Funkcja z debounce
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/* ==========================================================================
   INICJALIZACJA APLIKACJI
   ========================================================================== */

/**
 * Główny punkt wejścia aplikacji.
 * Inicjalizuje wszystkie komponenty (ekran ładowania będzie ukryty po załadowaniu danych).
 */
function initializeApp() {
    console.log("🚀 Aplikacja startuje...");

    initializeMap();
    setupUIEventListeners();
    setupHistoricalMapOpacityControl();
    fetchDataAndBuildInterface();
}

/**
 * Rejestruje główne listenery interfejsu użytkownika.
 */
function setupUIEventListeners() {
    setupPanelToggles();
    setupToolbarActions();
    setupUniversalSearch();
    setupMobileSearch(); // Nowa funkcja dla mobile
}

/* ==========================================================================
   INICJALIZACJA MAPY LEAFLET
   ========================================================================== */

/**
 * Konfiguruje mapę Leaflet z warstwami bazowymi i nakładkami.
 * Ustawia granice, zoom oraz kontroler warstw.
 * Używa konfiguracji z backendu (window.MAP_CONFIG) dla poprawnej georeferentacji.
 */
function initializeMap() {
    /* Pobierz konfigurację z backendu */
    const calibration = window.MAP_CONFIG?.calibration || {
        sw: { lat: 50.0445232994271194, lng: 21.2118218969993393 },
        ne: { lat: 50.0766374787729518, lng: 21.2672168223566409 }
    };
    const defaults = window.MAP_CONFIG?.defaults || {
        center: { lat: 50.0605803891, lng: 21.2395193597 },
        zoom: 14
    };

    console.log("🗺️ Konfiguracja mapy:", calibration, defaults);

    /* Warstwy bazowe */
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });

    const minimalistLayer = L.tileLayer('', {
        attribution: 'Projekt Interaktywna Mapa Katastralna'
    });

    /* Warstwy nakładkowe - używamy kalibracji z QGIS */
    const historicalBounds = [
        [calibration.sw.lat, calibration.sw.lng], // SW (lewy dolny róg)
        [calibration.ne.lat, calibration.ne.lng]  // NE (prawy górny róg)
    ];

    historicalMapOverlay = L.imageOverlay("mapa.jpg", historicalBounds);
    geojsonLayer = L.geoJSON();

    /* Konfiguracja mapy - maxBounds nieco większe niż historicalBounds */
    const padding = 0.01; // Padding dla maxBounds
    const maxBounds = L.latLngBounds(
        [calibration.sw.lat - padding, calibration.sw.lng - padding],
        [calibration.ne.lat + padding, calibration.ne.lng + padding]
    );

    map = L.map("map", {
        layers: [satelliteLayer, historicalMapOverlay, geojsonLayer],
        maxBounds: maxBounds,
        minZoom: 12,
        maxZoom: 18,
        preferCanvas: true, // Użyj Canvas zamiast SVG dla lepszej wydajności
        renderer: L.canvas({ padding: 0.5, tolerance: 10 })
    }).setView([defaults.center.lat, defaults.center.lng], defaults.zoom);

    /* Kontroler warstw */
    const baseMaps = {
        "Satelita": satelliteLayer,
        "Mapa drogowa": osmLayer,
        "Tylko działki (tło minimalistyczne)": minimalistLayer
    };

    const overlayMaps = {
        "Narysowane obiekty (działki, drogi)": geojsonLayer,
        "Podkład mapy historycznej z XIX w.": historicalMapOverlay
    };

    L.control.layers(baseMaps, overlayMaps, {
        position: 'topright',
        collapsed: true
    }).addTo(map);

    /* Wyświetlanie współrzędnych kursora - z throttlingiem dla wydajności */
    map.on("mousemove", throttle((e) => {
        const coordsDiv = document.getElementById("mouse-coordinates");
        if (coordsDiv) {
            coordsDiv.innerHTML = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        }
    }, 100)); // Aktualizacja max co 100ms

    parcelLabelLayer = L.layerGroup().addTo(map);
    map.on("moveend zoomend", debounce(updateVisibleParcelLabels, 120));

    console.log("✅ Mapa zainicjalizowana");
}

/* ==========================================================================
   KOMUNIKACJA Z API
   ========================================================================== */

/**
 * Pobiera dane z API i buduje interfejs użytkownika.
 * Obsługuje stany ładowania i błędy.
 */
function fetchDataAndBuildInterface() {
    console.log("📡 Rozpoczynam pobieranie danych z API...");

    const ownersBox = document.getElementById("ownersList");
    const dzialkiBox = document.getElementById("dzialki_panel");
    const obiektyBox = document.getElementById("obiekty_panel");
    const legendBox = document.getElementById("legend");

    /* Funkcje pomocnicze dla stanów ładowania */
    const showLoading = (el, label = "Ładowanie…") => {
        if (!el) return;
        el.dataset._prevHtml = el.innerHTML;
        el.innerHTML = `
            <div class="loading-inline">
                <span class="spinner" aria-hidden="true"></span>
                <span class="loading-text">${label}</span>
            </div>`;
    };

    const clearLoading = (el) => {
        if (!el || !el.dataset._prevHtml) return;
        el.innerHTML = el.dataset._prevHtml;
        delete el.dataset._prevHtml;
    };

    const showError = (el, msg = "Nie udało się wczytać danych.") => {
        if (!el) return;
        el.innerHTML = `<div class="loading-error" role="alert">${msg}</div>`;
    };

    /* Wyświetlanie stanów ładowania */
    showLoading(ownersBox, "Ładowanie listy właścicieli…");
    showLoading(dzialkiBox, "Ładowanie listy działek…");
    showLoading(obiektyBox, "Ładowanie obiektów…");

    /* Równoległe pobieranie danych */
    Promise.all([
        fetch("/api/dzialki").then(res => res.json()),
        fetch("/api/wlasciciele").then(res => res.json()),
    ])
        .then(([dzialkiData, wlascicieleResponse]) => {
            console.log("✅ Pobrano dane pomyślnie!");

            clearLoading(ownersBox);
            clearLoading(dzialkiBox);
            clearLoading(obiektyBox);

            allOwnersData = wlascicieleResponse.owners;
            allParcelsData = dzialkiData.features;

            const metadata = wlascicieleResponse.metadata;
            const sortByOrderBtn = document.getElementById("sortByOrderBtn");
            if (sortByOrderBtn && metadata?.zakres_lp) {
                sortByOrderBtn.textContent = `Numeru Protokołu (${metadata.zakres_lp.min}-${metadata.zakres_lp.max})`;
            }

            renderMapObjects(allParcelsData);
            setupOwnerPanel();
            setupParcelPanel();
            setupLegend();

            handleUrlParameters();
            handleShowHouseByOwnerKeyFromURL();

            // Ukryj ekran ładowania po załadowaniu wszystkich danych
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                console.log("✅ Ekran ładowania ukryty - wszystkie dane załadowane!");

                // Wymuś odświeżenie mapy po ukryciu overlay, aby upewnić się że wypełnia cały kontener
                if (map) {
                    setTimeout(() => {
                        map.invalidateSize();
                        console.log("🔄 Mapa odświeżona po załadowaniu danych");
                    }, 100);
                }
            }
        })
        .catch((error) => {
            console.error("❌ KRYTYCZNY BŁĄD:", error);
            showError(ownersBox, "Błąd wczytywania właścicieli.");
            showError(dzialkiBox, "Błąd wczytywania działek.");
            showError(obiektyBox, "Błąd wczytywania obiektów.");
            if (legendBox) showError(legendBox, "Błąd wczytywania legendy.");

            // Ukryj ekran ładowania także w przypadku błędu
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
                console.log("⚠️ Ekran ładowania ukryty - błąd ładowania danych");
            }
        });
}

/* ==========================================================================
   RENDEROWANIE OBIEKTÓW NA MAPIE
   ========================================================================== */

/**
 * Renderuje obiekty GeoJSON na mapie z odpowiednimi stylami.
 * @param {Array} parcels - Tablica obiektów GeoJSON do wyrenderowania
 */
function renderMapObjects(parcels) {
    if (!parcels) {
        console.error("❌ Brak danych obiektów do narysowania.");
        return;
    }
    console.log(`🗺️ Rysowanie ${parcels.length} obiektów...`);

    /* Wyczyść cache warstw przed ponownym renderowaniem */
    layersById.clear();

    /* Definicje stylów dla kategorii */
    const STYLES = {
        budowlana: { color: "#e67e22", weight: 2 },
        rolna: { color: "#27ae60", weight: 2 },
        las: {
            color: "#16a085",
            weight: 1,
            fillColor: "#1abc9c",
            fillOpacity: 0.5,
        },
        droga: { color: "#8B4513", weight: 3 },
        rzeka: { color: "#3498db", weight: 4 },
        pastwisko: {
            color: "#f1c40f",
            weight: 1,
            fillColor: "#f1c40f",
            fillOpacity: 0.4,
        },
        obrys_miejscowosci: {
            color: "#ff0000",
            weight: 3,
            fill: false,
            dashArray: "10, 5",
            interactive: false,
        },
        obiekt_specjalny: { color: "#2c3e50", weight: 2 },
        default: { color: "#3388ff", weight: 2 },
    };

    /* Ikony dla punktów */
    const ICONS = {
        budynek: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/25/25694.png",
            iconSize: [32, 32],
        }),
        kapliczka: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/2133/2133353.png",
            iconSize: [32, 32],
        }),
        obiekt_specjalny: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/785/785432.png",
            iconSize: [32, 32],
        }),
    };

    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    if (markerClusterGroup) {
        map.removeLayer(markerClusterGroup);
    }

    /* Inicjalizacja MarkerClusterGroup dla punktów */
    markerClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 17
    });

    /* Przygotowanie danych - podział na punkty i nie-punkty */
    const pointFeatures = parcels.filter(f => f.geometry.type === 'Point');
    const nonPointFeatures = parcels.filter(f => f.geometry.type !== 'Point');

    /* Tworzenie warstwy GeoJSON dla poligonów i linii */
    geojsonLayer = L.geoJSON(nonPointFeatures, {
        style: (feature) => ({
            ...(STYLES[feature.properties.kategoria] || STYLES.default),
            // Leaflet/Canvas upraszcza geometrię zależnie od zoomu. Wizualnie
            // zostaje praktycznie tak samo, a mniej punktów trafia do renderera.
            smoothFactor: 1.6,
        }),

        onEachFeature: (feature, layer) => {
            const props = feature.properties;
            const kategoria = props.kategoria || "default";

            /* Cache warstwy dla szybkiego wyszukiwania - optymalizacja */
            if (feature.id) {
                layersById.set(feature.id, layer);
            }

            /* Grupowanie warstw według kategorii */
            if (!layersByCategory[kategoria]) {
                layersByCategory[kategoria] = [];
            }
            layersByCategory[kategoria].push(layer);

            /* Konfiguracja popup - pomiń dla obrysu miejscowości */
            if (kategoria !== 'obrys_miejscowosci') {
                const kategoriaDisplay = (props.kategoria || '').replace(/_/g, ' ');
                let popupContent = `<b>Typ:</b> ${kategoriaDisplay}<br><b>Nazwa/Numer:</b> ${props.numer_obiektu}`;
                if (props.wlasciciele?.length > 0) {
                    popupContent += `<br><b>Właściciele:</b> ${props.wlasciciele.map(w => w.nazwa).join(", ")}`;
                }
                layer.bindPopup(popupContent);

                /* Etykiety są renderowane wirtualnie tylko dla widocznego obszaru
                   w updateVisibleParcelLabels(). Wygląd zostaje ten sam, ale DOM
                   nie trzyma naraz etykiet dla wszystkich działek. */
            }

            /* Zdarzenia interakcji - pomiń dla obrysu miejscowości */
            if (kategoria !== 'obrys_miejscowosci') {
                layer.on({
                    mouseover: (e) => handleFeatureMouseover(e, feature),
                    mouseout: (e) => handleFeatureMouseout(e),
                    click: (e) => handleObjectClick(e.target.feature.properties.wlasciciele, e.latlng)
                });
            }
        },
    }).addTo(map);

    /* Tworzenie warstwy dla punktów z clusteringiem */
    const pointLayer = L.geoJSON(pointFeatures, {
        pointToLayer: (feature, latlng) => {
            const marker = L.marker(latlng, { icon: ICONS[feature.properties.kategoria] });

            const props = feature.properties;
            const kategoria = props.kategoria || "default";

            /* Cache warstwy dla szybkiego wyszukiwania - optymalizacja */
            if (feature.id) {
                layersById.set(feature.id, marker);
            }

            /* Grupowanie warstw według kategorii */
            if (!layersByCategory[kategoria]) {
                layersByCategory[kategoria] = [];
            }
            layersByCategory[kategoria].push(marker);

            /* Konfiguracja popup */
            const kategoriaDisplay = (props.kategoria || '').replace(/_/g, ' ');
            let popupContent = `<b>Typ:</b> ${kategoriaDisplay}<br><b>Nazwa/Numer:</b> ${props.numer_obiektu}`;
            if (props.wlasciciele?.length > 0) {
                popupContent += `<br><b>Właściciele:</b> ${props.wlasciciele.map(w => w.nazwa).join(", ")}`;
            }
            marker.bindPopup(popupContent);

            /* Etykiety punktów także renderujemy wirtualnie. */

            /* Dodaj feature do markera dla późniejszego dostępu */
            marker.feature = feature;

            /* Zdarzenia interakcji */
            marker.on({
                mouseover: (e) => handleFeatureMouseover(e, feature),
                mouseout: (e) => handleFeatureMouseout(e),
                click: (e) => handleObjectClick(feature.properties.wlasciciele, latlng)
            });

            return marker;
        }
    });

    markerClusterGroup.addLayer(pointLayer);
    map.addLayer(markerClusterGroup);

    updateVisibleParcelLabels();

    console.log("✅ Zakończono rysowanie obiektów");
}

function updateVisibleParcelLabels() {
    if (!map || !parcelLabelLayer) return;
    parcelLabelLayer.clearLayers();

    // Renderujemy etykiety z dużym zapasem poza ekranem. Dzięki temu podczas
    // przesuwania mapy numery są już gotowe na obrzeżach i nie widać tak mocno
    // efektu „dorysowywania” po puszczeniu myszy.
    const bounds = map.getBounds().pad(0.85);
    const zoom = map.getZoom();
    const focusMode = focusedParcelIds instanceof Set;
    const labelSpacing = getAdaptiveLabelSpacing(zoom, focusMode);
    const occupiedCells = new Set();
    const selectedLabelItems = [];
    const normalLabelItems = [];

    const addLabelForLayer = (layer) => {
        const feature = layer.feature;
        const props = feature?.properties;
        const label = props?.numer_obiektu;
        if (!feature || !props || !label || props.kategoria === 'obrys_miejscowosci') return;

        const center = getCenterOfLayer(layer);
        if (!bounds.contains(center)) return;

        const selected = focusMode && focusedParcelIds.has(Number(feature.id));
        const isPoint = feature.geometry?.type === 'Point';
        const point = map.latLngToLayerPoint(center);
        const item = { feature, label, center, selected, isPoint, point };

        if (selected) selectedLabelItems.push(item);
        else normalLabelItems.push(item);
    };

    if (geojsonLayer) geojsonLayer.eachLayer(addLabelForLayer);
    if (markerClusterGroup) markerClusterGroup.eachLayer(addLabelForLayer);

    // Najpierw zawsze pokazujemy etykiety zaznaczonych działek, potem dokładamy
    // pozostałe tylko jeśli nie kolidują w pikselach. Dzięki temu przy dużej
    // liczbie działek DOM jest mniejszy, a mapa czytelniejsza.
    selectedLabelItems.forEach(item => {
        reserveLabelCell(item.point, labelSpacing, occupiedCells);
        renderVirtualParcelLabel(item);
    });
    normalLabelItems.forEach(item => {
        if (shouldRenderLabelAtPoint(item.point, labelSpacing, occupiedCells)) {
            renderVirtualParcelLabel(item);
        }
    });

    function renderVirtualParcelLabel(item) {
        const className = [
            'parcel-label',
            'virtual-parcel-label',
            item.isPoint ? 'point-label' : '',
            focusMode && !item.selected ? 'parcel-label-dimmed' : '',
            focusMode && item.selected ? 'parcel-label-selected' : '',
        ].filter(Boolean).join(' ');

        const icon = L.divIcon({
            className,
            html: escapeHtml(String(item.label)),
            iconSize: null,
        });
        L.marker(item.center, {
            icon,
            interactive: false,
            keyboard: false,
            zIndexOffset: item.selected ? 1200 : 900,
        }).addTo(parcelLabelLayer);
    }
}

function getAdaptiveLabelSpacing(zoom, focusMode) {
    if (focusMode) return zoom >= 16 ? 14 : 22;
    if (zoom <= 13) return 72;
    if (zoom === 14) return 54;
    if (zoom === 15) return 36;
    if (zoom === 16) return 22;
    return 12;
}

function shouldRenderLabelAtPoint(point, spacing, occupiedCells) {
    const key = labelCellKey(point, spacing);
    if (occupiedCells.has(key)) return false;
    occupiedCells.add(key);
    return true;
}

function reserveLabelCell(point, spacing, occupiedCells) {
    occupiedCells.add(labelCellKey(point, spacing));
}

function labelCellKey(point, spacing) {
    const cellX = Math.round(point.x / spacing);
    const cellY = Math.round(point.y / spacing);
    return `${cellX}:${cellY}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/* ==========================================================================
   PANEL WŁAŚCICIELI
   ========================================================================== */

/**
 * Konfiguruje panel właścicieli z funkcjami wyszukiwania i sortowania.
 * Tworzy karty właścicieli i obsługuje tryb porównywania.
 */
function setupOwnerPanel() {
    const ownerContainer = document.getElementById("ownersList");
    const searchInput = document.getElementById("ownerSearch");
    const compareBtn = document.getElementById("compareModeBtn");
    let currentSort = "byOrder";

    /**
     * Renderuje listę właścicieli.
     * @param {Array} owners - Tablica właścicieli do wyświetlenia
     */
    const render = (owners) => {
        const visibleCountEl = document.getElementById('visible-count');
        if (visibleCountEl) {
            visibleCountEl.textContent = owners.length;
        }
        ownerContainer.innerHTML = "";

        owners.forEach(owner => {
            const card = createOwnerCard(owner);
            ownerContainer.appendChild(card);
        });
    };

    /**
     * Tworzy kartę właściciela z przyciskami akcji.
     * @param {Object} owner - Dane właściciela
     * @returns {HTMLElement} Element karty właściciela
     */
    const createOwnerCard = (owner) => {
        const card = document.createElement("div");
        card.className = "owner-card";
        card.dataset.ownerKey = owner.unikalny_klucz;

        card.innerHTML = `
            <div class="owner-info">
                <div class="owner-details">
                    <div class="owner-name">${owner.nazwa_wlasciciela}</div>
                    <div class="owner-meta">
                        <span><i class="fas fa-hashtag"></i> ${owner.numer_protokolu || "N/A"}</span>
                        <span><i class="fas fa-map"></i> ${(owner.dzialki_rzeczywiste || []).length} działek</span>
                    </div>
                </div>
                <div class="owner-actions">
                    <button class="action-btn" data-type="rzeczywiste" title="Pokaż działki rzeczywiste">
                        <i class="fas fa-map-marked-alt"></i>
                    </button>
                    <button class="action-btn" data-type="protokol" title="Pokaż działki wg protokołu" style="display: none;">
                        <i class="fas fa-file-alt"></i>
                    </button>
                    <button class="action-btn switch-btn" title="Zmień widok działek">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                </div>
            </div>
        `;

        setupOwnerCardEvents(card, owner);
        return card;
    };

    /**
     * Konfiguruje zdarzenia karty właściciela.
     * @param {HTMLElement} card - Element karty
     * @param {Object} owner - Dane właściciela
     */
    const setupOwnerCardEvents = (card, owner) => {
        card.querySelector(".owner-details").onclick = () => {
            handleOwnerClick(owner.unikalny_klucz);
        };

        const btnRzeczywiste = card.querySelector('.action-btn[data-type="rzeczywiste"]');
        const btnProtokol = card.querySelector('.action-btn[data-type="protokol"]');
        const btnSwitch = card.querySelector(".switch-btn");

        const maDzialkiRzeczywiste = owner.dzialki_rzeczywiste?.length > 0;
        const maDzialkiProtokol = owner.dzialki_protokol?.length > 0;

        /* Konfiguracja przycisków działek */
        if (maDzialkiRzeczywiste) {
            btnRzeczywiste.onclick = (e) => {
                e.stopPropagation();
                const ids = owner.dzialki_rzeczywiste.map(p => p.id);
                highlightFeaturesByIds(ids, 'fuchsia', owner.nazwa_wlasciciela, 'Rzeczywiste');
            };
        } else {
            btnRzeczywiste.style.display = "none";
        }

        if (maDzialkiProtokol) {
            btnProtokol.onclick = (e) => {
                e.stopPropagation();
                const ids = owner.dzialki_protokol.map(p => p.id);
                highlightFeaturesByIds(ids, '#ffc107', owner.nazwa_wlasciciela, 'Wg Protokołu');
            };
        } else {
            btnProtokol.style.display = "none";
        }

        /* Przycisk przełączania widoku */
        if (maDzialkiRzeczywiste && maDzialkiProtokol) {
            btnSwitch.style.display = "inline-flex";
            btnSwitch.onclick = (e) => {
                e.stopPropagation();
                const isRzeczywisteVisible = btnRzeczywiste.style.display !== "none";
                btnRzeczywiste.style.display = isRzeczywisteVisible ? "none" : "inline-flex";
                btnProtokol.style.display = isRzeczywisteVisible ? "inline-flex" : "none";
            };
        } else {
            btnSwitch.style.display = "none";
        }

        /* Podświetlanie działek przy najechaniu */
        card.onmouseover = () => highlightOwnerParcels(owner, true);
        card.onmouseout = () => highlightOwnerParcels(owner, false);
    };

    /**
     * Podświetla działki właściciela na mapie.
     * @param {Object} owner - Dane właściciela
     * @param {boolean} highlight - Czy podświetlić
     */
    const highlightOwnerParcels = (owner, highlight) => {
        /* Funkcja pomocnicza do podświetlenia warstwy */
        const highlightLayer = (layer) => {
            if (!layer.feature) return;

            const ownersOnParcel = layer.feature.properties.wlasciciele;
            const isOwnerMatch = ownersOnParcel?.some(o => o.id === owner.id);

            if (isOwnerMatch) {
                if (layer.setStyle) {
                    if (highlight) {
                        layer.setStyle({ weight: 5, color: "lime" });
                        layer.bringToFront();
                    } else {
                        geojsonLayer.resetStyle(layer);
                    }
                } else if (layer instanceof L.Marker) {
                    /* Dla markerów w clusterze możemy zmienić opacity */
                    if (highlight) {
                        layer.setOpacity(1);
                    } else {
                        layer.setOpacity(1);
                    }
                }
            }
        };

        if (geojsonLayer) {
            geojsonLayer.eachLayer(highlightLayer);
        }

        if (markerClusterGroup) {
            markerClusterGroup.eachLayer(highlightLayer);
        }
    };

    /**
     * Sortuje i filtruje listę właścicieli.
     */
    const sortAndFilter = () => {
        let data = [...allOwnersData];

        if (currentSort === "byName") {
            data.sort((a, b) => a.nazwa_wlasciciela.localeCompare(b.nazwa_wlasciciela, "pl"));
        } else if (currentSort === "byParcels") {
            data.sort((a, b) => (b.dzialki_rzeczywiste?.length || 0) - (a.dzialki_rzeczywiste?.length || 0));
        } else {
            data.sort((a, b) => (a.numer_protokolu || 9999) - (b.numer_protokolu || 9999));
        }

        const term = searchInput.value.toLowerCase();
        const filtered = data.filter(o => {
            const ownerName = o.nazwa_wlasciciela.toLowerCase();
            const protocolNumber = o.numer_protokolu ? String(o.numer_protokolu) : "";
            return ownerName.includes(term) || protocolNumber.includes(term);
        });

        render(filtered);
    };

    /**
     * Obsługuje kliknięcie na właściciela.
     * @param {string} ownerKey - Klucz właściciela
     */
    const handleOwnerClick = (ownerKey) => {
        if (!isInCompareMode) {
            window.location.href = `../wlasciciele/protokol.html?ownerId=${ownerKey}`;
        } else {
            handleCompareMode(ownerKey);
        }
    };

    /**
     * Obsługuje tryb porównywania właścicieli.
     * @param {string} ownerKey - Klucz właściciela
     */
    const handleCompareMode = (ownerKey) => {
        const card = ownerContainer.querySelector(`[data-owner-key="${ownerKey}"]`);

        if (selectedForCompare.includes(ownerKey)) {
            selectedForCompare = selectedForCompare.filter(k => k !== ownerKey);
            card.classList.remove("selected-for-compare");
        } else if (selectedForCompare.length < 2) {
            selectedForCompare.push(ownerKey);
            card.classList.add("selected-for-compare");
        }

        if (selectedForCompare.length === 2) {
            window.location.href = `../wlasciciele/compare.html?owners=${selectedForCompare.join(",")}`;
        }
    };

    setupOwnerPanelEventListeners();
    sortAndFilter();

    const totalOwnersElement = document.getElementById('total-owners');
    if (totalOwnersElement) {
        totalOwnersElement.textContent = allOwnersData.length;
    }

    /**
     * Konfiguruje listenery panelu właścicieli.
     */
    function setupOwnerPanelEventListeners() {
        if (compareBtn) {
            compareBtn.addEventListener("click", () => {
                isInCompareMode = !isInCompareMode;
                compareBtn.classList.toggle("active", isInCompareMode);

                const compareInfo = document.querySelector('.compare-info');
                if (compareInfo) {
                    compareInfo.style.display = isInCompareMode ? 'block' : 'none';
                }

                if (!isInCompareMode) {
                    selectedForCompare = [];
                    ownerContainer.querySelectorAll(".selected-for-compare")
                        .forEach(el => el.classList.remove("selected-for-compare"));
                }
            });
        }

        /* Przyciski sortowania */
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const sortType = btn.dataset.sort;
                currentSort = sortType === 'name' ? "byName"
                    : sortType === 'parcels' ? "byParcels"
                        : "byOrder";

                sortAndFilter();
            });
        });

        /* Wyszukiwarka */
        if (searchInput) {
            searchInput.addEventListener("input", sortAndFilter);

            const clearBtn = searchInput.parentElement.querySelector('.clear-search');
            if (clearBtn) {
                searchInput.addEventListener('input', () => {
                    clearBtn.style.display = searchInput.value ? 'block' : 'none';
                });

                clearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    clearBtn.style.display = 'none';
                    sortAndFilter();
                });
            }
        }
    }
}

/* ==========================================================================
   PANEL DZIAŁEK
   ========================================================================== */

/**
 * Konfiguruje panel działek z wyszukiwaniem, filtrowaniem i zakładkami.
 */
function setupParcelPanel() {
    const searchInput = document.getElementById("parcelSearch");
    const dzialkiContainer = document.getElementById("dzialki_panel");
    const obiektyContainer = document.getElementById("obiekty_panel");
    const tabs = document.querySelectorAll(".tab-btn");
    const categoryFilters = document.getElementById("parcel-category-filters");

    /**
     * Renderuje listę działek według aktywnych filtrów.
     */
    const render = () => {
        dzialkiContainer.innerHTML = "";
        obiektyContainer.innerHTML = "";

        const searchTerm = searchInput.value.toLowerCase();

        if (searchTerm === "" && geojsonLayer) {
            geojsonLayer.eachLayer(layer => geojsonLayer.resetStyle(layer));
        }

        const sortedParcels = [...allParcelsData].sort((a, b) =>
            (a.properties.numer_obiektu || "").localeCompare(
                (b.properties.numer_obiektu || ""),
                "pl",
                { numeric: true }
            )
        );

        const filteredList = sortedParcels.filter(p =>
            (p.properties.numer_obiektu || "").toLowerCase().includes(searchTerm)
        );

        const activeCategories = Array.from(
            document.querySelectorAll('#parcel-category-filters input:checked')
        ).map(cb => cb.dataset.category);

        /* Kategoryzacja działek */
        filteredList.forEach(p => {
            const kategoria = p.properties.kategoria;
            const dzialkiCategories = ["budowlana", "rolna", "las", "pastwisko"];
            const infrastrukturaCategories = ["droga", "rzeka"];

            if (!dzialkiCategories.includes(kategoria) && !infrastrukturaCategories.includes(kategoria)) {
                return;
            }

            if (dzialkiCategories.includes(kategoria) && !activeCategories.includes(kategoria)) {
                return;
            }

            const item = createParcelItem(p);

            if (dzialkiCategories.includes(kategoria)) {
                dzialkiContainer.appendChild(item);
            } else {
                obiektyContainer.appendChild(item);
            }
        });

        /* Podświetlanie dokładnych dopasowań */
        if (searchTerm.length > 0) {
            const exactMatches = sortedParcels.filter(
                p => p.properties.numer_obiektu.toLowerCase() === searchTerm
            );
            exactMatches.forEach(p => findAndHighlightLayer(p.id, true, "orange"));
        }

        const totalParcelsElement = document.getElementById('total-parcels');
        if (totalParcelsElement) {
            // Licz wszystkie obiekty oprócz obrysu miejscowości
            const parcelCount = allParcelsData.filter(p =>
                p.properties.kategoria !== 'obrys_miejscowosci'
            ).length;
            totalParcelsElement.textContent = parcelCount;
        }
    };

    /**
     * Tworzy element działki.
     * @param {Object} parcel - Dane działki
     * @returns {HTMLElement} Element działki
     */
    const createParcelItem = (parcel) => {
        const item = document.createElement("div");
        item.className = "parcel-item";
        item.innerHTML = `
            <div class="parcel-info">
                <span class="parcel-number">${parcel.properties.numer_obiektu}</span>
                <span class="parcel-category filter-badge ${parcel.properties.kategoria}">
                    ${parcel.properties.kategoria}
                </span>
            </div>
            <button class="parcel-show-btn" title="Pokaż na mapie">
                <i class="fas fa-crosshairs"></i>
            </button>
        `;
        item.dataset.featureId = parcel.id;

        /* Przycisk "Pokaż na mapie" */
        const showBtn = item.querySelector('.parcel-show-btn');
        showBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const layer = findLayerById(parcel.id);
            if (layer) {
                if (layer.getBounds) {
                    map.fitBounds(layer.getBounds(), { maxZoom: 18 });
                } else if (layer.getLatLng) {
                    map.setView(layer.getLatLng(), 18);
                }
                if (layer.openPopup) {
                    layer.openPopup();
                }
            }
        });

        return item;
    };

    /* Konfiguracja listenerów */
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            // Sprawdź która zakładka jest aktywna
            const activeTab = document.querySelector('.tab-btn.active');
            const activeTabType = activeTab?.dataset.tab;

            if (activeTabType === 'special') {
                // Dla zakładki specjalnej używaj dedykowanej funkcji
                renderSpecialObjects(searchInput.value);

                // Podświetl na mapie dokładne dopasowania
                const searchTerm = searchInput.value.toLowerCase().trim();
                if (searchTerm.length > 0) {
                    const exactMatches = allParcelsData.filter(p => {
                        const kategoria = p.properties.kategoria;
                        const isSpecial = ['kapliczka', 'budynek', 'obiekt_specjalny'].includes(kategoria);
                        const numer = (p.properties.numer_obiektu || '').toLowerCase();
                        return isSpecial && numer === searchTerm;
                    });
                    exactMatches.forEach(p => findAndHighlightLayer(p.id, true, "orange"));
                } else {
                    // Wyczyść podświetlenia gdy puste
                    if (geojsonLayer) {
                        geojsonLayer.eachLayer(layer => geojsonLayer.resetStyle(layer));
                    }
                }
            } else {
                // Dla innych zakładek standardowy render
                render();
            }
        });
    }

    /* Obsługa zakładek */
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

            tab.classList.add("active");
            const tabId = tab.dataset.tab + '-tab';
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add("active");
            }

            /* Ukryj/pokaż filtry kategorii tylko dla zakładki działek */
            if (categoryFilters) {
                categoryFilters.style.display = tab.dataset.tab === 'parcels' ? 'flex' : 'none';
            }

            /* Wyczyść wyszukiwanie przy zmianie zakładki */
            if (searchInput) {
                searchInput.value = '';
            }

            /* Wyczyść podświetlenia na mapie */
            if (geojsonLayer) {
                geojsonLayer.eachLayer(layer => geojsonLayer.resetStyle(layer));
            }

            /* Odśwież zakładkę specjalną jeśli została wybrana */
            if (tab.dataset.tab === 'special') {
                renderSpecialObjects('');
            } else {
                render();
            }
        });
    });

    /* Filtry kategorii */
    if (categoryFilters) {
        categoryFilters.querySelectorAll('input').forEach(checkbox => {
            checkbox.addEventListener('change', render);
        });
    }

    setupParcelInteractions(dzialkiContainer);
    setupParcelInteractions(obiektyContainer);
    renderSpecialObjects();
    render();
}

/**
 * Renderuje sekcję obiektów specjalnych (kapliczki, domy, inne).
 * @param {string} searchTerm - Fraza wyszukiwania (opcjonalna)
 */
function renderSpecialObjects(searchTerm = '') {
    const specialTab = document.getElementById('special-tab');
    const specialContainer = specialTab?.querySelector('.special-objects-list');

    if (!specialContainer) return;

    specialContainer.innerHTML = '';

    const normalizedSearch = searchTerm.toLowerCase().trim();

    /* Kategorie obiektów specjalnych */
    const specialCategories = {
        'kapliczka': { icon: '⛪', label: 'Kapliczki', items: [] },
        'budynek': { icon: '🏠', label: 'Domy', items: [] },
        'obiekt_specjalny': { icon: '⭐', label: 'Obiekty specjalne', items: [] }
    };

    /* Grupowanie obiektów z filtrowaniem */
    allParcelsData.forEach(feature => {
        const kategoria = feature.properties.kategoria;
        if (specialCategories[kategoria]) {
            const numer = (feature.properties.numer_obiektu || '').toLowerCase();
            const wlasciciele = (feature.properties.wlasciciele || [])
                .map(w => w.nazwa.toLowerCase())
                .join(' ');

            // Filtruj jeśli jest wyszukiwanie
            if (normalizedSearch === '' ||
                numer.includes(normalizedSearch) ||
                wlasciciele.includes(normalizedSearch)) {
                specialCategories[kategoria].items.push(feature);
            }
        }
    });

    /* Renderowanie sekcji */
    Object.entries(specialCategories).forEach(([key, category]) => {
        if (category.items.length === 0) return;

        const section = createSpecialCategorySection(category);
        specialContainer.appendChild(section);
    });

    /* Komunikat gdy brak wyników */
    const totalResults = Object.values(specialCategories).reduce((sum, cat) => sum + cat.items.length, 0);
    if (totalResults === 0 && normalizedSearch !== '') {
        specialContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
                <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Nie znaleziono obiektów dla: "${searchTerm}"</p>
            </div>
        `;
    }
}

/* ==========================================================================
   LEGENDA MAPY
   ========================================================================== */

/**
 * Konfiguruje legendę z możliwością przełączania widoczności warstw.
 */
function setupLegend() {
    const legendEl = document.getElementById("legend");
    if (!legendEl) return;

    const legendContainer = legendEl.querySelector("ul");
    const legendHeader = legendEl.querySelector(".legend-header");
    const legendContent = legendEl.querySelector(".legend-content");
    const legendToggle = legendEl.querySelector(".legend-toggle");

    if (!legendContainer || !legendHeader || !legendContent || !legendToggle) return;

    setupLegendToggle(legendHeader, legendContent, legendToggle);

    /* Style kategorii */
    const STYLES = {
        budowlana: { color: "#e67e22" },
        rolna: { color: "#27ae60" },
        las: { fillColor: "#1abc9c" },
        droga: { color: "#8B4513" },
        rzeka: { color: "#3498db" },
        budynek: { color: "#333" },
        kapliczka: { color: "#c0392b" },
        pastwisko: { fillColor: "#f1c40f" },
        obrys_miejscowosci: { color: "#ff0000" },
        obiekt_specjalny: { color: "#2c3e50" },
    };

    /* Etykiety kategorii */
    const legendItems = {
        budowlana: "Działka Budowlana",
        rolna: "Działka Rolna",
        las: "Las",
        pastwisko: "Pastwisko",
        droga: "Droga",
        rzeka: "Rzeka",
        budynek: "Budynek",
        kapliczka: "Kapliczka",
        obrys_miejscowosci: "Obrys Miejscowości",
        obiekt_specjalny: "Obiekt Specjalny",
    };

    /* Renderowanie elementów legendy */
    legendContainer.innerHTML = "";
    Object.entries(legendItems).forEach(([kategoria, label]) => {
        const legendItem = createLegendItem(kategoria, label, STYLES[kategoria]);
        legendContainer.appendChild(legendItem);
    });
}

/* ==========================================================================
   OBSŁUGA INTERFEJSU UŻYTKOWNIKA
   ========================================================================== */

/**
 * Konfiguruje przełączanie paneli bocznych.
 */
function setupPanelToggles() {
    const toggleButtons = document.querySelectorAll('.panel-toggle');
    const expandHandles = document.querySelectorAll('.panel-expand-handle');
    const mapWrapper = document.getElementById('map-wrapper');

    /**
     * Aktualizuje stan mapy po zmianie paneli.
     */
    const updateMapState = () => {
        const leftPanel = document.getElementById('owners-panel');
        const rightPanel = document.getElementById('parcels-panel');

        if (leftPanel.classList.contains('collapsed') && rightPanel.classList.contains('collapsed')) {
            mapWrapper.classList.add('full-width');
            mapWrapper.classList.remove('expanded-left', 'expanded-right');
        } else if (leftPanel.classList.contains('collapsed')) {
            mapWrapper.classList.add('expanded-left');
            mapWrapper.classList.remove('full-width', 'expanded-right');
        } else if (rightPanel.classList.contains('collapsed')) {
            mapWrapper.classList.add('expanded-right');
            mapWrapper.classList.remove('full-width', 'expanded-left');
        } else {
            mapWrapper.classList.remove('full-width', 'expanded-left', 'expanded-right');
        }

        setTimeout(() => map.invalidateSize(), 350);
    };

    /* === MOBILE: Collapse panels by default on small screens === */
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
        const leftPanel = document.getElementById('owners-panel');
        const rightPanel = document.getElementById('parcels-panel');
        const leftHandle = document.querySelector('.panel-expand-handle.left-handle');
        const rightHandle = document.querySelector('.panel-expand-handle.right-handle');

        // Collapse both panels on mobile
        leftPanel.classList.add('collapsed');
        rightPanel.classList.add('collapsed');

        // Show handles
        if (leftHandle) leftHandle.classList.add('handle-visible');
        if (rightHandle) rightHandle.classList.add('handle-visible');

        console.log('📱 Mobile detected - panels collapsed by default');
    }

    /* Przyciski zwijania */
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelType = btn.dataset.panel;
            const panel = document.getElementById(panelType === 'owners' ? 'owners-panel' : 'parcels-panel');
            const handle = document.querySelector(`.panel-expand-handle[data-panel="${panelType}"]`);

            panel.classList.add('collapsed');
            if (handle) {
                handle.classList.add('handle-visible');
            }

            const icon = btn.querySelector('i');
            icon.className = panelType === 'owners' ? 'fas fa-chevron-right' : 'fas fa-chevron-left';

            updateMapState();
        });
    });

    /* Uchwyty rozwijania */
    expandHandles.forEach(handle => {
        handle.addEventListener('click', () => {
            const panelType = handle.dataset.panel;
            const panel = document.getElementById(panelType === 'owners' ? 'owners-panel' : 'parcels-panel');

            panel.classList.remove('collapsed');
            handle.classList.remove('handle-visible');

            const toggleBtn = panel.querySelector('.panel-toggle');
            if (toggleBtn) {
                const icon = toggleBtn.querySelector('i');
                icon.className = panelType === 'owners' ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
            }

            updateMapState();
        });
    });
}

/**
 * Konfiguruje akcje paska narzędzi.
 */
function setupToolbarActions() {
    const helpBtn = document.getElementById('help-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const helpModal = document.getElementById('help-modal');
    const settingsModal = document.getElementById('settings-modal');
    const themeToggle = document.getElementById('theme-toggle');
    const resetViewBtn = document.getElementById('reset-view-btn');

    setupModals(helpBtn, settingsBtn, helpModal, settingsModal);
    setupTheme(themeToggle);

    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', resetView);
    }

    setupKeyboardShortcuts(helpModal, settingsModal);
}

/**
 * Wykonuje wyszukiwanie w danych.
 * @param {string} term - Fraza wyszukiwania
 * @returns {Array} Wyniki wyszukiwania
 */
function performUniversalSearch(term) {
    const ownerResults = allOwnersData
        .filter(owner =>
            owner.nazwa_wlasciciela.toLowerCase().includes(term) ||
            String(owner.numer_protokolu).includes(term)
        )
        .map(owner => ({
            id: owner.unikalny_klucz,
            name: owner.nazwa_wlasciciela,
            lp: owner.numer_protokolu,
            type: 'owner'
        }));

    const parcelResults = allParcelsData
        .filter(p => (p.properties.numer_obiektu || "").toLowerCase().includes(term))
        .map(p => ({
            id: p.id,
            number: p.properties.numer_obiektu,
            category: p.properties.kategoria,
            type: 'parcel'
        }));

    return [...ownerResults, ...parcelResults].slice(0, 10);
}

/**
 * Tworzy element wyniku wyszukiwania.
 * @param {Object} item - Wynik wyszukiwania
 * @returns {HTMLElement} Element wyniku
 */
function createUniversalSearchResultItem(item) {
    const itemEl = document.createElement('div');
    itemEl.className = 'search-result-item';
    itemEl.dataset.id = item.id;
    itemEl.dataset.type = item.type;

    let iconHtml = '';
    let text, meta;

    if (item.type === 'owner') {
        text = item.name;
        meta = `Właściciel (Lp. ${item.lp})`;
    } else {
        iconHtml = '<i class="result-icon fas fa-map-marker-alt"></i>';
        text = `Działka nr ${item.number}`;
        meta = item.category;
    }

    itemEl.innerHTML = `
        ${iconHtml}
        <span class="result-text">${text}</span>
        <span class="result-meta">${meta}</span>
    `;

    return itemEl;
}

/**
 * Konfiguruje uniwersalną wyszukiwarkę (desktop).
 */
function setupUniversalSearch() {
    const searchInput = document.getElementById('universal-search');
    const resultsContainer = document.getElementById('universal-search-results');

    if (!searchInput || !resultsContainer) return;

    const renderResults = (results) => {
        resultsContainer.innerHTML = '';

        if (results.length === 0) {
            resultsContainer.style.display = 'none';
            return;
        }

        results.forEach(item => {
            const itemEl = createUniversalSearchResultItem(item);
            resultsContainer.appendChild(itemEl);
        });

        resultsContainer.style.display = 'block';
    };

    searchInput.addEventListener('input', debounce(() => {
        const term = searchInput.value.toLowerCase().trim();
        if (term.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        const results = performUniversalSearch(term);
        renderResults(results);
    }, 300));

    resultsContainer.addEventListener('click', e => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;

        const { id, type } = item.dataset;

        if (type === 'owner') {
            handleOwnerSearchResult(id);
        } else {
            handleParcelSearchResult(parseInt(id));
        }

        searchInput.value = '';
        resultsContainer.style.display = 'none';
    });

    document.addEventListener('click', e => {
        if (!resultsContainer.contains(e.target) && e.target !== searchInput) {
            resultsContainer.style.display = 'none';
        }
    });
}

/**
 * Konfiguruje wyszukiwarkę mobilną.
 */
function setupMobileSearch() {
    const trigger = document.getElementById('mobile-search-trigger');
    const overlay = document.getElementById('mobile-search-overlay');
    const closeBtn = document.getElementById('close-mobile-search');
    const searchInput = document.getElementById('mobile-universal-search');
    const resultsContainer = document.getElementById('mobile-search-results');

    if (!trigger || !overlay || !closeBtn || !searchInput || !resultsContainer) return;

    const openSearch = () => {
        overlay.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
    };

    const closeSearch = () => {
        overlay.classList.remove('active');
        searchInput.value = '';
        resultsContainer.innerHTML = `
            <div class="search-placeholder">
                <i class="fas fa-search"></i>
                <p>Wpisz co najmniej 2 znaki, aby wyszukać</p>
            </div>
        `;
    };

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        openSearch();
    });

    closeBtn.addEventListener('click', closeSearch);

    searchInput.addEventListener('input', debounce(() => {
        const term = searchInput.value.toLowerCase().trim();
        if (term.length < 2) {
            resultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-search"></i>
                    <p>Wpisz co najmniej 2 znaki, aby wyszukać</p>
                </div>
            `;
            return;
        }

        const results = performUniversalSearch(term);

        resultsContainer.innerHTML = '';
        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-frown"></i>
                    <p>Nie znaleziono wyników dla "${term}"</p>
                </div>
            `;
            return;
        }

        results.forEach(item => {
            const itemEl = createUniversalSearchResultItem(item);
            resultsContainer.appendChild(itemEl);
        });
    }, 300));

    resultsContainer.addEventListener('click', e => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;

        const { id, type } = item.dataset;

        if (type === 'owner') {
            handleOwnerSearchResult(id);
            // Na mobile rozwiń panel właścicieli
            const panel = document.getElementById('owners-panel');
            if (panel && panel.classList.contains('collapsed')) {
                const handle = document.querySelector('.panel-expand-handle.left-handle');
                if (handle) handle.click();
            }
        } else {
            handleParcelSearchResult(parseInt(id));
        }

        closeSearch();
    });
}

/* ==========================================================================
   OBSŁUGA ZDARZEŃ MAPY
   ========================================================================== */

/**
 * Obsługuje najechanie kursorem na obiekt mapy.
 * Zoptymalizowane dla wydajności z dużą ilością obiektów.
 * @param {Event} e - Zdarzenie najechania
 * @param {Object} feature - Obiekt GeoJSON
 */
function handleFeatureMouseover(e, feature) {
    /* Użycie requestAnimationFrame dla płynnych zmian wizualnych */
    requestAnimationFrame(() => {
        const isFocusMode = focusedParcelIds instanceof Set;
        const isFocusedParcel = isFocusMode && focusedParcelIds.has(Number(feature.id));

        if (e.target.setStyle) {
            if (isFocusMode) {
                // Gdy użytkownik ogląda zaznaczone działki właściciela, hover nie może
                // przemalowywać pozostałych działek na inny kolor. Zostawiamy więc
                // wygaszenie tła, a dla zaznaczonych tylko lekko wzmacniamy obrys.
                applyFocusStyleToLayer(e.target, focusedParcelIds);
                if (isFocusedParcel) {
                    e.target.setStyle({ weight: 5, opacity: 1, fillOpacity: 0.45 });
                }
            } else {
                e.target.setStyle({ weight: 5, color: "red" });
            }
        }

        /* Podświetlenie w panelu działek */
        const parcelButton = document.querySelector(`.parcelButton[data-feature-id="${feature.id}"]`);
        if (parcelButton) {
            parcelButton.classList.add("highlighted-by-map");
            checkElementVisibility(parcelButton);
        }

        /* Podświetlenie właścicieli - zoptymalizowane */
        const props = feature.properties;
        const wlasciciele = props.wlasciciele || [];

        /* Tylko jeśli są właściciele */
        if (wlasciciele.length > 0) {
            /* Szybsze wyszukiwanie właścicieli bez zagnieżdżonych pętli */
            wlasciciele.forEach(owner => {
                const ownerTile = document.querySelector(`.ownerIcon[data-owner-key="${owner.unikalny_klucz}"]`);
                if (ownerTile) {
                    ownerTile.classList.add("highlighted-by-map");
                }
            });
        }
    });
}

/**
 * Obsługuje zjechanie kursorem z obiektu mapy.
 * Zoptymalizowane dla wydajności z dużą ilością obiektów.
 * @param {Event} e - Zdarzenie zjechania
 */
function handleFeatureMouseout(e) {
    /* Użycie requestAnimationFrame dla płynnych zmian wizualnych */
    requestAnimationFrame(() => {
        if (geojsonLayer && e.target) {
            geojsonLayer.resetStyle(e.target);
            if (focusedParcelIds) {
                applyFocusStyleToLayer(e.target, focusedParcelIds);
            }
        }

        /* Usunięcie podświetlenia z panelu działek */
        const parcelButton = document.querySelector('.parcelButton.highlighted-by-map');
        if (parcelButton) {
            parcelButton.classList.remove("highlighted-by-map");
            const container = parcelButton.closest('.tab-content-right');
            if (container) {
                container.classList.remove('highlight-indicator-top', 'highlight-indicator-bottom');
            }
        }

        /* Usunięcie podświetlenia właścicieli - batch update dla wydajności */
        const highlightedOwners = document.querySelectorAll(".ownerIcon.highlighted-by-map");
        if (highlightedOwners.length > 0) {
            highlightedOwners.forEach(tile => {
                tile.classList.remove("highlighted-by-map");
            });
        }
    });
}

/**
 * Konfiguruje interakcje panelu działek.
 * @param {HTMLElement} container - Kontener działek
 */
function setupParcelInteractions(container) {
    if (!container) return;

    container.addEventListener("mouseover", (e) => {
        const item = e.target.closest(".parcel-item");
        if (item) {
            findAndHighlightLayer(parseInt(item.dataset.featureId), true);
        }
    });

    container.addEventListener("mouseout", (e) => {
        const item = e.target.closest(".parcel-item");
        if (item) {
            findAndHighlightLayer(parseInt(item.dataset.featureId), false);
        }
    });

    container.addEventListener("click", (e) => {
        const item = e.target.closest(".parcel-item");
        if (item) {
            const featureId = parseInt(item.dataset.featureId);
            const layer = findLayerById(featureId);
            if (!layer) return;

            if (layer.getBounds) {
                map.fitBounds(layer.getBounds());
            } else if (layer.getLatLng) {
                map.panTo(layer.getLatLng());
            }

            const wlasciciele = layer.feature.properties.wlasciciele;
            handleObjectClick(wlasciciele, layer);
        }
    });
}

/* Przycisk czyszczenia podświetleń */
const clearHighlightBtn = document.getElementById("clearHighlightBtn");
if (clearHighlightBtn) {
    clearHighlightBtn.addEventListener("click", clearAllHighlights);
}

/* ==========================================================================
   FUNKCJE PODŚWIETLANIA
   ========================================================================== */

/**
 * Podświetla obiekty na mapie według ID.
 * @param {Array} featureIds - Tablica ID obiektów
 * @param {string} color - Kolor podświetlenia
 * @param {string} ownerName - Opcjonalna nazwa właściciela
 * @param {string} ownershipType - Opcjonalny typ własności
 */
function highlightFeaturesByIds(featureIds, color, ownerName = null, ownershipType = null) {
    resetDimmedParcelFocus();
    if (highlightedLayer) {
        map.removeLayer(highlightedLayer);
    }

    highlightedLayer = new L.FeatureGroup();

    const highlightStyle = {
        color: color,
        weight: 5,
        fillColor: color,
        fillOpacity: 0.5,
    };

    /* Funkcja pomocnicza do tworzenia podświetlenia */
    const createHighlight = (layer) => {
        if (!featureIds.includes(layer.feature.id)) return;

        let clonedLayer;

        if (layer instanceof L.Polygon) {
            clonedLayer = L.polygon(layer.getLatLngs(), { ...highlightStyle, interactive: false });
        } else if (layer instanceof L.Polyline) {
            clonedLayer = L.polyline(layer.getLatLngs(), { ...highlightStyle, fill: false, interactive: false });
        } else if (layer instanceof L.Marker) {
            clonedLayer = L.circleMarker(layer.getLatLng(), { radius: 15, ...highlightStyle, interactive: false });
        }

        if (clonedLayer) {
            highlightedLayer.addLayer(clonedLayer);
        }
    };

    /* Tworzenie warstw podświetleń - z geojsonLayer */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(createHighlight);
    }

    /* Tworzenie warstw podświetleń - z markerClusterGroup */
    if (markerClusterGroup) {
        markerClusterGroup.eachLayer(createHighlight);
    }

    if (highlightedLayer.getLayers().length > 0) {
        applyDimmedParcelFocus(featureIds);
        highlightedLayer.addTo(map);

        /* Sprawdź czy jest parametr zoom w URL */
        const params = new URLSearchParams(window.location.search);
        const customZoom = params.get('zoom');

        if (customZoom) {
            /* Użyj customowego zoom */
            const bounds = highlightedLayer.getBounds();
            const center = bounds.getCenter();
            map.setView(center, parseInt(customZoom));
        } else {
            /* Domyślne fitBounds */
            map.fitBounds(highlightedLayer.getBounds());
        }

        document.getElementById("highlight-controls").classList.remove("hidden");

        /* Dodaj wpis właściciela do legendy jeśli podano */
        if (ownerName) {
            addOwnerToLegend(ownerName, color, ownershipType);
        }
    }

    const selectedCountEl = document.getElementById('selected-count');
    if (selectedCountEl) {
        selectedCountEl.textContent = highlightedLayer.getLayers().length;
    }
}

/**
 * Podświetla działki właścicieli z kolorowaniem.
 * @param {Array} uniqueOwnerKeys - Klucze właścicieli
 * @param {string} ownershipType - Typ własności
 */
function highlightAndColorOwners(uniqueOwnerKeys, ownershipType = 'wszystkie') {
    console.log('🎨 highlightAndColorOwners wywołane:', {
        ownerKeys: uniqueOwnerKeys,
        ownershipType: ownershipType,
        liczba: uniqueOwnerKeys.length
    });

    if (ownerHighlightLayer) {
        map.removeLayer(ownerHighlightLayer);
    }
    resetDimmedParcelFocus();

    if (uniqueOwnerKeys.length === 0) {
        console.warn('⚠️ Brak kluczy właścicieli do podświetlenia');
        return;
    }

    const ownerColorMap = assignColorsToOwners(uniqueOwnerKeys, ownershipType);
    ownerHighlightLayer = new L.FeatureGroup();

    console.log('🗺️ Przetwarzanie warstw:', {
        geojsonLayer: !!geojsonLayer,
        markerClusterGroup: !!markerClusterGroup
    });

    let foundCount = 0;
    const selectedIds = new Set();

    /* Przetwarzanie warstw z geojsonLayer */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const beforeCount = ownerHighlightLayer.getLayers().length;
            if (processLayerForOwnerHighlight(layer, ownerColorMap, ownershipType)) {
                selectedIds.add(Number(layer.feature.id));
            }
            const afterCount = ownerHighlightLayer.getLayers().length;
            if (afterCount > beforeCount) foundCount++;
        });
    }

    /* Przetwarzanie warstw z markerClusterGroup */
    if (markerClusterGroup) {
        markerClusterGroup.eachLayer(layer => {
            const beforeCount = ownerHighlightLayer.getLayers().length;
            if (processLayerForOwnerHighlight(layer, ownerColorMap, ownershipType)) {
                selectedIds.add(Number(layer.feature.id));
            }
            const afterCount = ownerHighlightLayer.getLayers().length;
            if (afterCount > beforeCount) foundCount++;
        });
    }

    console.log('✅ Znaleziono i podświetlono działek:', foundCount);
    console.log('📍 Łączna liczba warstw w ownerHighlightLayer:', ownerHighlightLayer.getLayers().length);

    if (ownerHighlightLayer.getLayers().length > 0) {
        applyDimmedParcelFocus([...selectedIds]);
        ownerHighlightLayer.addTo(map);
        map.fitBounds(ownerHighlightLayer.getBounds());
        createOwnerHighlightLegend(uniqueOwnerKeys, ownerColorMap);
        document.getElementById("highlight-controls").classList.remove("hidden");
        console.log('✨ Podświetlenie dodane do mapy');
    } else {
        console.error('❌ Nie znaleziono żadnych działek do podświetlenia!');
    }
}

/**
 * Podświetla działki według numerów.
 * @param {Array<string>} parcelNumbers - Tablica numerów działek do zaznaczenia
 */
function highlightParcels(parcelNumbers) {
    if (ownerHighlightLayer) {
        map.removeLayer(ownerHighlightLayer);
    }
    resetDimmedParcelFocus();

    if (!parcelNumbers || parcelNumbers.length === 0) return;

    ownerHighlightLayer = new L.FeatureGroup();
    let foundCount = 0;
    const selectedIds = new Set();

    /* Przetwarzanie wszystkich warstw */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const props = layer.feature?.properties;
            const objectNumber = String(props?.numer_obiektu ?? '').trim();
            if (props && parcelNumbers.includes(objectNumber)) {
                const highlightStyle = {
                    color: '#FF0000',
                    weight: 4,
                    fillOpacity: 0.4,
                    fillColor: '#FF0000'
                };

                const highlightedCopy = L.geoJSON(layer.toGeoJSON(), {
                    style: { ...highlightStyle, interactive: false },
                    interactive: false,
                    pointToLayer: (feature, latlng) => {
                        return L.circleMarker(latlng, {
                            ...highlightStyle,
                            radius: 8,
                            interactive: false
                        });
                    }
                });
                ownerHighlightLayer.addLayer(highlightedCopy);
                selectedIds.add(Number(layer.feature.id));
                foundCount++;
            }
        });
    }

    if (ownerHighlightLayer.getLayers().length > 0) {
        applyDimmedParcelFocus([...selectedIds]);
        ownerHighlightLayer.addTo(map);
        map.fitBounds(ownerHighlightLayer.getBounds());
        console.log(`✅ Znaleziono i zaznaczono ${foundCount} działek`);
    } else {
        console.warn('⚠️ Nie znaleziono działek o podanych numerach');
    }
}

/**
 * Podświetla rzeki według nazw.
 * @param {Array<string>} riverNames - Tablica nazw rzek do zaznaczenia
 */
function highlightRivers(riverNames) {
    if (ownerHighlightLayer) {
        map.removeLayer(ownerHighlightLayer);
    }

    if (!riverNames || riverNames.length === 0) return;

    ownerHighlightLayer = new L.FeatureGroup();
    let foundCount = 0;

    /* Przetwarzanie wszystkich warstw */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const props = layer.feature?.properties;
            const objectNumber = String(props?.numer_obiektu ?? '').trim();
            if (props && props.kategoria === 'rzeka' && riverNames.includes(objectNumber)) {
                const highlightStyle = {
                    color: '#0000FF',
                    weight: 5,
                    opacity: 0.8
                };

                const highlightedCopy = L.geoJSON(layer.toGeoJSON(), {
                    style: highlightStyle
                });
                ownerHighlightLayer.addLayer(highlightedCopy);
                foundCount++;
            }
        });
    }

    if (ownerHighlightLayer.getLayers().length > 0) {
        ownerHighlightLayer.addTo(map);
        map.fitBounds(ownerHighlightLayer.getBounds());
        console.log(`✅ Znaleziono i zaznaczono ${foundCount} rzek`);
    } else {
        console.warn('⚠️ Nie znaleziono rzek o podanych nazwach');
    }
}

/**
 * Podświetla drogi według nazw.
 * @param {Array<string>} roadNames - Tablica nazw dróg do zaznaczenia
 */
function highlightRoads(roadNames) {
    if (ownerHighlightLayer) {
        map.removeLayer(ownerHighlightLayer);
    }

    if (!roadNames || roadNames.length === 0) return;

    ownerHighlightLayer = new L.FeatureGroup();
    let foundCount = 0;

    /* Przetwarzanie wszystkich warstw */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const props = layer.feature?.properties;
            const objectNumber = String(props?.numer_obiektu ?? '').trim();
            if (props && props.kategoria === 'droga' && roadNames.includes(objectNumber)) {
                const highlightStyle = {
                    color: '#FFA500',
                    weight: 5,
                    opacity: 0.8
                };

                const highlightedCopy = L.geoJSON(layer.toGeoJSON(), {
                    style: highlightStyle
                });
                ownerHighlightLayer.addLayer(highlightedCopy);
                foundCount++;
            }
        });
    }

    if (ownerHighlightLayer.getLayers().length > 0) {
        ownerHighlightLayer.addTo(map);
        map.fitBounds(ownerHighlightLayer.getBounds());
        console.log(`✅ Znaleziono i zaznaczono ${foundCount} dróg`);
    } else {
        console.warn('⚠️ Nie znaleziono dróg o podanych nazwach');
    }
}

/**
 * Czyści wszystkie podświetlenia na mapie.
 */
function clearAllHighlights() {
    if (highlightedLayer) {
        map.removeLayer(highlightedLayer);
        highlightedLayer = null;
    }

    if (ownerHighlightLayer) {
        map.removeLayer(ownerHighlightLayer);
        ownerHighlightLayer = null;
    }

    resetDimmedParcelFocus();

    document.getElementById("highlight-controls")?.classList.add("hidden");

    /* Usuń dynamiczne wpisy właścicieli z legendy */
    const mainLegend = document.getElementById("legend");
    if (mainLegend) {
        const legendList = mainLegend.querySelector(".legend-list");
        if (legendList) {
            legendList.querySelectorAll('.legend-item-owner').forEach(item => item.remove());
            legendList.querySelector('.legend-separator')?.remove();
        }
    }

    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => geojsonLayer.resetStyle(layer));
    }

    /* Czyszczenie parametrów URL */
    const url = new URL(window.location);
    url.searchParams.delete("parcels");
    url.searchParams.delete("highlightTopOwners");
    url.searchParams.delete("highlightByIds");
    url.searchParams.delete("highlightParcels");
    url.searchParams.delete("highlightParcel");
    url.searchParams.delete("highlightRivers");
    url.searchParams.delete("highlightRoads");
    history.pushState({}, "", url);

    const selectedCountEl = document.getElementById('selected-count');
    if (selectedCountEl) {
        selectedCountEl.textContent = 0;
    }
}

function applyDimmedParcelFocus(featureIds) {
    const selected = new Set((featureIds || []).map(id => Number(id)).filter(id => !Number.isNaN(id)));
    if (selected.size === 0) return;

    focusedParcelIds = selected;
    document.getElementById('map')?.classList.add('selection-focus-mode');

    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => applyFocusStyleToLayer(layer, selected));
    }
    if (markerClusterGroup) {
        markerClusterGroup.eachLayer(layer => applyFocusStyleToLayer(layer, selected));
    }
    updateVisibleParcelLabels();
}

function resetDimmedParcelFocus() {
    focusedParcelIds = null;
    document.getElementById('map')?.classList.remove('selection-focus-mode');

    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            if (layer.setStyle) geojsonLayer.resetStyle(layer);
            setLayerTooltipFocus(layer, false, false);
        });
    }
    if (markerClusterGroup) {
        markerClusterGroup.eachLayer(layer => {
            if (layer.setOpacity) layer.setOpacity(1);
            setLayerTooltipFocus(layer, false, false);
        });
    }
    updateVisibleParcelLabels();
}

function applyFocusStyleToLayer(layer, selectedSet) {
    const featureId = Number(layer.feature?.id);
    const isSelected = selectedSet.has(featureId);
    setLayerTooltipFocus(layer, isSelected, true);

    if (layer.setStyle) {
        if (isSelected) {
            // Zaznaczone działki rysujemy osobną, kolorową warstwą ponad mapą.
            // Oryginał pod spodem chowamy, żeby hover Leafleta nie mieszał jego
            // niebieskiego obrysu z kolorem zaznaczenia.
            layer.setStyle({ opacity: 0.01, fillOpacity: 0.01, weight: 0 });
            if (layer.bringToFront) layer.bringToFront();
        } else {
            layer.setStyle({ color: '#64748b', weight: 1, opacity: 0.34, fillOpacity: 0.08 });
        }
    } else if (layer.setOpacity) {
        layer.setOpacity(isSelected ? 1 : 0.18);
    }
}

function setLayerTooltipFocus(layer, isSelected, focusMode) {
    const tooltip = layer.getTooltip?.();
    const el = tooltip?.getElement?.();
    if (!el) return;
    el.classList.toggle('parcel-label-dimmed', !!focusMode && !isSelected);
    el.classList.toggle('parcel-label-selected', !!focusMode && !!isSelected);
}

/* ==========================================================================
   OBSŁUGA PARAMETRÓW URL
   ========================================================================== */

/**
 * Przetwarza parametry URL i wykonuje odpowiednie akcje.
 */
function handleUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const idsToHighlight = new Set();
    let popupInfo = null;

    /* Parametr highlightByIds */
    const idsParam = params.get("highlightByIds");
    if (idsParam) {
        idsParam.split(',')
            .map(id => parseInt(id.trim()))
            .filter(id => !isNaN(id))
            .forEach(id => idsToHighlight.add(id));
    }

    /* Parametr highlightTopOwners */
    const ownersParam = params.get("highlightTopOwners");
    if (ownersParam) {
        let ownershipType = params.get("ownership") || "wszystkie";

        // Konwersja z angielskiego na polskie wartości (dla kompatybilności ze starym kodem)
        if (ownershipType === "real") ownershipType = "rzeczywista";
        if (ownershipType === "protocol") ownershipType = "protokol";

        const uniqueOwnerKeys = [...new Set(
            ownersParam.split(",").map(key => key.trim()).filter(Boolean)
        )];

        console.log('🎯 Parametry z URL:', {
            kluczeWlascicieli: uniqueOwnerKeys,
            typWlasnosci: ownershipType,
            liczbaKluczy: uniqueOwnerKeys.length
        });

        if (uniqueOwnerKeys.length > 0) {
            highlightAndColorOwners(uniqueOwnerKeys, ownershipType);
        }
    }

    /* Parametr highlightParcels */
    const parcelsParam = params.get("highlightParcels") || params.get("highlightParcel");
    if (parcelsParam) {
        const parcelNumbers = [...new Set(
            parcelsParam.split(",").map(num => num.trim()).filter(Boolean)
        )];

        if (parcelNumbers.length > 0) {
            highlightParcels(parcelNumbers);
        }
    }

    /* Parametr highlightRivers */
    const riversParam = params.get("highlightRivers");
    if (riversParam) {
        const riverNames = [...new Set(
            riversParam.split(",").map(name => name.trim()).filter(Boolean)
        )];

        if (riverNames.length > 0) {
            highlightRivers(riverNames);
        }
    }

    /* Parametr highlightRoads */
    const roadsParam = params.get("highlightRoads");
    if (roadsParam) {
        const roadNames = [...new Set(
            roadsParam.split(",").map(name => name.trim()).filter(Boolean)
        )];

        if (roadNames.length > 0) {
            highlightRoads(roadNames);
        }
    }

    /* Parametr findHouseNumber */
    const houseNumberParam = params.get("findHouseNumber");
    if (houseNumberParam) {
        const ownerName = params.get("ownerName") || '';
        const houseFeature = findHouseFeature(houseNumberParam);

        if (houseFeature) {
            idsToHighlight.add(houseFeature.id);
            popupInfo = {
                latlng: getCenterOfFeature(houseFeature),
                content: `
                    <div style="text-align: center;">
                        <h3>🏠 Dom nr ${houseNumberParam}</h3>
                        ${ownerName ? `<p><b>Właściciel:</b> ${ownerName}</p>` : ''}
                    </div>`
            };
        } else {
            console.warn(`Nie znaleziono domu o numerze ${houseNumberParam}`);
        }
    }

    /* Zastosowanie podświetleń */
    if (idsToHighlight.size > 0) {
        highlightFeaturesByIds(Array.from(idsToHighlight), '#ffc107');
    }

    if (popupInfo) {
        // map.setView(popupInfo.latlng, 11); // Usunięto, ponieważ highlightFeaturesByIds już robi fitBounds
        L.popup()
            .setLatLng(popupInfo.latlng)
            .setContent(popupInfo.content)
            .openOn(map);
    }
}

function isRealOwnershipType(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') === 'wlasnosc rzeczywista';
}

/**
 * Obsługuje pokazywanie domu właściciela z parametrów URL.
 */
async function handleShowHouseByOwnerKeyFromURL() {
    const params = new URLSearchParams(location.search);
    const ownerKey = params.get('ownerKey');
    const showWhat = params.get('show');

    if (!ownerKey || showWhat !== 'house') return;

    /* Pobieranie danych właściciela */
    let ownerData = null;
    try {
        const resp = await fetch(`/api/wlasciciel/${encodeURIComponent(ownerKey)}`);
        if (!resp.ok) return;
        ownerData = await resp.json();
    } catch (e) {
        console.error('Błąd pobierania właściciela:', e);
        return;
    }

    if (!ownerData) return;

    /* Oczekiwanie na gotowość warstw */
    try {
        await whenGeoJSONIsReady();
    } catch (_) { }

    const ownerName = ownerData.nazwa_wlasciciela || '';
    const houseNo = ownerData.dom_numer || ownerData.numer_domu || '';
    const objectId = ownerData.dom_obiekt_id;

    const popupHtml = `
        <div>
            <b>🏠 Dom nr ${houseNo || '—'}</b><br/>
            <span>Właściciel: ${ownerName}</span>
        </div>`;

    /* Próba znalezienia domu */
    if (objectId && focusFeatureById(objectId, popupHtml)) return;
    if (houseNo && focusHouseByNumberAndOwner(houseNo, ownerData.id, ownerName)) return;

    /* Fallback - szukanie po numerze */
    if (houseNo) {
        let candidateId = null;
        map.eachLayer(l => {
            if (!l || !l.feature) return;
            const p = l.feature.properties || {};
            if ((p.kategoria === 'budynek' || p.kategoria === 'dom') &&
                String(p.numer_obiektu || '').trim() === String(houseNo).trim()) {
                candidateId = l.feature.id;
            }
        });
        if (candidateId != null) {
            focusFeatureById(candidateId, popupHtml);
        }
    }
}

/* ==========================================================================
   FUNKCJE POMOCNICZE
   ========================================================================== */

/**
 * Czeka na gotowość warstw GeoJSON.
 * @param {number} maxTries - Maksymalna liczba prób
 * @param {number} delayMs - Opóźnienie między próbami
 * @returns {Promise} Promise rozwiązywany gdy warstwy są gotowe
 */
function whenGeoJSONIsReady(maxTries = 30, delayMs = 150) {
    return new Promise((resolve, reject) => {
        let tries = 0;
        const tick = () => {
            let hasFeatureLayer = false;
            map.eachLayer(l => {
                if (l && l.feature) hasFeatureLayer = true;
            });

            if (hasFeatureLayer) return resolve();
            if (++tries >= maxTries) return reject(new Error('GeoJSON layers not ready'));
            setTimeout(tick, delayMs);
        };
        tick();
    });
}

/**
 * Znajduje i fokusuje obiekt według ID.
 * @param {string|number} objectId - ID obiektu
 * @param {string} popupHtml - HTML dla popup
 * @returns {boolean} Czy znaleziono obiekt
 */
function focusFeatureById(objectId, popupHtml) {
    const layer = findLayerById(parseInt(objectId));

    if (!layer) return false;

    try {
        /* Jeśli marker jest w clusterze, najpierw go pokaż */
        if (markerClusterGroup && markerClusterGroup.hasLayer(layer)) {
            markerClusterGroup.zoomToShowLayer(layer, () => {
                /* Po rozpakowaniu clustera, przybliż i otwórz popup */
                if (layer.getLatLng) {
                    map.setView(layer.getLatLng(), 18);
                }

                if (popupHtml) {
                    layer.bindPopup(popupHtml, { maxWidth: 320 }).openPopup();
                }
            });
        } else {
            /* Dla poligonów i linii */
            if (layer.getBounds) {
                map.fitBounds(layer.getBounds(), { maxZoom: 19, padding: [20, 20] });
            } else if (layer.getLatLng) {
                map.setView(layer.getLatLng(), 18);
            }

            /* Stylizacja dla poligonów */
            if (layer.setStyle && layer.feature.geometry?.type !== 'Point') {
                layer.setStyle({
                    color: 'fuchsia',
                    weight: 4,
                    fillColor: 'fuchsia',
                    fillOpacity: 0.35
                });
                if (layer.bringToFront) layer.bringToFront();
            }

            /* Popup */
            if (popupHtml) {
                layer.bindPopup(popupHtml, { maxWidth: 320 }).openPopup();
            }
        }

        return true;
    } catch (e) {
        console.warn('Nie udało się podświetlić obiektu:', e);
        return false;
    }
}

/**
 * Znajduje dom według numeru i właściciela.
 * @param {string} houseNumber - Numer domu
 * @param {string|number} ownerId - ID właściciela
 * @param {string} ownerName - Nazwa właściciela
 * @returns {boolean} Czy znaleziono dom
 */
function focusHouseByNumberAndOwner(houseNumber, ownerId, ownerName) {
    let match = null;

    /* Funkcja pomocnicza do sprawdzenia warstwy */
    const checkLayer = (layer) => {
        if (!layer || !layer.feature) return false;

        const f = layer.feature;
        const p = f.properties || {};
        const isHouseCat = (p.kategoria === 'budynek' || p.kategoria === 'dom');
        const sameNumber = String(p.numer_obiektu || '').trim() === String(houseNumber).trim();
        const owners = Array.isArray(p.wlasciciele) ? p.wlasciciele : [];
        const hasOwner = owners.some(o => String(o.id) === String(ownerId));

        if (isHouseCat && sameNumber && (hasOwner || owners.length === 0)) {
            match = f.id;
            return true;
        }
        return false;
    };

    /* Szukaj w geojsonLayer */
    if (geojsonLayer) {
        geojsonLayer.eachLayer(checkLayer);
    }

    /* Szukaj w markerClusterGroup */
    if (!match && markerClusterGroup) {
        markerClusterGroup.eachLayer(checkLayer);
    }

    if (match != null) {
        const html = `
            <div>
                <b>🏠 Dom nr ${houseNumber}</b><br/>
                <span>Właściciel: ${ownerName || 'nieznany'}</span>
            </div>`;
        return focusFeatureById(match, html);
    }

    return false;
}

/**
 * Znajduje obiekt domu według numeru.
 * @param {string} houseNumber - Numer domu
 * @returns {Object|null} Obiekt domu lub null
 */
function findHouseFeature(houseNumber) {
    const searchNumber = String(houseNumber).trim().toLowerCase();

    for (const feature of allParcelsData) {
        const props = feature.properties;
        const isHouse = props.kategoria === 'budynek' || props.kategoria === 'dom';
        const numberMatch = (props.numer_obiektu || '').toLowerCase() === searchNumber;

        if (isHouse && numberMatch) {
            return feature;
        }
    }

    return null;
}

/**
 * Oblicza środek geometrii obiektu.
 * @param {Object} feature - Obiekt GeoJSON
 * @returns {L.LatLng} Środek geometrii
 */
function getCenterOfFeature(feature) {
    const layer = findLayerById(feature.id);
    if (layer) {
        return getCenterOfLayer(layer);
    }

    const coords = feature.geometry.coordinates;
    if (feature.geometry.type === 'Point') {
        return L.latLng(coords[1], coords[0]);
    } else {
        return L.latLng(coords[0][0][1], coords[0][0][0]);
    }
}

/**
 * Znajduje warstwę po ID - zoptymalizowane z użyciem cache.
 * Zmiana z O(n) na O(1) dla lepszej wydajności przy 1000+ obiektach.
 * @param {number} featureId - ID feature do znalezienia
 * @returns {L.Layer|null} - Znaleziona warstwa lub null
 */
function findLayerById(featureId) {
    /* Szybkie wyszukiwanie z cache - O(1) zamiast O(n) */
    return layersById.get(featureId) || null;
}

/**
 * Oblicza środek warstwy.
 * @param {L.Layer} layer - Warstwa Leaflet
 * @returns {L.LatLng} Środek warstwy
 */
function getCenterOfLayer(layer) {
    if (layer.getBounds) return layer.getBounds().getCenter();
    if (layer.getLatLng) return layer.getLatLng();
    return map.getCenter();
}

/**
 * Ustawia widok mapy na warstwę.
 * @param {L.Layer} layer - Warstwa do wycentrowania
 */
function focusOnLayer(layer) {
    if (!layer) return;

    if (layer.getBounds) {
        map.fitBounds(layer.getBounds());
    } else if (layer.getLatLng) {
        map.setView(layer.getLatLng(), Math.max(map.getZoom(), 11));
    }
}

/**
 * Podświetla lub resetuje styl warstwy.
 * @param {number} featureId - ID obiektu
 * @param {boolean} shouldHighlight - Czy podświetlić
 * @param {string} highlightColor - Kolor podświetlenia
 */
function findAndHighlightLayer(featureId, shouldHighlight, highlightColor = "lime") {
    if (document.getElementById("parcelSearch").value.length > 0 && highlightColor === "lime") {
        return;
    }

    const layer = findLayerById(featureId);
    if (layer) {
        if (focusedParcelIds) {
            applyFocusStyleToLayer(layer, focusedParcelIds);
            if (shouldHighlight && focusedParcelIds.has(Number(featureId)) && layer.setStyle) {
                layer.setStyle({ weight: 5, opacity: 1, fillOpacity: 0.45 });
            }
            return;
        }

        if (shouldHighlight) {
            if (layer.setStyle) layer.setStyle({ weight: 5, color: highlightColor });
            if (layer.bringToFront) layer.bringToFront();
        } else {
            if (layer.setStyle) geojsonLayer.resetStyle(layer);
        }
    }
}

/**
 * Obsługuje kliknięcie na obiekt mapy.
 * @param {Array} wlasciciele - Lista właścicieli obiektu
 * @param {L.LatLng|L.Layer} latlngOrLayer - Pozycja lub warstwa
 */
function handleObjectClick(wlasciciele, latlngOrLayer) {
    wlasciciele = uniqueOwnersForPopup(wlasciciele);

    if (!wlasciciele || wlasciciele.length === 0) {
        if (latlngOrLayer instanceof L.Layer) {
            focusOnLayer(latlngOrLayer);
            if (latlngOrLayer.getPopup()) {
                latlngOrLayer.openPopup();
            }
        }
        return;
    }

    if (wlasciciele.length === 1) {
        map.closePopup();
        window.location.href = getProtocolUrl(wlasciciele[0].unikalny_klucz);
    } else {
        const latlng = latlngOrLayer instanceof L.LatLng ? latlngOrLayer : getCenterOfLayer(latlngOrLayer);
        showOwnerSelectionPopup(wlasciciele, latlng);
    }
}

function getProtocolUrl(ownerKey) {
    return `/wlasciciele/protokol.html?ownerId=${encodeURIComponent(ownerKey || '')}`;
}

function uniqueOwnersForPopup(wlasciciele) {
    if (!Array.isArray(wlasciciele)) return [];
    const seen = new Set();
    return wlasciciele.filter(w => {
        const key = w?.unikalny_klucz || `id:${w?.id}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Wyświetla popup wyboru właściciela.
 * @param {Array} wlasciciele - Lista właścicieli
 * @param {L.LatLng} latlng - Pozycja popup
 */
function showOwnerSelectionPopup(wlasciciele, latlng) {
    wlasciciele = uniqueOwnersForPopup(wlasciciele);

    let listaHtml = "<h3>Ta działka ma wielu właścicieli.<br>Wybierz protokół:</h3><ul>";

    wlasciciele.forEach(w => {
        const ownerDetails = allOwnersData.find(o => o.id === w.id);
        const lp = ownerDetails ? ownerDetails.numer_protokolu : "N/A";
        listaHtml += `
            <li>
                <a href="#" class="protocol-link-in-popup" 
                   data-url="${getProtocolUrl(w.unikalny_klucz)}">
                   ${w.nazwa} (Lp. ${lp})
                </a>
            </li>`;
    });
    listaHtml += "</ul>";

    const popup = L.popup().setLatLng(latlng).setContent(listaHtml).openOn(map);

    /* Obsługa kliknięć na linki: contentupdate w Leaflet nie zawsze odpala po openOn(). */
    const bindPopupLinks = () => {
        const element = popup.getElement();
        if (!element) return;
        element.querySelectorAll(".protocol-link-in-popup").forEach(link => {
            link.addEventListener("click", e => {
                e.preventDefault();
                const url = e.currentTarget.dataset.url;
                map.closePopup();
                window.location.href = url;
            }, { once: true });
        });
    };

    bindPopupLinks();
    map.once('popupopen', bindPopupLinks);
}

/**
 * Sprawdza widoczność elementu w kontenerze.
 * @param {HTMLElement} element - Element do sprawdzenia
 */
function checkElementVisibility(element) {
    const container = element.closest('.tab-content-right');
    if (!container) return;

    container.classList.remove('highlight-indicator-top', 'highlight-indicator-bottom');

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const isFullyVisible =
        elementRect.top >= containerRect.top &&
        elementRect.bottom <= containerRect.bottom;

    if (!isFullyVisible) {
        if (elementRect.top < containerRect.top) {
            container.classList.add('highlight-indicator-top');
        } else if (elementRect.bottom > containerRect.bottom) {
            container.classList.add('highlight-indicator-bottom');
        }
    }
}

/**
 * Tworzy sekcję kategorii specjalnej.
 * @param {Object} category - Dane kategorii
 * @returns {HTMLElement} Element sekcji
 */
function createSpecialCategorySection(category) {
    const section = document.createElement('div');
    section.className = 'special-category-section';
    section.innerHTML = `
        <h4 class="special-category-header">
            <span>${category.icon}</span>
            <span>${category.label} (${category.items.length})</span>
        </h4>
        <div class="special-items-list"></div>
    `;

    const itemsList = section.querySelector('.special-items-list');

    /* Sortowanie po numerze */
    category.items.sort((a, b) => {
        const numA = parseInt(a.properties.numer_obiektu) || 0;
        const numB = parseInt(b.properties.numer_obiektu) || 0;
        return numA - numB;
    });

    category.items.forEach(item => {
        const itemEl = createSpecialObjectItem(item, category.icon);
        itemsList.appendChild(itemEl);
    });

    return section;
}

/**
 * Tworzy element obiektu specjalnego.
 * @param {Object} item - Dane obiektu
 * @param {string} icon - Ikona obiektu
 * @returns {HTMLElement} Element obiektu
 */
function createSpecialObjectItem(item, icon) {
    const itemEl = document.createElement('div');
    itemEl.className = 'special-item';
    itemEl.dataset.featureId = item.id;

    const owners = item.properties.wlasciciele || [];
    const ownerNames = owners.map(o => o.nazwa).join(', ') || 'Brak właściciela';

    itemEl.innerHTML = `
        <div class="special-item-content">
            <div class="special-item-header">
                <span class="special-item-icon">${icon}</span>
                <span class="special-item-number">${item.properties.numer_obiektu || 'Bez numeru'}</span>
            </div>
            <div class="special-item-owners">${ownerNames}</div>
        </div>
        <button class="special-show-btn" title="Pokaż na mapie">
            <i class="fas fa-crosshairs"></i>
        </button>
    `;

    /* Przycisk "Pokaż na mapie" - zoom do obiektu */
    const showBtn = itemEl.querySelector('.special-show-btn');
    showBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = findLayerById(item.id);
        if (layer) {
            if (layer.getBounds) {
                map.fitBounds(layer.getBounds(), { maxZoom: 18 });
            } else if (layer.getLatLng) {
                map.setView(layer.getLatLng(), 18);
            }
            if (layer.openPopup) {
                layer.openPopup();
            }
        }
    });

    /* Kliknięcie na element - przekierowanie do protokołu właściciela */
    itemEl.addEventListener('click', () => {
        if (owners.length === 0) {
            alert('Ten obiekt nie ma przypisanego właściciela.');
            return;
        }

        if (owners.length === 1) {
            // Bezpośrednie przekierowanie gdy jest jeden właściciel
            const ownerKey = owners[0].unikalny_klucz;
            if (ownerKey) {
                window.location.href = `../wlasciciele/protokol.html?ownerId=${ownerKey}`;
            } else {
                alert('Brak klucza właściciela dla tego obiektu.');
            }
        } else {
            // Popup wyboru gdy jest wielu właścicieli
            const layer = findLayerById(item.id);
            const latlng = layer ? getCenterOfLayer(layer) : map.getCenter();
            showOwnerSelectionPopup(owners, latlng);
        }
    });

    /* Podświetlanie przy najechaniu */
    itemEl.addEventListener('mouseenter', () => {
        findAndHighlightLayer(item.id, true, 'red');
    });

    itemEl.addEventListener('mouseleave', () => {
        findAndHighlightLayer(item.id, false);
    });

    return itemEl;
}

/**
 * Konfiguruje zwijanie legendy.
 * @param {HTMLElement} header - Nagłówek legendy
 * @param {HTMLElement} content - Zawartość legendy
 * @param {HTMLElement} toggle - Przycisk zwijania
 */
function setupLegendToggle(header, content, toggle) {
    const legendEl = document.getElementById("legend");
    if (!legendEl) return;

    header.addEventListener("click", () => {
        legendEl.classList.toggle("collapsed");

        const isCollapsed = legendEl.classList.contains("collapsed");
        if (isCollapsed) {
            toggle.querySelector('i').className = 'fas fa-chevron-up';
        } else {
            toggle.querySelector('i').className = 'fas fa-chevron-down';
        }
    });
}

/**
 * Tworzy element legendy.
 * @param {string} kategoria - Kategoria obiektu
 * @param {string} label - Etykieta w legendzie
 * @param {Object} style - Style wizualne
 * @returns {HTMLElement} Element legendy
 */
function createLegendItem(kategoria, label, style) {
    const li = document.createElement("li");
    li.dataset.kategoria = kategoria;
    li.className = "legend-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.className = "legend-checkbox";
    checkbox.id = `legend-${kategoria}`;

    const colorBox = document.createElement("span");
    colorBox.className = "legend-color-box";
    colorBox.style.backgroundColor = style?.fillColor || style?.color || "#ccc";

    const labelEl = document.createElement("label");
    labelEl.htmlFor = `legend-${kategoria}`;
    labelEl.className = "legend-label";
    labelEl.textContent = label;

    li.appendChild(checkbox);
    li.appendChild(colorBox);
    li.appendChild(labelEl);

    /* Obsługa przełączania warstw */
    checkbox.addEventListener("change", () => {
        const layers = layersByCategory[kategoria];

        if (layers) {
            /* Kategorie punktowe są w markerClusterGroup */
            const isPointCategory = ['budynek', 'kapliczka', 'obiekt_specjalny'].includes(kategoria);

            if (checkbox.checked) {
                if (isPointCategory && markerClusterGroup) {
                    layers.forEach(layer => markerClusterGroup.addLayer(layer));
                } else {
                    layers.forEach(layer => map.addLayer(layer));
                }
                li.classList.remove("inactive");
            } else {
                if (isPointCategory && markerClusterGroup) {
                    layers.forEach(layer => markerClusterGroup.removeLayer(layer));
                } else {
                    layers.forEach(layer => map.removeLayer(layer));
                }
                li.classList.add("inactive");
            }
        }
    });

    return li;
}

/**
 * Przypisuje kolory do właścicieli.
 * @param {Array} ownerKeys - Klucze właścicieli
 * @param {string} ownershipType - Typ własności
 * @returns {Object} Mapa kolorów właścicieli
 */
function assignColorsToOwners(ownerKeys, ownershipType) {
    const colorMap = {};
    let colorIndex = 0;

    ownerKeys.forEach(key => {
        if (ownershipType === "wszystkie") {
            colorMap[key] = {
                rzeczywista: HIGHLIGHT_COLORS[colorIndex % HIGHLIGHT_COLORS.length],
                protokol: HIGHLIGHT_COLORS[(colorIndex + 1) % HIGHLIGHT_COLORS.length],
            };
            colorIndex += 2;
        } else {
            colorMap[key] = HIGHLIGHT_COLORS[colorIndex % HIGHLIGHT_COLORS.length];
            colorIndex++;
        }
    });

    return colorMap;
}

/**
 * Przetwarza warstwę dla podświetlenia właściciela.
 * @param {L.Layer} layer - Warstwa do przetworzenia
 * @param {Object} ownerColorMap - Mapa kolorów właścicieli
 * @param {string} ownershipType - Typ własności
 */
function processLayerForOwnerHighlight(layer, ownerColorMap, ownershipType) {
    const parcelOwners = layer.feature?.properties?.wlasciciele;
    if (!parcelOwners) return false;

    // Szukaj właściciela który pasuje do ownerColorMap I ma odpowiedni typ własności
    let matchedOwner;

    // Sprawdź czy KTÓRYKOLWIEK właściciel tej działki jest w ownerColorMap
    const hasAnyOwnerInMap = parcelOwners.some(o => ownerColorMap[o.unikalny_klucz]);

    if (ownershipType === "rzeczywista") {
        // Szukaj właściciela z własnością rzeczywistą
        matchedOwner = parcelOwners.find(o =>
            ownerColorMap[o.unikalny_klucz] &&
            isRealOwnershipType(o.typ_posiadania)
        );

        // DEBUG: jeśli jest właściciel w mapie, ale nie znaleziono dopasowania
        if (hasAnyOwnerInMap && !matchedOwner) {
            console.warn('⚠️ Działka ma właściciela z listy, ale BEZ własności rzeczywistej:', {
                numerDzialki: layer.feature?.properties?.numer_obiektu,
                wlasciciele: parcelOwners.map(o => ({
                    klucz: o.unikalny_klucz,
                    nazwa: o.nazwa,
                    typ: o.typ_posiadania,
                    czyWMapie: !!ownerColorMap[o.unikalny_klucz]
                }))
            });
        }
    } else if (ownershipType === "protokol") {
        // Szukaj właściciela bez własności rzeczywistej
        matchedOwner = parcelOwners.find(o =>
            ownerColorMap[o.unikalny_klucz] &&
            !isRealOwnershipType(o.typ_posiadania)
        );
    } else {
        // Wszystkie - znajdź pierwszego właściciela z listy
        matchedOwner = parcelOwners.find(o => ownerColorMap[o.unikalny_klucz]);
    }

    if (!matchedOwner) return false;

    const ownerKey = matchedOwner.unikalny_klucz;
    const isReal = isRealOwnershipType(matchedOwner.typ_posiadania);

    const color = (typeof ownerColorMap[ownerKey] === "object")
        ? (isReal ? ownerColorMap[ownerKey].rzeczywista : ownerColorMap[ownerKey].protokol)
        : ownerColorMap[ownerKey];

    /* Tworzenie sklonowanej warstwy */
    let clonedLayer;
    if (layer instanceof L.Polygon) {
        clonedLayer = L.polygon(layer.getLatLngs(), {
            color,
            weight: 3,
            fillColor: color,
            fillOpacity: 0.6,
            interactive: false
        });
    } else if (layer instanceof L.Polyline) {
        clonedLayer = L.polyline(layer.getLatLngs(), {
            color,
            weight: 5,
            interactive: false
        });
    } else if (layer instanceof L.Marker) {
        clonedLayer = L.circleMarker(layer.getLatLng(), {
            radius: 10,
            color: 'black',
            weight: 2,
            fillColor: color,
            fillOpacity: 1,
            interactive: false
        });
    }

    if (clonedLayer) {
        ownerHighlightLayer.addLayer(clonedLayer);
        return true;
    }

    return false;
}

/**
 * Dodaje pojedynczego właściciela do legendy.
 * @param {string} ownerName - Nazwa właściciela
 * @param {string} color - Kolor podświetlenia
 * @param {string} ownershipType - Typ własności
 */
function addOwnerToLegend(ownerName, color, ownershipType = null) {
    const mainLegend = document.getElementById("legend");
    if (!mainLegend) return;

    const legendList = mainLegend.querySelector(".legend-list");
    if (!legendList) return;

    /* Usuń poprzednie dynamiczne wpisy właścicieli */
    legendList.querySelectorAll('.legend-item-owner').forEach(item => item.remove());

    /* Dodaj separator jeśli jeszcze nie istnieje */
    let separator = legendList.querySelector('.legend-separator');
    if (!separator) {
        separator = document.createElement("hr");
        separator.className = "legend-separator";
        separator.style.margin = "10px 0";
        separator.style.border = "none";
        separator.style.borderTop = "1px solid var(--border-color)";
        legendList.appendChild(separator);
    }

    /* Stwórz etykietę */
    let label = `Działki - ${ownerName}`;
    if (ownershipType) {
        label += ` (${ownershipType})`;
    }

    const li = createOwnerLegendItem(label, color);
    legendList.appendChild(li);
}

/**
 * Tworzy legendę podświetlonych właścicieli w głównej legendzie.
 * @param {Array} ownerKeys - Klucze właścicieli
 * @param {Object} colorMap - Mapa kolorów
 */
function createOwnerHighlightLegend(ownerKeys, colorMap) {
    const mainLegend = document.getElementById("legend");
    if (!mainLegend) return;

    const legendList = mainLegend.querySelector(".legend-list");
    if (!legendList) return;

    /* Usuń poprzednie dynamiczne wpisy właścicieli */
    legendList.querySelectorAll('.legend-item-owner').forEach(item => item.remove());

    /* Dodaj separator jeśli jeszcze nie istnieje */
    let separator = legendList.querySelector('.legend-separator');
    if (!separator && ownerKeys.length > 0) {
        separator = document.createElement("hr");
        separator.className = "legend-separator";
        separator.style.margin = "10px 0";
        separator.style.border = "none";
        separator.style.borderTop = "1px solid var(--border-color)";
        legendList.appendChild(separator);
    }

    /* Dodaj wpisy właścicieli */
    ownerKeys.forEach(ownerKey => {
        const owner = allOwnersData.find(o => o.unikalny_klucz === ownerKey);
        if (!owner) return;

        const colorData = colorMap[ownerKey];
        if (typeof colorData === "object") {
            /* Rzeczywista */
            const li1 = createOwnerLegendItem(
                owner.nazwa_wlasciciela + " (Rzeczywiste)",
                colorData.rzeczywista
            );
            legendList.appendChild(li1);

            /* Protokół */
            const li2 = createOwnerLegendItem(
                owner.nazwa_wlasciciela + " (Wg Protokołu)",
                colorData.protokol
            );
            legendList.appendChild(li2);
        } else {
            const li = createOwnerLegendItem(
                owner.nazwa_wlasciciela,
                colorData
            );
            legendList.appendChild(li);
        }
    });
}

/**
 * Tworzy element legendy dla właściciela.
 * @param {string} label - Etykieta właściciela
 * @param {string} color - Kolor podświetlenia
 * @returns {HTMLElement} Element legendy
 */
function createOwnerLegendItem(label, color) {
    const li = document.createElement("li");
    li.className = "legend-item legend-item-owner";
    li.style.opacity = "1";

    const colorBox = document.createElement("span");
    colorBox.className = "legend-color-box";
    colorBox.style.backgroundColor = color;

    const labelSpan = document.createElement("span");
    labelSpan.className = "legend-label";
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = "600";
    labelSpan.style.color = "var(--accent-color)";

    li.appendChild(colorBox);
    li.appendChild(labelSpan);

    return li;
}

/* ==========================================================================
   FUNKCJE INTERFEJSU UŻYTKOWNIKA
   ========================================================================== */

/**
 * Konfiguruje modale pomocy i ustawień.
 * @param {HTMLElement} helpBtn - Przycisk pomocy
 * @param {HTMLElement} settingsBtn - Przycisk ustawień
 * @param {HTMLElement} helpModal - Modal pomocy
 * @param {HTMLElement} settingsModal - Modal ustawień
 */
function setupModals(helpBtn, settingsBtn, helpModal, settingsModal) {
    const openModal = modal => modal.style.display = 'flex';
    const closeModal = modal => modal.style.display = 'none';

    helpBtn.addEventListener('click', () => openModal(helpModal));
    settingsBtn.addEventListener('click', () => openModal(settingsModal));

    [helpModal, settingsModal].forEach(modal => {
        modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal(modal);
        });
    });
}

/**
 * Konfiguruje przełącznik motywu jasnego/ciemnego.
 * @param {HTMLElement} toggle - Przełącznik motywu
 */
function setupTheme(toggle) {
    const applyTheme = (theme) => {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        toggle.checked = (theme === 'dark');
    };

    const savedTheme = localStorage.getItem('mapTheme') || 'light';
    applyTheme(savedTheme);

    toggle.addEventListener('change', () => {
        const newTheme = toggle.checked ? 'dark' : 'light';
        localStorage.setItem('mapTheme', newTheme);
        applyTheme(newTheme);
    });
}

/**
 * Resetuje widok aplikacji do stanu początkowego.
 */
function resetView() {
    /* Zwijanie paneli */
    document.getElementById('owners-panel').classList.add('collapsed');
    document.getElementById('parcels-panel').classList.add('collapsed');

    document.querySelector('.panel-expand-handle.left-handle').classList.add('handle-visible');
    document.querySelector('.panel-expand-handle.right-handle').classList.add('handle-visible');

    clearAllHighlights();

    /* Reset widoku mapy */
    if (geojsonLayer && geojsonLayer.getLayers().length > 0) {
        map.fitBounds(geojsonLayer.getBounds());
    }

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.style.display = 'none';
    }
}

/**
 * Konfiguruje skróty klawiszowe aplikacji.
 * @param {HTMLElement} helpModal - Modal pomocy
 * @param {HTMLElement} settingsModal - Modal ustawień
 */
function setupKeyboardShortcuts(helpModal, settingsModal) {
    document.addEventListener('keydown', event => {
        const activeElement = document.activeElement;
        if (activeElement &&
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            if (event.key !== 'Escape') return;
        }

        /* Ctrl+F - wyszukiwanie */
        if (event.ctrlKey && event.key === 'f') {
            event.preventDefault();
            document.getElementById('universal-search').focus();
        }

        /* +/- - zoom */
        if (event.key === '+') {
            event.preventDefault();
            map.zoomIn();
        }

        if (event.key === '-') {
            event.preventDefault();
            map.zoomOut();
        }

        /* Escape - zamykanie */
        if (event.key === 'Escape') {
            event.preventDefault();

            if (helpModal.style.display === 'flex') {
                helpModal.style.display = 'none';
            } else if (settingsModal.style.display === 'flex') {
                settingsModal.style.display = 'none';
            } else {
                const clearBtn = document.getElementById('clearHighlightBtn');
                if (clearBtn && !clearBtn.parentElement.classList.contains('hidden')) {
                    clearBtn.click();
                }
            }
        }
    });
}

/**
 * Konfiguruje kontrolkę przezroczystości mapy historycznej.
 */
function setupHistoricalMapOpacityControl() {
    // Czekamy aż mapa i kontrolka warstw będą dostępne
    const trySetup = () => {
        const layersControl = document.querySelector('.leaflet-control-layers-list');

        if (!historicalMapOverlay || !layersControl) {
            setTimeout(trySetup, 100);
            return;
        }

        // Sprawdzamy czy już nie został dodany
        if (document.querySelector('.opacity-control-inline')) {
            return;
        }

        // Tworzymy kontrolkę przezroczystości
        const opacityControl = document.createElement('div');
        opacityControl.className = 'opacity-control-inline';
        opacityControl.innerHTML = `
            <div class="opacity-inline-header">
                <i class="fas fa-adjust"></i>
                <span>Przezroczystość mapy XIX w.</span>
            </div>
            <div class="opacity-inline-slider-container">
                <input type="range" min="0" max="100" value="100" 
                       class="opacity-inline-slider" id="historical-opacity-slider">
                <div class="opacity-inline-value">
                    <span id="opacity-percentage">100</span>%
                </div>
            </div>
        `;

        // Dodajemy na końcu kontrolki warstw
        layersControl.appendChild(opacityControl);

        // Konfigurujemy slider
        const opacitySlider = document.getElementById('historical-opacity-slider');
        const opacityPercentage = document.getElementById('opacity-percentage');

        opacitySlider.addEventListener('input', (e) => {
            const value = e.target.value;
            const opacity = value / 100;

            historicalMapOverlay.setOpacity(opacity);
            opacityPercentage.textContent = value;
        });

        // Inicjalizacja wartości początkowej
        historicalMapOverlay.setOpacity(1);

        console.log("✅ Kontrolka przezroczystości dodana do panelu warstw");
    };

    trySetup();
}

/**
 * Obsługuje wynik wyszukiwania właściciela.
 * @param {string} ownerKey - Klucz właściciela
 */
function handleOwnerSearchResult(ownerKey) {
    const ownerCard = document.querySelector(`.owner-card[data-owner-key="${ownerKey}"]`);
    if (ownerCard) {
        ownerCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ownerCard.style.transition = 'all 0.2s ease';
        ownerCard.style.transform = 'scale(1.05)';
        setTimeout(() => {
            ownerCard.style.transform = 'scale(1)';
        }, 1000);
    }
}

/**
 * Obsługuje wynik wyszukiwania działki.
 * @param {number} parcelId - ID działki
 */
function handleParcelSearchResult(parcelId) {
    const layer = findLayerById(parcelId);
    if (layer) {
        focusOnLayer(layer);
        if (layer.openPopup) {
            layer.openPopup();
        }
    }
}
