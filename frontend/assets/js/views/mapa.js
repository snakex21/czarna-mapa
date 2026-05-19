// =============================================================================
// MAPA.JS — Widok mapy katastralnej (Leaflet)
// =============================================================================

const MapaView = {
    map: null,
    geoJsonLayer: null,
    initialized: false,

    async init() {
        if (this.initialized) return;

        const kalibracja = await API.konfiguracja.pobierzKalibracje();
        const center = [
            (kalibracja.sw.lat + kalibracja.ne.lat) / 2,
            (kalibracja.sw.lng + kalibracja.ne.lng) / 2,
        ];

        this.map = L.map('leaflet-map').setView(center, 14);

        // Podkład mapowy OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data &copy; OpenStreetMap contributors',
            maxZoom: 19,
        }).addTo(this.map);

        // Ładuj obiekty przy ruchu mapy
        this.map.on('moveend', () => this.ladujObiekty());
        this.map.on('click', (e) => this.kliknietoMape(e));

        this.initialized = true;
        await this.ladujObiekty();
    },

    async ladujObiekty() {
        const bounds = this.map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();

        const obiekty = await API.mapa.pobierzObiekty({
            sw_lat: sw.lat,
            sw_lng: sw.lng,
            ne_lat: ne.lat,
            ne_lng: ne.lng,
        });

        this.wyswietlObiekty(obiekty);
    },

    wyswietlObiekty(obiekty) {
        if (this.geoJsonLayer) {
            this.map.removeLayer(this.geoJsonLayer);
        }

        const features = obiekty
            .filter(o => o.geometria_geojson)
            .map(o => {
                try {
                    const geom = JSON.parse(o.geometria_geojson);
                    return {
                        type: 'Feature',
                        geometry: geom,
                        properties: {
                            id: o.id,
                            nazwa: o.nazwa_lub_numer || o.nazwa_lub_numer,
                            kategoria: o.kategoria,
                        },
                    };
                } catch(e) {
                    console.warn('Nieprawidłowy GeoJSON:', o.id, e);
                    return null;
                }
            })
            .filter(f => f !== null);

        this.geoJsonLayer = L.geoJSON(features, {
            style: (feature) => this.stylDzialki(feature),
            onEachFeature: (feature, layer) => {
                layer.on('click', () => this.kliknietoDzialke(feature));
            },
        }).addTo(this.map);
    },

    stylDzialki(feature) {
        const kategoria = feature.properties.kategoria;
        const colors = {
            'dzialka': { fillColor: '#3388ff', color: '#2266cc', weight: 1, fillOpacity: 0.2 },
            'droga': { fillColor: '#ffaa33', color: '#cc8822', weight: 2, fillOpacity: 0.4 },
            'budynek': { fillColor: '#ff4444', color: '#cc3333', weight: 1, fillOpacity: 0.5 },
            'rzeka': { fillColor: '#33aaff', color: '#2288cc', weight: 2, fillOpacity: 0.4 },
            'specjalny': { fillColor: '#aa44ff', color: '#8833cc', weight: 2, fillOpacity: 0.3 },
        };
        return colors[kategoria] || { fillColor: '#999', color: '#666', weight: 1, fillOpacity: 0.2 };
    },

    async kliknietoDzialke(feature) {
        const obiektId = feature.properties.id;
        const panel = document.getElementById('info-content');
        const title = document.getElementById('info-title');

        title.textContent = `${feature.properties.kategoria}: ${feature.properties.nazwa}`;

        const wlasciciele = await API.mapa.pobierzWlascicieliObiektu(obiektId);

        if (wlasciciele.length === 0) {
            panel.innerHTML = '<p class="text-muted">Brak przypisanych właścicieli</p>';
        } else {
            panel.innerHTML = wlasciciele.map(w => `
                <div class="owner-card">
                    <strong>${w.nazwa_wlasciciela}</strong>
                    ${w.typ_posiadania ? `<span class="badge">${w.typ_posiadania}</span>` : ''}
                </div>
            `).join('');
        }
    },

    async kliknietoMape(e) {
        const { lat, lng } = e.latlng;
        const obiekt = await API.mapa.pobierzPoPunkcie(lat, lng);
        // Obsługa w razie potrzeby
    },
};
