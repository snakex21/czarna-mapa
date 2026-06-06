/* global window, maplibregl */
/**
 * Moduł warstwy "Punkty historyczne" dla mapy.
 *
 * Wzorzec z "Projekt Mapa Czarna" (FastAPI): osobna warstwa na mapie z
 * metadanymi (display_name, description, source_note) i galerią zdjęć.
 *
 * - Pobiera FeatureCollection z POST /api/rpc {cmd:'pobierz_punkty_historyczne'}
 * - Renderuje markery jako brązowe koła z białym obwodem + tekst label (display_name)
 * - Popup: display_name + description + galeria (img + caption) + source_note
 * - Kliknięcie powiększa zdjęcie do modala
 *
 * Warstwa points-icons w map-script-v2.js ma filtr wykluczający
 * kategoria='obiekt_specjalny' — żeby nie było duplikatów (dwa markery w
 * tym samym miejscu, dwa popupy).
 */
(function () {
    'use strict';

    const API_CMD = 'pobierz_punkty_historyczne';
    const SOURCE_ID = 'historical-points';
    const LAYER_CIRCLE = 'historical-points-circle';
    const LAYER_LABEL = 'historical-points-label';
    const LAYER_HALO = 'historical-points-halo';

    let initialized = false;
    let mapInstance = null;

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parsePhotos(v) {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch (_) {}
        }
        return [];
    }

    function buildPopupHtml(props) {
        if (!props) return '<div class="hp-popup">Brak danych</div>';
        const title = escapeHtml(props.display_name || props.object_name || 'Punkt historyczny');
        const description = props.description
            ? `<div class="hp-popup-description">${escapeHtml(props.description).replace(/\n/g, '<br>')}</div>`
            : '';
        const photos = parsePhotos(props.photos);
        const photosHtml = photos.length
            ? `<div class="hp-popup-photos">${photos.map(p => {
                const filename = escapeHtml(p.filename || '');
                const caption = escapeHtml(p.caption || '');
                const fullUrl = `/point_photos/${encodeURIComponent(filename)}`;
                const thumbUrl = `/obj_thumb?path=point_photos/${encodeURIComponent(filename)}&w=400`;
                return `<figure class="hp-popup-photo" data-full="${fullUrl}" data-caption="${caption}">
                    <img src="${thumbUrl}" alt="${filename}" loading="lazy"
                         onerror="this.parentNode.style.display='none'"/>
                    ${caption ? `<figcaption>${caption}</figcaption>` : ''}
                </figure>`;
            }).join('')}</div>`
            : '';
        const source = props.source_note
            ? `<div class="hp-popup-source"><strong>Źródło:</strong> ${escapeHtml(props.source_note)}</div>`
            : '';
        return `<div class="hp-popup">
            <h3 class="hp-popup-title">${title}</h3>
            ${description}
            ${photosHtml}
            ${source}
        </div>`;
    }

    function ensureLayers() {
        if (!mapInstance.getSource(SOURCE_ID)) {
            mapInstance.addSource(SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        // Halo pod spodem — dla highlightingu jak w innych warstwach
        if (!mapInstance.getLayer(LAYER_HALO)) {
            mapInstance.addLayer({
                id: LAYER_HALO, type: 'circle', source: SOURCE_ID,
                minzoom: 12,
                paint: {
                    'circle-color': '#ffc107',
                    'circle-radius': 16,
                    'circle-opacity': 0.55,
                    'circle-stroke-color': '#fff',
                    'circle-stroke-width': 2,
                    'circle-stroke-opacity': 0.9,
                }
            });
        }
        if (!mapInstance.getLayer(LAYER_CIRCLE)) {
            mapInstance.addLayer({
                id: LAYER_CIRCLE, type: 'circle', source: SOURCE_ID,
                minzoom: 12,
                paint: {
                    'circle-color': '#8b4513',
                    'circle-radius': 8,
                    'circle-stroke-color': '#fff8dc',
                    'circle-stroke-width': 3,
                }
            });
        }
        if (!mapInstance.getLayer(LAYER_LABEL)) {
            mapInstance.addLayer({
                id: LAYER_LABEL, type: 'symbol', source: SOURCE_ID,
                minzoom: 14,
                layout: {
                    'text-field': ['coalesce', ['get', 'display_name'], ['get', 'object_name']],
                    'text-size': 12,
                    'text-offset': [0, 1.4],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-optional': true,
                },
                paint: {
                    'text-color': '#3e2723',
                    'text-halo-color': '#fff8dc',
                    'text-halo-width': 1.5,
                }
            });
        }
        return true;
    }

    function bindPopup() {
        // Klik → popup
        mapInstance.on('click', LAYER_CIRCLE, (e) => {
            const feature = e.features && e.features[0];
            if (!feature) return;
            e.originalEvent?.stopPropagation?.();
            new maplibregl.Popup({ maxWidth: '360px', closeButton: true })
                .setLngLat(feature.geometry.coordinates.slice())
                .setHTML(buildPopupHtml(feature.properties))
                .addTo(mapInstance);
        });
        // Hover cursor
        mapInstance.on('mouseenter', LAYER_CIRCLE, () => {
            mapInstance.getCanvas().style.cursor = 'pointer';
        });
        mapInstance.on('mouseleave', LAYER_CIRCLE, () => {
            mapInstance.getCanvas().style.cursor = '';
        });
        // Klik na zdjęcie w popupie → modal powiększenia
        mapInstance.on('click', (e) => {
            const fig = e.originalEvent?.target?.closest?.('.hp-popup-photo');
            if (!fig) return;
            e.preventDefault();
            e.stopPropagation();
            openPhotoModal(fig.dataset.full, fig.dataset.caption);
        });
    }

    // Modal powiększenia zdjęcia — tworzony raz
    let photoModalEl = null;
    function openPhotoModal(src, caption) {
        if (!photoModalEl) {
            photoModalEl = document.createElement('div');
            photoModalEl.className = 'hp-photo-modal';
            photoModalEl.innerHTML = `
                <div class="hp-photo-modal-backdrop"></div>
                <div class="hp-photo-modal-card">
                    <button class="hp-photo-modal-close" type="button" aria-label="Zamknij">&times;</button>
                    <img class="hp-photo-modal-img" src="" alt="">
                    <div class="hp-photo-modal-caption"></div>
                </div>`;
            document.body.appendChild(photoModalEl);
            photoModalEl.querySelector('.hp-photo-modal-backdrop').addEventListener('click', closePhotoModal);
            photoModalEl.querySelector('.hp-photo-modal-close').addEventListener('click', closePhotoModal);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && photoModalEl?.classList.contains('open')) closePhotoModal();
            });
        }
        photoModalEl.querySelector('.hp-photo-modal-img').src = src;
        photoModalEl.querySelector('.hp-photo-modal-caption').textContent = caption || '';
        photoModalEl.classList.add('open');
    }
    function closePhotoModal() {
        if (photoModalEl) {
            photoModalEl.classList.remove('open');
            photoModalEl.querySelector('.hp-photo-modal-img').src = '';
        }
    }

    async function fetchAndRender() {
        try {
            const res = await fetch('/api/rpc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: API_CMD, args: {} }),
            });
            if (!res.ok) {
                console.warn('[historical-points] API zwróciło', res.status);
                return;
            }
            const data = await res.json();
            if (!data || !Array.isArray(data.features)) {
                console.warn('[historical-points] Nieprawidłowa odpowiedź (brak features)');
                return;
            }
            const src = mapInstance.getSource(SOURCE_ID);
            if (src) src.setData(data);
            console.info(`[historical-points] Załadowano ${data.features.length} punktów`);
        } catch (err) {
            console.warn('[historical-points] Błąd pobierania:', err);
        }
    }

    function init(map) {
        if (initialized) return;
        if (!map || typeof map.addSource !== 'function') {
            console.warn('[historical-points] brak instancji mapy');
            return;
        }
        mapInstance = map;
        if (!ensureLayers()) return;
        bindPopup();
        fetchAndRender();
        initialized = true;
    }

    async function reload() {
        if (!initialized) return;
        await fetchAndRender();
    }

    function setVisibility(visible) {
        if (!mapInstance || !initialized) return;
        const v = visible ? 'visible' : 'none';
        [LAYER_CIRCLE, LAYER_LABEL, LAYER_HALO].forEach(id => {
            if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, 'visibility', v);
        });
    }

    window.HistoricalPoints = Object.freeze({
        init, reload, setVisibility,
        SOURCE_ID, LAYER_CIRCLE, LAYER_LABEL, LAYER_HALO,
    });
})();
