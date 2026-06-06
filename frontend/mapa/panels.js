/* ==========================================================================
   Plik: panels.js
   Opis: Panele właścicieli i działek dla MapLibre v2.
         Komunikuje się z mapą wyłącznie przez globalne API w window.MapV2.
         Brak bezpośrednich odwołań do MapLibre/Leafleta — czyste DOM + dane.
   ========================================================================== */

(function () {
    'use strict';

    // Stan paneli
    let isInCompareMode = false;
    let selectedForCompare = [];
    let legendVisibilityByCategory = {};

    // Cache DOM dla synchronizacji hover mapa↔panele
    const parcelButtonsByFeatureId = new Map();
    const ownerCardsByKey = new Map();

    // Ekspozycja API paneli dla mapy
    window.PanelsV2 = {
        init,
        rebuildDomCaches,
        highlightOwnerByFeatureHover,
        clearHoverHighlights,
        scrollToParcelButton,
    };

    function init({ owners, parcels }) {
        window.__owners = owners;
        window.__parcels = parcels;

        setupOwnerPanel(owners);
        setupParcelPanel(parcels);
        setupLegend();
        setupPanelToggles();
        setupToolbarActions();
        setupUniversalSearch(owners, parcels);
        setupMobileSearch(owners, parcels);
        setupClearHighlightButton();

        rebuildDomCaches();
        // Po pierwszym rebuild kart właścicieli/działek — nowe kafelki dochodzą.
        setTimeout(rebuildDomCaches, 600);
    }

    /* ==========================================================================
       PANEL WŁAŚCICIELI
       ========================================================================== */

    function setupOwnerPanel(allOwnersData) {
        const ownerContainer = document.getElementById('ownersList');
        const searchInput = document.getElementById('ownerSearch');
        const compareBtn = document.getElementById('compareModeBtn');
        if (!ownerContainer) return;

        let currentSort = 'byOrder';

        const render = (owners) => {
            const visibleCountEl = document.getElementById('visible-count');
            if (visibleCountEl) visibleCountEl.textContent = owners.length;
            ownerContainer.innerHTML = '';
            owners.forEach(o => ownerContainer.appendChild(createOwnerCard(o)));
            // Po każdym renderze odbudowujemy cache DOM kart.
            rebuildDomCaches();
        };

        const createOwnerCard = (owner) => {
            const card = document.createElement('div');
            card.className = 'owner-card';
            card.dataset.ownerKey = owner.unikalny_klucz;

            card.innerHTML = `
                <div class="owner-info">
                    <div class="owner-details">
                        <div class="owner-name">${escapeHtml(owner.nazwa_wlasciciela)}</div>
                        <div class="owner-meta">
                            <span><i class="fas fa-hashtag"></i> ${owner.numer_protokolu || 'N/A'}</span>
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
                </div>`;

            setupOwnerCardEvents(card, owner);
            return card;
        };

        const setupOwnerCardEvents = (card, owner) => {
            card.querySelector('.owner-details').onclick = () => handleOwnerClick(owner.unikalny_klucz);

            const btnRzecz = card.querySelector('.action-btn[data-type="rzeczywiste"]');
            const btnProt = card.querySelector('.action-btn[data-type="protokol"]');
            const btnSwitch = card.querySelector('.switch-btn');

            const maRzecz = owner.dzialki_rzeczywiste?.length > 0;
            const maProt = owner.dzialki_protokol?.length > 0;

            if (maRzecz) {
                btnRzecz.onclick = (e) => {
                    e.stopPropagation();
                    const ids = owner.dzialki_rzeczywiste.map(p => p.id);
                    window.MapV2.highlightFeatures(ids, 'fuchsia', {
                        ownerName: owner.nazwa_wlasciciela,
                        ownershipType: 'Rzeczywiste',
                        ownerLp: owner.numer_protokolu,
                        isProtocol: false,
                    });
                };
            } else {
                btnRzecz.style.display = 'none';
            }

            if (maProt) {
                btnProt.onclick = (e) => {
                    e.stopPropagation();
                    const ids = owner.dzialki_protokol.map(p => p.id);
                    window.MapV2.highlightFeatures(ids, 'fuchsia', {
                        ownerName: owner.nazwa_wlasciciela,
                        ownershipType: 'Wg Protokołu',
                        ownerLp: owner.numer_protokolu,
                        isProtocol: true,
                    });
                };
            } else {
                btnProt.style.display = 'none';
            }

            if (maRzecz && maProt) {
                btnSwitch.style.display = 'inline-flex';
                btnSwitch.onclick = (e) => {
                    e.stopPropagation();
                    const isRz = btnRzecz.style.display !== 'none';
                    btnRzecz.style.display = isRz ? 'none' : 'inline-flex';
                    btnProt.style.display = isRz ? 'inline-flex' : 'none';
                };
            } else {
                btnSwitch.style.display = 'none';
            }

            // Hover na karcie właściciela → podświetl jego działki kolorem hover
            card.onmouseover = () => {
                const ids = collectOwnerParcelIds(owner);
                if (ids.length) window.MapV2.setOwnerHoverHighlight(ids, true);
            };
            card.onmouseout = () => window.MapV2.setOwnerHoverHighlight(null, false);
        };

        const collectOwnerParcelIds = (owner) => {
            const ids = new Set();
            (owner.dzialki_rzeczywiste || []).forEach(p => p.id != null && ids.add(p.id));
            (owner.dzialki_protokol || []).forEach(p => p.id != null && ids.add(p.id));
            return [...ids];
        };

        const sortAndFilter = () => {
            let data = [...allOwnersData];
            if (currentSort === 'byName') {
                data.sort((a, b) => a.nazwa_wlasciciela.localeCompare(b.nazwa_wlasciciela, 'pl'));
            } else if (currentSort === 'byParcels') {
                data.sort((a, b) => (b.dzialki_rzeczywiste?.length || 0) - (a.dzialki_rzeczywiste?.length || 0));
            } else {
                data.sort((a, b) => (a.numer_protokolu || 9999) - (b.numer_protokolu || 9999));
            }
            const term = (searchInput?.value || '').toLowerCase();
            const filtered = data.filter(o => {
                const name = o.nazwa_wlasciciela.toLowerCase();
                const lp = o.numer_protokolu ? String(o.numer_protokolu) : '';
                return name.includes(term) || lp.includes(term);
            });
            render(filtered);
        };

        const handleOwnerClick = (ownerKey) => {
            if (!isInCompareMode) {
                window.location.href = `../wlasciciele/protokol.html?ownerId=${ownerKey}`;
            } else {
                handleCompareMode(ownerKey);
            }
        };

        const handleCompareMode = (ownerKey) => {
            const card = ownerContainer.querySelector(`[data-owner-key="${ownerKey}"]`);
            if (!card) return;
            if (selectedForCompare.includes(ownerKey)) {
                selectedForCompare = selectedForCompare.filter(k => k !== ownerKey);
                card.classList.remove('selected-for-compare');
            } else if (selectedForCompare.length < 2) {
                selectedForCompare.push(ownerKey);
                card.classList.add('selected-for-compare');
            }
            if (selectedForCompare.length === 2) {
                window.location.href = `../wlasciciele/compare.html?owners=${selectedForCompare.join(',')}`;
            }
        };

        if (compareBtn) {
            compareBtn.addEventListener('click', () => {
                isInCompareMode = !isInCompareMode;
                compareBtn.classList.toggle('active', isInCompareMode);
                const compareInfo = document.querySelector('.compare-info');
                if (compareInfo) compareInfo.style.display = isInCompareMode ? 'block' : 'none';
                if (!isInCompareMode) {
                    selectedForCompare = [];
                    ownerContainer.querySelectorAll('.selected-for-compare')
                        .forEach(el => el.classList.remove('selected-for-compare'));
                }
            });
        }

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const t = btn.dataset.sort;
                currentSort = t === 'name' ? 'byName' : t === 'parcels' ? 'byParcels' : 'byOrder';
                sortAndFilter();
            });
        });

        if (searchInput) {
            searchInput.addEventListener('input', sortAndFilter);
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

        sortAndFilter();

        const totalEl = document.getElementById('total-owners');
        if (totalEl) totalEl.textContent = allOwnersData.length;
    }

    /* ==========================================================================
       PANEL DZIAŁEK
       ========================================================================== */

    function setupParcelPanel(allParcelsData) {
        const searchInput = document.getElementById('parcelSearch');
        const dzialkiContainer = document.getElementById('dzialki_panel');
        const obiektyContainer = document.getElementById('obiekty_panel');
        const tabs = document.querySelectorAll('.tab-btn');
        const categoryFilters = document.getElementById('parcel-category-filters');

        const render = () => {
            if (!dzialkiContainer || !obiektyContainer) return;
            dzialkiContainer.innerHTML = '';
            obiektyContainer.innerHTML = '';

            const term = (searchInput?.value || '').toLowerCase();
            if (term === '') window.MapV2.clearTemporaryHighlight();

            const sorted = [...allParcelsData].sort((a, b) =>
                (a.properties.numer_obiektu || '').localeCompare(
                    (b.properties.numer_obiektu || ''), 'pl', { numeric: true }));

            const filtered = sorted.filter(p =>
                (p.properties.numer_obiektu || '').toLowerCase().includes(term));

            const activeCats = Array.from(
                document.querySelectorAll('#parcel-category-filters input:checked')
            ).map(cb => cb.dataset.category);

            filtered.forEach(p => {
                const k = p.properties.kategoria;
                const dzialkiCats = ['budowlana', 'rolna', 'las', 'pastwisko'];
                const infraCats = ['droga', 'rzeka'];
                if (!dzialkiCats.includes(k) && !infraCats.includes(k)) return;
                if (dzialkiCats.includes(k) && !activeCats.includes(k)) return;

                const item = createParcelItem(p);
                if (dzialkiCats.includes(k)) dzialkiContainer.appendChild(item);
                else obiektyContainer.appendChild(item);
            });

            if (term.length > 0) {
                const exact = sorted.filter(p =>
                    (p.properties.numer_obiektu || '').toLowerCase() === term);
                if (exact.length) {
                    window.MapV2.highlightFeatures(exact.map(p => p.id), 'orange', { temporary: true });
                }
            }

            const totalEl = document.getElementById('total-parcels');
            if (totalEl) {
                totalEl.textContent = allParcelsData.filter(p =>
                    p.properties.kategoria !== 'obrys_miejscowosci').length;
            }

            rebuildDomCaches();
        };

        const createParcelItem = (parcel) => {
            const item = document.createElement('div');
            item.className = 'parcel-item';
            item.innerHTML = `
                <div class="parcel-info">
                    <span class="parcel-number">${escapeHtml(parcel.properties.numer_obiektu)}</span>
                    <span class="parcel-category filter-badge ${parcel.properties.kategoria}">
                        ${parcel.properties.kategoria}
                    </span>
                </div>
                <button class="parcel-show-btn" title="Pokaż na mapie">
                    <i class="fas fa-crosshairs"></i>
                </button>`;
            item.dataset.featureId = parcel.id;

            item.querySelector('.parcel-show-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                window.MapV2.focusFeature(parcel.id, { openPopup: true });
            });
            return item;
        };

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const activeTab = document.querySelector('.tab-btn.active');
                const tabType = activeTab?.dataset.tab;
                if (tabType === 'special') {
                    renderSpecialObjects(allParcelsData, searchInput.value);
                    const term = searchInput.value.toLowerCase().trim();
                    if (term.length > 0) {
                        const exact = allParcelsData.filter(p => {
                            const k = p.properties.kategoria;
                            const isSpec = ['kapliczka', 'budynek', 'obiekt_specjalny'].includes(k);
                            return isSpec && (p.properties.numer_obiektu || '').toLowerCase() === term;
                        });
                        if (exact.length) {
                            window.MapV2.highlightFeatures(exact.map(p => p.id), 'orange', { temporary: true });
                        }
                    } else {
                        window.MapV2.clearTemporaryHighlight();
                    }
                } else {
                    render();
                }
            });
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabContent = document.getElementById(tab.dataset.tab + '-tab');
                if (tabContent) tabContent.classList.add('active');
                if (categoryFilters) {
                    categoryFilters.style.display = tab.dataset.tab === 'parcels' ? 'flex' : 'none';
                }
                if (searchInput) searchInput.value = '';
                window.MapV2.clearTemporaryHighlight();
                if (tab.dataset.tab === 'special') {
                    renderSpecialObjects(allParcelsData, '');
                } else {
                    render();
                }
            });
        });

        if (categoryFilters) {
            categoryFilters.querySelectorAll('input').forEach(cb =>
                cb.addEventListener('change', render));
        }

        setupParcelInteractions(dzialkiContainer);
        setupParcelInteractions(obiektyContainer);
        renderSpecialObjects(allParcelsData, '');
        render();
    }

    function setupParcelInteractions(container) {
        if (!container) return;
        container.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.parcel-item');
            if (item) window.MapV2.setHoverFeature(parseInt(item.dataset.featureId), true);
        });
        container.addEventListener('mouseout', (e) => {
            const item = e.target.closest('.parcel-item');
            if (item) window.MapV2.setHoverFeature(parseInt(item.dataset.featureId), false);
        });
        container.addEventListener('click', (e) => {
            const item = e.target.closest('.parcel-item');
            if (item) window.MapV2.focusFeature(parseInt(item.dataset.featureId), { openPopup: true });
        });
    }

    /* ==========================================================================
       OBIEKTY SPECJALNE
       ========================================================================== */

    function renderSpecialObjects(allParcelsData, searchTerm) {
        const specialTab = document.getElementById('special-tab');
        const container = specialTab?.querySelector('.special-objects-list');
        if (!container) return;

        container.innerHTML = '';
        const term = (searchTerm || '').toLowerCase().trim();

        const cats = {
            kapliczka: { icon: '⛪', label: 'Kapliczki', items: [] },
            budynek: { icon: '🏠', label: 'Domy', items: [] },
            obiekt_specjalny: { icon: '⭐', label: 'Obiekty specjalne', items: [] },
        };

        allParcelsData.forEach(f => {
            const k = f.properties.kategoria;
            if (!cats[k]) return;
            const numer = (f.properties.numer_obiektu || '').toLowerCase();
            const wlas = (f.properties.wlasciciele || []).map(w => (w.nazwa || '').toLowerCase()).join(' ');
            if (term === '' || numer.includes(term) || wlas.includes(term)) {
                cats[k].items.push(f);
            }
        });

        Object.values(cats).forEach(cat => {
            if (!cat.items.length) return;
            container.appendChild(createSpecialCategorySection(cat));
        });

        const total = Object.values(cats).reduce((s, c) => s + c.items.length, 0);
        if (total === 0 && term !== '') {
            container.innerHTML = `
                <div style="text-align:center;padding:20px;color:var(--text-secondary);">
                    <i class="fas fa-search" style="font-size:2rem;margin-bottom:10px;"></i>
                    <p>Nie znaleziono obiektów dla: "${escapeHtml(searchTerm)}"</p>
                </div>`;
        }
    }

    function createSpecialCategorySection(category) {
        const section = document.createElement('div');
        section.className = 'special-category-section';
        section.innerHTML = `
            <h4 class="special-category-header">
                <span>${category.icon}</span>
                <span>${category.label} (${category.items.length})</span>
            </h4>
            <div class="special-items-list"></div>`;
        const list = section.querySelector('.special-items-list');

        category.items.sort((a, b) => {
            const na = parseInt(a.properties.numer_obiektu) || 0;
            const nb = parseInt(b.properties.numer_obiektu) || 0;
            return na - nb;
        });

        category.items.forEach(item => list.appendChild(createSpecialObjectItem(item, category.icon)));
        return section;
    }

    function createSpecialObjectItem(item, icon) {
        const el = document.createElement('div');
        el.className = 'special-item';
        el.dataset.featureId = item.id;

        const owners = item.properties.wlasciciele || [];
        const ownerNames = owners.map(o => o.nazwa).join(', ') || 'Brak właściciela';

        el.innerHTML = `
            <div class="special-item-content">
                <div class="special-item-header">
                    <span class="special-item-icon">${icon}</span>
                    <span class="special-item-number">${escapeHtml(item.properties.numer_obiektu || 'Bez numeru')}</span>
                </div>
                <div class="special-item-owners">${escapeHtml(ownerNames)}</div>
            </div>
            <button class="special-show-btn" title="Pokaż na mapie">
                <i class="fas fa-crosshairs"></i>
            </button>`;

        el.querySelector('.special-show-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            window.MapV2.focusFeature(item.id, { openPopup: true });
        });

        el.addEventListener('click', () => {
            if (owners.length === 0) {
                alert('Ten obiekt nie ma przypisanego właściciela.');
                return;
            }
            if (owners.length === 1) {
                const key = owners[0].unikalny_klucz;
                if (key) window.location.href = `../wlasciciele/protokol.html?ownerId=${key}`;
                else alert('Brak klucza właściciela dla tego obiektu.');
            } else {
                window.MapV2.showOwnerSelectionPopup(owners, item.id);
            }
        });

        el.addEventListener('mouseenter', () => window.MapV2.setHoverFeature(item.id, true));
        el.addEventListener('mouseleave', () => window.MapV2.setHoverFeature(item.id, false));
        return el;
    }

    /* ==========================================================================
       LEGENDA
       ========================================================================== */

    function setupLegend() {
        const legendEl = document.getElementById('legend');
        if (!legendEl) return;
        const container = legendEl.querySelector('ul');
        const header = legendEl.querySelector('.legend-header');
        const content = legendEl.querySelector('.legend-content');
        const toggle = legendEl.querySelector('.legend-toggle');
        if (!container || !header || !content || !toggle) return;

        header.addEventListener('click', () => {
            legendEl.classList.toggle('collapsed');
            const collapsed = legendEl.classList.contains('collapsed');
            toggle.querySelector('i').className = collapsed ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
        });

        const STYLES = {
            budowlana: { color: '#e67e22' },
            rolna: { color: '#27ae60' },
            las: { fillColor: '#1abc9c' },
            droga: { color: '#8B4513' },
            rzeka: { color: '#3498db' },
            budynek: { color: '#e67e22' },
            kapliczka: { color: '#9b59b6' },
            pastwisko: { fillColor: '#f1c40f' },
            obrys_miejscowosci: { color: '#ff0000' },
            obiekt_specjalny: { color: '#2c3e50' },
        };
        const items = {
            budowlana: 'Działka Budowlana',
            rolna: 'Działka Rolna',
            las: 'Las',
            pastwisko: 'Pastwisko',
            droga: 'Droga',
            rzeka: 'Rzeka',
            budynek: 'Budynek',
            kapliczka: 'Kapliczka',
            obrys_miejscowosci: 'Obrys Miejscowości',
            obiekt_specjalny: 'Obiekt Specjalny',
        };

        container.innerHTML = '';
        container.appendChild(createBaseLayerControls());
        container.appendChild(createMapLayerControls());
        Object.entries(items).forEach(([k, label]) => {
            container.appendChild(createLegendItem(k, label, STYLES[k]));
        });
    }

    function createBaseLayerControls() {
        const wrap = document.createElement('li');
        wrap.className = 'legend-section legend-base-controls';
        wrap.innerHTML = `
            <div class="legend-section-title"><i class="fas fa-map"></i> Podkład</div>
            <label class="legend-radio-row"><input type="radio" name="base-map" value="satellite" checked> Satelita</label>
            <label class="legend-radio-row"><input type="radio" name="base-map" value="osm"> Mapa drogowa</label>
            <label class="legend-radio-row"><input type="radio" name="base-map" value="none"> Tylko działki</label>
            <hr class="legend-separator-inline">`;
        wrap.querySelectorAll('input[name="base-map"]').forEach(r => {
            r.addEventListener('change', () => {
                if (r.checked) window.MapV2.setBaseLayer(r.value);
            });
        });
        return wrap;
    }

    function createMapLayerControls() {
        const wrap = document.createElement('li');
        wrap.className = 'legend-section legend-overlay-controls';
        wrap.innerHTML = `
            <div class="legend-section-title"><i class="fas fa-layer-group"></i> Widoczność</div>
            <label class="legend-checkbox-row"><input type="checkbox" data-group="historical" checked> Mapa historyczna</label>
            <label class="legend-checkbox-row"><input type="checkbox" data-group="parcels" checked> Granice działek i obiekty</label>
            <label class="legend-checkbox-row"><input type="checkbox" data-group="labels" checked> Numery działek/domów</label>
            <label class="legend-checkbox-row"><input type="checkbox" data-group="points" checked> Domy, kapliczki i klastry</label>
            <label class="legend-checkbox-row"><input type="checkbox" data-group="historical-points" checked> Punkty historyczne (opis + zdjęcia)</label>
            <div class="legend-opacity-row">
                <div class="legend-opacity-head"><i class="fas fa-adjust"></i> Przezroczystość mapy XIX w.</div>
                <input type="range" min="0" max="100" value="100" class="opacity-slider legend-opacity-slider" id="opacitySlider">
                <div class="legend-opacity-value"><span id="opacityPercentage">100</span>%</div>
            </div>
            <hr class="legend-separator-inline">`;
        wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                window.MapV2.setMapLayerVisibility(cb.dataset.group, cb.checked);
            });
        });
        const opacity = wrap.querySelector('#opacitySlider');
        const percentage = wrap.querySelector('#opacityPercentage');
        opacity?.addEventListener('input', () => {
            const value = Number(opacity.value);
            if (percentage) percentage.textContent = value;
            window.MapV2.setHistoricalOpacity(value / 100);
        });
        return wrap;
    }

    function createLegendItem(kategoria, label, style) {
        const li = document.createElement('li');
        li.dataset.kategoria = kategoria;
        li.className = 'legend-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.className = 'legend-checkbox';
        cb.id = `legend-${kategoria}`;
        legendVisibilityByCategory[kategoria] = true;

        const colorBox = document.createElement('span');
        colorBox.className = 'legend-color-box';
        colorBox.style.backgroundColor = style?.fillColor || style?.color || '#ccc';

        const lbl = document.createElement('label');
        lbl.htmlFor = `legend-${kategoria}`;
        lbl.className = 'legend-label';
        lbl.textContent = label;

        li.appendChild(cb);
        li.appendChild(colorBox);
        li.appendChild(lbl);

        cb.addEventListener('change', () => {
            legendVisibilityByCategory[kategoria] = cb.checked;
            li.classList.toggle('inactive', !cb.checked);
            window.MapV2.setCategoryVisibility(kategoria, cb.checked);
        });
        return li;
    }

    /* ==========================================================================
       PANELE TOGGLE / TOOLBAR / KEYBOARD
       ========================================================================== */

    function setupPanelToggles() {
        const toggleButtons = document.querySelectorAll('.panel-toggle');
        const expandHandles = document.querySelectorAll('.panel-expand-handle');
        const mapWrapper = document.getElementById('map-wrapper');

        const updateMapState = () => {
            const left = document.getElementById('owners-panel');
            const right = document.getElementById('parcels-panel');
            if (!left || !right || !mapWrapper) return;
            const lc = left.classList.contains('collapsed');
            const rc = right.classList.contains('collapsed');
            mapWrapper.classList.remove('full-width', 'expanded-left', 'expanded-right');
            if (lc && rc) mapWrapper.classList.add('full-width');
            else if (lc) mapWrapper.classList.add('expanded-left');
            else if (rc) mapWrapper.classList.add('expanded-right');
            setTimeout(() => window.MapV2.invalidateSize(), 350);
        };

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            const left = document.getElementById('owners-panel');
            const right = document.getElementById('parcels-panel');
            const lh = document.querySelector('.panel-expand-handle.left-handle');
            const rh = document.querySelector('.panel-expand-handle.right-handle');
            left?.classList.add('collapsed');
            right?.classList.add('collapsed');
            lh?.classList.add('handle-visible');
            rh?.classList.add('handle-visible');
        }

        toggleButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.panel;
                const panel = document.getElementById(t === 'owners' ? 'owners-panel' : 'parcels-panel');
                const handle = document.querySelector(`.panel-expand-handle[data-panel="${t}"]`);
                panel?.classList.add('collapsed');
                handle?.classList.add('handle-visible');
                const icon = btn.querySelector('i');
                if (icon) icon.className = t === 'owners' ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
                updateMapState();
            });
        });

        expandHandles.forEach(handle => {
            handle.addEventListener('click', () => {
                const t = handle.dataset.panel;
                const panel = document.getElementById(t === 'owners' ? 'owners-panel' : 'parcels-panel');
                panel?.classList.remove('collapsed');
                handle.classList.remove('handle-visible');
                const tBtn = panel?.querySelector('.panel-toggle');
                if (tBtn) {
                    const icon = tBtn.querySelector('i');
                    if (icon) icon.className = t === 'owners' ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
                }
                updateMapState();
            });
        });
    }

    function setupToolbarActions() {
        const helpBtn = document.getElementById('help-btn');
        const settingsBtn = document.getElementById('settings-btn');
        const helpModal = document.getElementById('help-modal');
        const settingsModal = document.getElementById('settings-modal');
        const themeToggle = document.getElementById('theme-toggle');
        const resetViewBtn = document.getElementById('reset-view-btn');

        if (helpBtn && helpModal) helpBtn.addEventListener('click', () => helpModal.style.display = 'flex');
        if (settingsBtn && settingsModal) settingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');

        [helpModal, settingsModal].forEach(modal => {
            if (!modal) return;
            modal.querySelector('.modal-close')?.addEventListener('click', () => modal.style.display = 'none');
            modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        });

        if (themeToggle) {
            const apply = (theme) => {
                document.body.classList.toggle('dark-mode', theme === 'dark');
                themeToggle.checked = (theme === 'dark');
            };
            apply(localStorage.getItem('mapTheme') || 'light');
            themeToggle.addEventListener('change', () => {
                const t = themeToggle.checked ? 'dark' : 'light';
                localStorage.setItem('mapTheme', t);
                apply(t);
            });
        }

        if (resetViewBtn) {
            resetViewBtn.addEventListener('click', () => {
                document.getElementById('owners-panel')?.classList.add('collapsed');
                document.getElementById('parcels-panel')?.classList.add('collapsed');
                document.querySelector('.panel-expand-handle.left-handle')?.classList.add('handle-visible');
                document.querySelector('.panel-expand-handle.right-handle')?.classList.add('handle-visible');
                window.MapV2.clearAllHighlights();
                // Po zwinięciu paneli mapa zmienia rozmiar — czekamy na transition (350ms)
                // i dopiero potem fitToAll, żeby animacja zoomu była po właściwym viewporcie.
                setTimeout(() => {
                    window.MapV2.invalidateSize();
                    window.MapV2.fitToAll();
                }, 380);
                if (settingsModal) settingsModal.style.display = 'none';
            });
        }

        document.addEventListener('keydown', e => {
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
                if (e.key !== 'Escape') return;
            }
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                document.getElementById('universal-search')?.focus();
            }
            if (e.key === '+') { e.preventDefault(); window.MapV2.zoomIn(); }
            if (e.key === '-') { e.preventDefault(); window.MapV2.zoomOut(); }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (helpModal && helpModal.style.display === 'flex') helpModal.style.display = 'none';
                else if (settingsModal && settingsModal.style.display === 'flex') settingsModal.style.display = 'none';
                else {
                    const cb = document.getElementById('clearHighlightBtn');
                    if (cb && !cb.parentElement.classList.contains('hidden')) cb.click();
                }
            }
        });
    }

    function setupClearHighlightButton() {
        const btn = document.getElementById('clearHighlightBtn');
        if (btn) btn.addEventListener('click', () => window.MapV2.clearAllHighlights());
    }

    /* ==========================================================================
       UNIVERSAL SEARCH
       ========================================================================== */

    function performSearch(term, allOwnersData, allParcelsData) {
        const ownerR = allOwnersData
            .filter(o => o.nazwa_wlasciciela.toLowerCase().includes(term) ||
                String(o.numer_protokolu).includes(term))
            .map(o => ({ id: o.unikalny_klucz, name: o.nazwa_wlasciciela, lp: o.numer_protokolu, type: 'owner' }));
        const parcelR = allParcelsData
            .filter(p => (p.properties.numer_obiektu || '').toLowerCase().includes(term))
            .map(p => ({ id: p.id, number: p.properties.numer_obiektu, category: p.properties.kategoria, type: 'parcel' }));
        return [...ownerR, ...parcelR].slice(0, 10);
    }

    function createSearchResultItem(item) {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.id = item.id;
        el.dataset.type = item.type;
        let iconHtml = '', text, meta;
        if (item.type === 'owner') {
            text = item.name;
            meta = `Właściciel (Lp. ${item.lp})`;
        } else {
            iconHtml = '<i class="result-icon fas fa-map-marker-alt"></i>';
            text = `Działka nr ${item.number}`;
            meta = item.category;
        }
        el.innerHTML = `${iconHtml}<span class="result-text">${escapeHtml(text)}</span><span class="result-meta">${escapeHtml(meta || '')}</span>`;
        return el;
    }

    function setupUniversalSearch(allOwnersData, allParcelsData) {
        const input = document.getElementById('universal-search');
        const results = document.getElementById('universal-search-results');
        if (!input || !results) return;

        const debounced = debounce(() => {
            const term = input.value.toLowerCase().trim();
            if (term.length < 2) { results.style.display = 'none'; return; }
            const data = performSearch(term, allOwnersData, allParcelsData);
            results.innerHTML = '';
            if (!data.length) { results.style.display = 'none'; return; }
            data.forEach(item => results.appendChild(createSearchResultItem(item)));
            results.style.display = 'block';
        }, 300);
        input.addEventListener('input', debounced);

        results.addEventListener('click', e => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;
            const { id, type } = item.dataset;
            if (type === 'owner') {
                handleOwnerSearchResult(id);
            } else {
                window.MapV2.focusFeature(parseInt(id), { openPopup: true });
            }
            input.value = '';
            results.style.display = 'none';
        });
        document.addEventListener('click', e => {
            if (!results.contains(e.target) && e.target !== input) results.style.display = 'none';
        });
    }

    function setupMobileSearch(allOwnersData, allParcelsData) {
        const trigger = document.getElementById('mobile-search-trigger');
        const overlay = document.getElementById('mobile-search-overlay');
        const closeBtn = document.getElementById('close-mobile-search');
        const input = document.getElementById('mobile-universal-search');
        const results = document.getElementById('mobile-search-results');
        if (!trigger || !overlay || !closeBtn || !input || !results) return;

        const placeholder = `<div class="search-placeholder"><i class="fas fa-search"></i><p>Wpisz co najmniej 2 znaki, aby wyszukać</p></div>`;
        const open = () => { overlay.classList.add('active'); setTimeout(() => input.focus(), 100); };
        const close = () => { overlay.classList.remove('active'); input.value = ''; results.innerHTML = placeholder; };

        trigger.addEventListener('click', e => { e.preventDefault(); open(); });
        closeBtn.addEventListener('click', close);

        input.addEventListener('input', debounce(() => {
            const term = input.value.toLowerCase().trim();
            if (term.length < 2) { results.innerHTML = placeholder; return; }
            const data = performSearch(term, allOwnersData, allParcelsData);
            results.innerHTML = '';
            if (!data.length) {
                results.innerHTML = `<div class="search-placeholder"><i class="fas fa-frown"></i><p>Nie znaleziono wyników dla "${escapeHtml(term)}"</p></div>`;
                return;
            }
            data.forEach(item => results.appendChild(createSearchResultItem(item)));
        }, 300));

        results.addEventListener('click', e => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;
            const { id, type } = item.dataset;
            if (type === 'owner') {
                handleOwnerSearchResult(id);
                const panel = document.getElementById('owners-panel');
                if (panel?.classList.contains('collapsed')) {
                    document.querySelector('.panel-expand-handle.left-handle')?.click();
                }
            } else {
                window.MapV2.focusFeature(parseInt(id), { openPopup: true });
            }
            close();
        });
    }

    function handleOwnerSearchResult(ownerKey) {
        const card = document.querySelector(`.owner-card[data-owner-key="${ownerKey}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.transition = 'all 0.2s ease';
            card.style.transform = 'scale(1.05)';
            setTimeout(() => card.style.transform = 'scale(1)', 1000);
        }
    }

    /* ==========================================================================
       DOM CACHE + HOVER SYNC (mapa → panele)
       ========================================================================== */

    function rebuildDomCaches() {
        parcelButtonsByFeatureId.clear();
        ownerCardsByKey.clear();
        document.querySelectorAll('.parcel-item[data-feature-id]').forEach(el => {
            const id = el.dataset.featureId;
            if (id) parcelButtonsByFeatureId.set(id, el);
        });
        document.querySelectorAll('.special-item[data-feature-id]').forEach(el => {
            const id = el.dataset.featureId;
            if (id) parcelButtonsByFeatureId.set(id, el);
        });
        document.querySelectorAll('.owner-card[data-owner-key]').forEach(el => {
            const k = el.dataset.ownerKey;
            if (k) ownerCardsByKey.set(k, el);
        });
    }

    /**
     * Wywoływane przez mapę gdy hover nad działką → podświetla kartę właściciela i pozycję działki w panelu.
     */
    function highlightOwnerByFeatureHover(featureId, wlasciciele) {
        const btn = parcelButtonsByFeatureId.get(String(featureId));
        if (btn) {
            btn.classList.add('highlighted-by-map');
            checkElementVisibility(btn);
        }
        if (Array.isArray(wlasciciele)) {
            for (const w of wlasciciele) {
                const card = ownerCardsByKey.get(w.unikalny_klucz);
                if (card) card.classList.add('highlighted-by-map');
            }
        }
    }

    function clearHoverHighlights() {
        parcelButtonsByFeatureId.forEach(btn => {
            if (btn.classList.contains('highlighted-by-map')) {
                btn.classList.remove('highlighted-by-map');
                btn.closest('.tab-content-right')?.classList.remove('highlight-indicator-top', 'highlight-indicator-bottom');
            }
        });
        ownerCardsByKey.forEach(card => card.classList.remove('highlighted-by-map'));
    }

    function scrollToParcelButton(featureId) {
        const btn = parcelButtonsByFeatureId.get(String(featureId));
        if (btn) checkElementVisibility(btn);
    }

    function checkElementVisibility(element) {
        const container = element.closest('.tab-content-right');
        if (!container) return;
        container.classList.remove('highlight-indicator-top', 'highlight-indicator-bottom');
        const cr = container.getBoundingClientRect();
        const er = element.getBoundingClientRect();
        const fully = er.top >= cr.top && er.bottom <= cr.bottom;
        if (!fully) {
            if (er.top < cr.top) container.classList.add('highlight-indicator-top');
            else if (er.bottom > cr.bottom) container.classList.add('highlight-indicator-bottom');
        }
    }

    /* ==========================================================================
       UTIL
       ========================================================================== */

    function debounce(fn, wait) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }
})();
