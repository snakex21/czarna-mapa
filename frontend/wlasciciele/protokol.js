/* ==========================================================================
   Plik: protokol.js
   Opis: Główny skrypt obsługujący wyświetlanie protokołów katastralnych.
         Zarządza pobieraniem danych, renderowaniem interfejsu, modalami
         oraz generowaniem PDF i wizualizacją drzewa genealogicznego.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    /* ==========================================================================
       DEKLARACJA ZMIENNYCH I STAŁYCH
       ========================================================================== */

    // Parametry URL
    const urlParams = new URLSearchParams(window.location.search);
    const ownerKey = urlParams.get('ownerId');

    // Elementy DOM - podstawowe
    const orderNumberEl = document.getElementById('orderNumber');
    const protocolDateEl = document.getElementById('protocolDate');
    const protocolLocationEl = document.getElementById('protocolLocation');
    const ownerNameEl = document.getElementById('ownerName');
    const genealogyEl = document.getElementById('genealogy');
    const ownershipHistoryEl = document.getElementById('ownershipHistory');

    // Elementy DOM - przyciski akcji
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const showOriginalBtn = document.getElementById('showOriginalBtn');
    const backToMapBtn = document.getElementById('backToMapBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const showHouseOnMapBtn = document.getElementById('showHouseOnMapBtn');
    const showTreeBtn = document.getElementById('showTreeBtn');

    // Elementy DOM - modal skanów
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImageSrc');
    const closeModalBtn = document.querySelector('.modal-close-btn');
    const prevBtn = document.getElementById('prevImageBtn');
    const nextBtn = document.getElementById('nextImageBtn');
    const pageCounter = document.getElementById('pageCounter');

    // Elementy DOM - dialog drzewa genealogicznego
    const treeDialog = document.getElementById('treeDialog');
    const closeTreeBtn = document.getElementById('closeTreeBtn');
    const treeContainer = document.getElementById('treeContainer');

    // Stan aplikacji
    let panzoomInstance = null;
    let imageUrls = [];
    let currentImageIndex = 0;
    let ownerData = null;
    let havePlotDifferences = false;

    /* ==========================================================================
       INICJALIZACJA APLIKACJI
       ========================================================================== */

    /**
     * Główna funkcja inicjalizująca - waliduje parametry i uruchamia komponenty
     */
    const init = () => {
        // Walidacja parametrów URL
        if (!ownerKey) {
            showError('Błąd: Brak klucza właściciela w adresie URL.');
            return;
        }

        // Ustawienie aktualnej daty
        const currentDateEl = document.getElementById('currentDate');
        if (currentDateEl) {
            currentDateEl.textContent = new Date().toLocaleDateString('pl-PL');
        }

        // Inicjalizacja komponentów
        fetchOwnerData();
        findProtocolImages();
        setupEventListeners();
        setupThemeLogic();
    };

    /* ==========================================================================
       KOMUNIKACJA Z API
       ========================================================================== */

    /**
     * Pobiera dane właściciela z serwera
     */
    const fetchOwnerData = async () => {
        try {
            const response = await fetch(`/api/wlasciciel/${ownerKey}`);
            const data = await response.json();

            if (data.error) {
                showError(data.error);
                return;
            }

            ownerData = data;
            renderOwnerData(data);
        } catch (error) {
            console.error('Błąd pobierania danych:', error);
            showError('Nie udało się pobrać danych protokołu.');
        }
    };

    /**
     * Wyszukuje skany protokołu w katalogu serwera
     */
    const findProtocolImages = async () => {
        const basePath = `/protokoly/${ownerKey.replace(/ /g, '_')}/`;
        const found = [];
        let i = 1;

        const checkNext = () => {
            const img = new Image();
            img.src = `${basePath}${i}.jpg`;

            img.onload = () => {
                found.push(img.src);
                i++;
                checkNext();
            };

            img.onerror = () => {
                if (i === 1 && found.length === 0) {
                    // Sprawdzenie pojedynczego pliku
                    const singleImg = new Image();
                    singleImg.src = `/protokoly/${ownerKey}.jpg`;

                    singleImg.onload = () => {
                        found.push(singleImg.src);
                        finishImageSearch(found);
                    };

                    singleImg.onerror = () => finishImageSearch(found);
                } else {
                    finishImageSearch(found);
                }
            };
        };

        checkNext();
    };

    /**
     * Finalizuje wyszukiwanie skanów i aktywuje przycisk
     */
    const finishImageSearch = (foundImages) => {
        imageUrls = foundImages;
        if (imageUrls.length > 0) {
            showOriginalBtn.classList.remove('hidden');
        }
    };

    /* ==========================================================================
       RENDEROWANIE DANYCH
       ========================================================================== */

    /**
     * Renderuje kompletne dane właściciela w interfejsie
     */
    const renderOwnerData = (data) => {
        // Aktualizacja tytułu strony
        document.title = `Protokół - ${data.nazwa_wlasciciela || 'Nieznany'}`;

        // Metadane protokołu
        fillField(orderNumberEl, data.numer_protokolu);
        fillField(protocolDateEl, formatDate(data.data_protokolu));
        fillField(protocolLocationEl, data.miejsce_protokolu);

        // Dynamiczne ustawienie gminy katastralnej w tytule
        const protocolLocationTitle = document.getElementById('protocol-location-title');
        if (protocolLocationTitle && data.gmina_katastralna) {
            protocolLocationTitle.textContent = `w gminie katastralnej ${data.gmina_katastralna}`;
        }

        // Informacje o właścicielu
        const ownerHtml = `
            <div>
                <div class="owner-name-main">${data.nazwa_wlasciciela || ''}</div>
                ${data.numer_domu ? `
                    <div class="owner-secondary-info">
                        Dom: <span class="owner-details-value">${generateFractionHTML(data.numer_domu)}</span>
                    </div>
                ` : ''}
            </div>
        `;
        ownerNameEl.innerHTML = ownerHtml;

        // Przycisk domu na mapie
        if (data.dom_obiekt_id) {
            showHouseOnMapBtn.classList.remove('hidden');
        }

        // Sekcja genealogii
        if (data.genealogia) {
            fillField(genealogyEl, data.genealogia);
            document.getElementById('genealogySection').classList.remove('hidden');

            if (data.ma_drzewo_genealogiczne) {
                showTreeBtn.classList.remove('hidden');
            }
        }

        // Treść protokołu
        fillField(ownershipHistoryEl, generateFractionHTML(data.pelna_historia));

        // Sekcje opcjonalne
        showOptionalSection('wspolwlasnoscSection', 'wspolwlasnosc', data.wspolwlasnosc);
        showOptionalSection('powiazaniaTransakcjeSection', 'powiazaniaTransakcje', data.powiazania_i_transakcje_html);
        showOptionalSection('interpretacjaWnioskiSection', 'interpretacjaWnioski', data.interpretacja_i_wnioski);

        // Renderowanie działek
        renderPlots(data);
    };

    /**
     * Renderuje sekcje działek z porównaniem stanów
     */
    const renderPlots = (data) => {
        const protokolPlots = data.dzialki_protokol || [];
        const rzeczywistePlots = data.dzialki_rzeczywiste || [];

        // Funkcja porównująca listy działek
        const arePlotListsEqual = (listA, listB) => {
            if (listA.length !== listB.length) return false;
            const idsA = new Set(listA.map(p => p.id));
            const idsB = new Set(listB.map(p => p.id));
            return idsA.size === idsB.size && [...idsA].every(id => idsB.has(id));
        };

        const haveDifferences = !arePlotListsEqual(protokolPlots, rzeczywistePlots);
        havePlotDifferences = haveDifferences;

        if (haveDifferences) {
            // Wyświetlenie przełącznika i obu widoków
            document.querySelector('.view-switcher').classList.remove('hidden');
            updatePlotSection('rzeczywistePlots', rzeczywistePlots);
            updatePlotSection('protokolPlots', protokolPlots);
        } else {
            // Wyświetlenie pojedynczego widoku
            document.querySelector('.view-switcher').classList.add('hidden');
            const viewRzeczywiste = document.getElementById('view-rzeczywiste');
            viewRzeczywiste.querySelector('.card-header h3').innerHTML =
                '<i class="fas fa-layer-group"></i> Działki';
            updatePlotSection('rzeczywistePlots', rzeczywistePlots);
            document.getElementById('view-protokol').classList.add('hidden');
        }

        // Konfiguracja linków do mapy
        setupMapLinks(rzeczywistePlots, protokolPlots, haveDifferences);
    };

    /**
     * Formatuje powierzchnię w odpowiednich jednostkach
     */
    const formatArea = (areaM2) => {
        if (!areaM2 || areaM2 === 0) return '—';

        if (areaM2 >= 10000) {
            // Hektary (ha) dla dużych powierzchni
            return `${(areaM2 / 10000).toFixed(2)} ha`;
        } else if (areaM2 >= 100) {
            // Ary (a) dla średnich powierzchni
            return `${(areaM2 / 100).toFixed(2)} a`;
        } else {
            // Metry kwadratowe dla małych powierzchni
            return `${areaM2.toFixed(2)} m²`;
        }
    };

    /**
     * Formatuje długość w odpowiednich jednostkach (dla dróg i rzek)
     */
    const formatLength = (lengthM) => {
        if (!lengthM || lengthM === 0) return '—';

        if (lengthM >= 1000) {
            // Kilometry dla długich odcinków
            return `${(lengthM / 1000).toFixed(2)} km`;
        } else {
            // Metry dla krótkich odcinków
            return `${lengthM.toFixed(2)} m`;
        }
    };

    /**
     * Zwraca ikonę i kolor dla kategorii działki
     */
    const getCategoryStyle = (category) => {
        const styles = {
            'rolna': { icon: 'fa-seedling', color: '#48bb78', bgColor: '#f0fff4' },
            'las': { icon: 'fa-tree', color: '#38a169', bgColor: '#e6fffa' },
            'pastwisko': { icon: 'fa-horse', color: '#ed8936', bgColor: '#fffaf0' },
            'łąka': { icon: 'fa-spa', color: '#68d391', bgColor: '#f0fff4' },
            'budowlana': { icon: 'fa-building', color: '#4299e1', bgColor: '#ebf8ff' },
            'ogród': { icon: 'fa-leaf', color: '#9f7aea', bgColor: '#faf5ff' },
            'sad': { icon: 'fa-apple-alt', color: '#f56565', bgColor: '#fff5f5' },
            'droga': { icon: 'fa-road', color: '#805ad5', bgColor: '#faf5ff' },
            'rzeka': { icon: 'fa-water', color: '#3182ce', bgColor: '#ebf8ff' },
            'nieznana': { icon: 'fa-question-circle', color: '#a0aec0', bgColor: '#f7fafc' }
        };
        return styles[category] || styles['nieznana'];
    };

    /**
     * Aktualizuje pojedynczą sekcję działek
     */
    const updatePlotSection = (containerId, plots) => {
        const container = document.getElementById(containerId);
        if (!container || !plots || plots.length === 0) return;

        const numbersDiv = container.querySelector('.plot-numbers');
        const summaryDiv = container.querySelector('.plot-summary');
        const detailsDiv = document.getElementById(
            containerId === 'rzeczywistePlots' ? 'rzeczywiste-details' : 'protokol-details'
        );

        // Filtrowanie działek - ukrywamy budynki w widoku protokołu właściciela
        const filteredPlots = plots.filter(p => p.kategoria !== 'budynek' && p.kategoria !== 'dom');

        // Lista numerów działek - PROSTY FORMAT
        numbersDiv.innerHTML = filteredPlots.map(p => generateFractionHTML(p.nazwa_lub_numer)).join(', ');

        // Obliczanie łącznej powierzchni (bez dróg i rzek)
        const plotsWithArea = filteredPlots.filter(p => !['droga', 'rzeka'].includes(p.kategoria));
        const roadsAndRivers = filteredPlots.filter(p => ['droga', 'rzeka'].includes(p.kategoria));
        const totalArea = plotsWithArea.reduce((sum, p) => sum + (p.powierzchnia_m2 || 0), 0);

        // Podsumowanie kategorii z powierzchnią/długością
        const categoryStats = filteredPlots.reduce((acc, p) => {
            const k = p.kategoria || 'nieznana';
            const isRoadOrRiver = ['droga', 'rzeka'].includes(k);

            if (!acc[k]) {
                acc[k] = { count: 0, area: 0, length: 0, plots: [] };
            }
            acc[k].count += 1;

            if (isRoadOrRiver) {
                acc[k].length += (p.dlugosc_m || 0);
            } else {
                acc[k].area += (p.powierzchnia_m2 || 0);
            }

            acc[k].plots.push(p);
            return acc;
        }, {});

        // PROSTY TEKST przed rozwinięciem z łączną powierzchnią i procentami
        const summaryParts = Object.entries(categoryStats)
            .map(([category, stats]) => {
                const isRoadOrRiver = ['droga', 'rzeka'].includes(category);
                const measurement = isRoadOrRiver ? formatLength(stats.length) : formatArea(stats.area);
                const percentage = !isRoadOrRiver && totalArea > 0
                    ? `, ${((stats.area / totalArea) * 100).toFixed(1)}%`
                    : '';
                return `${stats.count} ${category} (${measurement}${percentage})`;
            })
            .join(', ');

        const areaCount = plotsWithArea.length;
        const roadCount = roadsAndRivers.length;
        const countText = roadCount > 0
            ? `${areaCount} ${areaCount === 1 ? 'działka' : areaCount < 5 ? 'działki' : 'działek'} + ${roadCount} ${roadCount === 1 ? 'droga' : 'drogi'}`
            : `${areaCount} ${areaCount === 1 ? 'działka' : areaCount < 5 ? 'działki' : 'działek'}`;

        summaryDiv.innerHTML = `
            <div style="margin-bottom: 0.5rem; font-weight: 600; color: var(--primary-color);">
                Łączna powierzchnia: ${formatArea(totalArea)} (${countText})
            </div>
            <div style="color: var(--text-secondary);">
                (w tym: ${summaryParts})
            </div>
        `;

        // ŁADNE KARTY w szczegółach (po rozwinięciu) z progress barami
        const categoriesHTML = Object.entries(categoryStats)
            .sort((a, b) => b[1].area - a[1].area)
            .map(([category, stats]) => {
                const style = getCategoryStyle(category);
                const isRoadOrRiver = ['droga', 'rzeka'].includes(category);
                const percentage = !isRoadOrRiver && totalArea > 0 ? ((stats.area / totalArea) * 100).toFixed(1) : 0;

                // Dla dróg/rzek liczymy łączną długość, dla reszty powierzchnię
                const categoryTotal = isRoadOrRiver ? stats.length : stats.area;
                const formattedTotal = isRoadOrRiver ? formatLength(categoryTotal) : formatArea(categoryTotal);

                return `
                    <div class="area-category-item" style="margin-bottom: 0.75rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <i class="fas ${style.icon}" style="color: ${style.color}; font-size: 1rem;"></i>
                                <span style="font-weight: 600; text-transform: capitalize;">${category}</span>
                                <span style="color: var(--text-secondary); font-size: 0.9em;">(${stats.count})</span>
                            </div>
                            <span style="font-weight: 700; color: ${style.color};">${formattedTotal}</span>
                        </div>
                        ${!isRoadOrRiver ? `
                            <div style="background: #e2e8f0; border-radius: 8px; height: 8px; overflow: hidden; margin-bottom: 0.3rem;">
                                <div style="background: ${style.color}; width: ${percentage}%; height: 100%; border-radius: 8px; transition: width 0.5s ease;"></div>
                            </div>
                            <div style="text-align: right; font-size: 0.8em; color: var(--text-secondary);">
                                ${percentage}%
                            </div>
                        ` : '<div style="text-align: right; font-size: 0.8em; color: var(--text-secondary); font-style: italic;">długość</div>'}
                    </div>
                    <div class="plot-category-block" style="background: ${style.bgColor}; border-left: 3px solid ${style.color}; padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem;">
                        <div class="plot-numbers" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            ${stats.plots.map(p => {
                    const isRR = ['droga', 'rzeka'].includes(p.kategoria);
                    const measurement = isRR ? formatLength(p.dlugosc_m) : formatArea(p.powierzchnia_m2);

                    return `
                                    <div class="plot-item-card" style="background: white; border: 1px solid ${style.color}40; border-radius: 5px; padding: 0.35rem 0.6rem; display: inline-flex; align-items: center; gap: 0.4rem; transition: all 0.2s ease; cursor: default;">
                                        <span style="font-weight: 600; color: ${style.color}; font-size: 0.9rem;">${generateFractionHTML(p.nazwa_lub_numer)}</span>
                                        <span style="color: var(--text-secondary); font-size: 0.8em; border-left: 1px solid #e2e8f0; padding-left: 0.4rem;">
                                            ${measurement}
                                        </span>
                                    </div>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            }).join('');

        detailsDiv.innerHTML = `
            <div class="area-summary-card" style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); border: 2px solid #667eea30; border-radius: 10px; padding: 1rem; margin-bottom: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); width: 45px; height: 45px; border-radius: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
                        <i class="fas fa-chart-area" style="color: white; font-size: 1.4rem;"></i>
                    </div>
                    <div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Łączna powierzchnia</div>
                        <div style="font-size: 1.5rem; font-weight: 700; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1.2;">
                            ${formatArea(totalArea)}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">
                            ${countText}
                        </div>
                    </div>
                </div>
                <div class="category-breakdown">
                    ${categoriesHTML}
                </div>
            </div>
        `;
    };

    /**
     * Konfiguruje przyciski nawigacji do mapy
     */
    const setupMapLinks = (rzeczywistePlots, protokolPlots, haveDifferences) => {
        const mapLinkReal = document.getElementById('mapLinkReal');
        const mapLinkProtocol = document.getElementById('mapLinkProtocol');
        const mapLinkBoth = document.getElementById('mapLinkBoth');
        const mapUrl = '../mapa/mapa.html';

        if (!haveDifferences && rzeczywistePlots.length > 0) {
            // Pojedynczy przycisk dla identycznych stanów
            const plotIds = rzeczywistePlots.map(p => p.id).join(',');
            mapLinkReal.href = `${mapUrl}?highlightByIds=${plotIds}`;
            mapLinkReal.innerHTML = '<i class="fas fa-map-marked-alt"></i> Pokaż na mapie';
            mapLinkReal.classList.remove('hidden');
        } else {
            // Osobne przyciski dla różnych stanów
            if (rzeczywistePlots.length > 0) {
                const plotIds = rzeczywistePlots.map(p => p.id).join(',');
                mapLinkReal.href = `${mapUrl}?highlightByIds=${plotIds}`;
                mapLinkReal.classList.remove('hidden');
            }

            if (protokolPlots.length > 0) {
                const plotIds = protokolPlots.map(p => p.id).join(',');
                mapLinkProtocol.href = `${mapUrl}?highlightByIds=${plotIds}`;
                mapLinkProtocol.classList.remove('hidden');
            }

            if (rzeczywistePlots.length > 0 && protokolPlots.length > 0) {
                const allIds = [...new Set([
                    ...rzeczywistePlots.map(p => p.id),
                    ...protokolPlots.map(p => p.id)
                ])].join(',');
                mapLinkBoth.href = `${mapUrl}?highlightByIds=${allIds}`;
                mapLinkBoth.classList.remove('hidden');
            }
        }
    };

    /* ==========================================================================
       OBSŁUGA ZDARZEŃ
       ========================================================================== */

    /**
     * Konfiguruje wszystkie handlery zdarzeń
     */
    const setupEventListeners = () => {
        // Inicjalizacja trybu pełnoekranowego
        setupFullscreen();

        // Przyciski główne
        downloadPdfBtn.addEventListener('click', generatePDF);
        showOriginalBtn.addEventListener('click', openImageModal);
        backToMapBtn.addEventListener('click', () => {
            window.location.href = '../mapa/mapa.html';
        });

        // Przycisk domu na mapie
        showHouseOnMapBtn.addEventListener('click', () => {
            if (!ownerData || !ownerData.dom_obiekt_id) return;

            const mapUrl = '../mapa/mapa.html';
            // Pokazujemy TYLKO dom, bez działek, i zoomujemy na nim
            window.location.href = `${mapUrl}?highlightByIds=${ownerData.dom_obiekt_id}&zoomToFit=true`;
        });

        // Przełącznik widoków działek
        const btnRzeczywiste = document.getElementById('btn-view-rzeczywiste');
        const btnProtokol = document.getElementById('btn-view-protokol');

        btnRzeczywiste.addEventListener('click', () => {
            document.getElementById('view-rzeczywiste').classList.remove('hidden');
            document.getElementById('view-protokol').classList.add('hidden');
            btnRzeczywiste.classList.add('active');
            btnProtokol.classList.remove('active');
        });

        btnProtokol.addEventListener('click', () => {
            document.getElementById('view-protokol').classList.remove('hidden');
            document.getElementById('view-rzeczywiste').classList.add('hidden');
            btnProtokol.classList.add('active');
            btnRzeczywiste.classList.remove('active');
        });

        // Przyciski rozwijania szczegółów
        document.querySelectorAll('.details-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                const targetEl = document.getElementById(targetId);
                const icon = btn.querySelector('i');

                if (targetEl.classList.contains('hidden')) {
                    targetEl.classList.remove('hidden');
                    icon.className = 'fas fa-chevron-up';
                } else {
                    targetEl.classList.add('hidden');
                    icon.className = 'fas fa-chevron-down';
                }
            });
        });

        // Modal skanów
        closeModalBtn.addEventListener('click', closeImageModal);
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) closeImageModal();
        });
        prevBtn.addEventListener('click', showPrevImage);
        nextBtn.addEventListener('click', showNextImage);

        // Dialog drzewa genealogicznego
        showTreeBtn.addEventListener('click', loadGenealogyTree);
        closeTreeBtn.addEventListener('click', () => {
            treeDialog.close();
            treeContainer.innerHTML = '';
        });

        // Skróty klawiszowe
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!imageModal.classList.contains('hidden')) {
                    closeImageModal();
                } else if (treeDialog.open) {
                    treeDialog.close();
                }
            }
        });
    };

    /* ==========================================================================
       MODAL SKANÓW PROTOKOŁU
       ========================================================================== */

    /**
     * Otwiera modal z przeglądaniem skanów
     */
    const openImageModal = () => {
        if (imageUrls.length === 0) return;

        currentImageIndex = 0;
        updateModalContent();
        imageModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Inicjalizacja Panzoom dla zoom/pan obrazu
        panzoomInstance = Panzoom(modalImage, {
            maxScale: 5,
            minScale: 0.5
        });

        modalImage.parentElement.addEventListener('wheel', panzoomInstance.zoomWithWheel);
    };

    /**
     * Zamyka modal skanów
     */
    const closeImageModal = () => {
        imageModal.classList.add('hidden');
        document.body.style.overflow = 'auto';

        if (panzoomInstance) {
            panzoomInstance.destroy();
            panzoomInstance = null;
        }
    };

    /**
     * Aktualizuje zawartość modala
     */
    const updateModalContent = () => {
        modalImage.src = imageUrls[currentImageIndex];
        pageCounter.textContent = `Strona ${currentImageIndex + 1} / ${imageUrls.length}`;

        prevBtn.disabled = currentImageIndex === 0;
        nextBtn.disabled = currentImageIndex === imageUrls.length - 1;

        const navControls = document.querySelector('.modal-nav-controls');
        navControls.style.display = imageUrls.length > 1 ? 'flex' : 'none';
    };

    /**
     * Nawigacja - następny skan
     */
    const showNextImage = () => {
        if (currentImageIndex < imageUrls.length - 1) {
            currentImageIndex++;
            updateModalContent();
            if (panzoomInstance) panzoomInstance.reset();
        }
    };

    /**
     * Nawigacja - poprzedni skan
     */
    const showPrevImage = () => {
        if (currentImageIndex > 0) {
            currentImageIndex--;
            updateModalContent();
            if (panzoomInstance) panzoomInstance.reset();
        }
    };

    /* ==========================================================================
       DRZEWO GENEALOGICZNE
       ========================================================================== */

    /**
     * Ładuje dane i wyświetla drzewo genealogiczne
     */
    const loadGenealogyTree = async () => {
        showTreeBtn.disabled = true;
        showTreeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ładowanie...';

        try {
            const response = await fetch(`/api/genealogia/${ownerKey}`);
            const treeData = await response.json();

            drawGenealogyTree(treeData);
        } catch (error) {
            console.error('Błąd ładowania drzewa:', error);
            alert('Nie udało się załadować drzewa genealogicznego');
        } finally {
            showTreeBtn.disabled = false;
            showTreeBtn.innerHTML = '<i class="fas fa-project-diagram"></i> Pokaż drzewo genealogiczne';
        }
    };

    /**
     * Renderuje rodzinę w formie kart (jak w genealogia.html)
     */
    const drawGenealogyTree = (treeData) => {
        if (!treeData.persons || treeData.persons.length === 0) {
            alert('Brak danych genealogicznych do wyświetlenia');
            return;
        }

        // Przygotowanie mapy osób i dzieci
        const personMap = new Map();
        const childrenMap = new Map();

        treeData.persons.forEach(p => {
            personMap.set(p.id, p);

            // Buduj mapę dzieci
            if (p.fatherId) {
                if (!childrenMap.has(p.fatherId)) childrenMap.set(p.fatherId, []);
                childrenMap.get(p.fatherId).push(p.id);
            }
            if (p.motherId) {
                if (!childrenMap.has(p.motherId)) childrenMap.set(p.motherId, []);
                childrenMap.get(p.motherId).push(p.id);
            }
        });

        // Znajdź osobę główną (root)
        const rootPerson = personMap.get(treeData.rootId);
        if (!rootPerson) {
            alert('Nie znaleziono osoby głównej');
            return;
        }

        // Pomocnicze funkcje
        const getParentRole = (p) => p?.gender === 'M' ? 'Ojciec' : (p?.gender === 'F' ? 'Matka' : 'Rodzic');
        const getGrandparentRole = (p) => p?.gender === 'M' ? 'Dziadek' : (p?.gender === 'F' ? 'Babcia' : 'Dziadek/Babcia');
        const formatYears = (p) => {
            if (!p) return '';
            const birth = p.birthDate?.year || '?';
            const death = p.deathDate?.year || '?';
            return `${birth} - ${death}`;
        };

        // Zbierz rodzinę
        const father = personMap.get(rootPerson.fatherId);
        const mother = personMap.get(rootPerson.motherId);

        const parents = [];
        if (father) parents.push({ role: getParentRole(father), ...father });
        if (mother) parents.push({ role: getParentRole(mother), ...mother });

        // Dziadkowie
        const grandparentsFather = [];
        const grandparentsMother = [];

        if (father) {
            const gf = personMap.get(father.fatherId);
            const gm = personMap.get(father.motherId);
            if (gf) grandparentsFather.push({ role: getGrandparentRole(gf), ...gf });
            if (gm) grandparentsFather.push({ role: getGrandparentRole(gm), ...gm });
        }
        if (mother) {
            const gf = personMap.get(mother.fatherId);
            const gm = personMap.get(mother.motherId);
            if (gf) grandparentsMother.push({ role: getGrandparentRole(gf), ...gf });
            if (gm) grandparentsMother.push({ role: getGrandparentRole(gm), ...gm });
        }

        // Małżonkowie
        const spouses = (rootPerson.spouseIds || [])
            .map(sid => personMap.get(sid))
            .filter(s => s)
            .map(s => ({ role: 'Małżonek', ...s }));

        // Dzieci
        const children = (childrenMap.get(rootPerson.id) || [])
            .map(cid => personMap.get(cid))
            .filter(c => c)
            .map(c => ({ role: 'Dziecko', ...c }));

        // Rodzeństwo
        const siblingIds = new Set();
        if (rootPerson.fatherId) {
            (childrenMap.get(rootPerson.fatherId) || []).forEach(id => {
                if (id !== rootPerson.id) siblingIds.add(id);
            });
        }
        if (rootPerson.motherId) {
            (childrenMap.get(rootPerson.motherId) || []).forEach(id => {
                if (id !== rootPerson.id) siblingIds.add(id);
            });
        }
        const siblings = Array.from(siblingIds)
            .map(sid => personMap.get(sid))
            .filter(s => s)
            .map(s => ({ role: 'Rodzeństwo', ...s }));

        // Renderowanie węzła drzewa
        const renderTreeNode = (person, isRoot = false, showRole = true) => {
            if (!person) return '';
            const bgColor = isRoot ? '#fff3cd' : (person.gender === 'M' ? '#e3f2fd' : '#fce4ec');
            const borderColor = isRoot ? '#f57f17' : (person.gender === 'M' ? '#1976d2' : '#c2185b');

            return `
                <div class="tree-node" style="
                    background: ${bgColor}; 
                    border: 2px solid ${borderColor}; 
                    border-radius: 10px; 
                    padding: 0.75rem 1rem;
                    min-width: 140px;
                    max-width: 180px;
                    text-align: center;
                    cursor: ${person.protocolKey ? 'pointer' : 'default'};
                    transition: all 0.2s;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                " 
                onclick="${person.protocolKey ? `window.open('../wlasciciele/protokol.html?ownerId=${person.protocolKey}', '_blank')` : ''}"
                title="${person.protocolKey ? 'Kliknij aby otworzyć protokół' : person.name}">
                    ${showRole && person.role ? `<div style="font-size: 0.6rem; text-transform: uppercase; color: #888; margin-bottom: 0.2rem;">${person.role}</div>` : ''}
                    <div style="font-weight: 700; font-size: 0.85rem; color: #333;">
                        ${person.name}
                    </div>
                    <div style="font-size: 0.7rem; color: #666; margin-top: 0.2rem;">
                        ${formatYears(person)}
                    </div>
                    ${person.protocolKey ? '<div style="font-size: 0.65rem; color: #007bff; margin-top: 0.2rem;">📜</div>' : ''}
                </div>
            `;
        };

        // CSS dla linii drzewa
        const treeStyles = `
            <style>
                .tree-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0;
                    padding: 1.5rem;
                    min-width: max-content;
                    width: max-content;
                }
                .tree-scroll-wrapper {
                    min-width: max-content;
                    display: inline-block;
                    padding: 1rem;
                    box-sizing: border-box;
                }
                .tree-level {
                    display: flex;
                    justify-content: center;
                    gap: 2rem;
                    position: relative;
                    min-width: max-content;
                }
                .tree-connector-down {
                    width: 2px;
                    height: 30px;
                    background: #ccc;
                    margin: 0 auto;
                }
                .tree-pair {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    min-width: max-content;
                }
                .tree-pair-connector {
                    width: 30px;
                    height: 2px;
                    background: #e74c3c;
                    position: relative;
                    flex-shrink: 0;
                }
                .tree-pair-connector::after {
                    content: '💕';
                    position: absolute;
                    top: -10px;
                    left: 50%;
                    transform: translateX(-50%);
                    font-size: 14px;
                }
                .tree-branch {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .tree-main-column {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .tree-with-siblings {
                    display: flex;
                    align-items: flex-start;
                    gap: 2rem;
                    min-width: max-content;
                }
                .tree-siblings-section {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    opacity: 0.8;
                    padding-top: 1.5rem;
                }
                .tree-siblings-grid {
                    display: flex;
                    gap: 0.5rem;
                    justify-content: center;
                    min-width: max-content;
                }
                .tree-children {
                    display: flex;
                    justify-content: center;
                    gap: 1rem;
                    position: relative;
                    padding-top: 30px;
                    min-width: max-content;
                }
                .tree-children::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 50%;
                    width: 2px;
                    height: 15px;
                    background: #ccc;
                }
                .tree-children-connector {
                    position: absolute;
                    top: 15px;
                    height: 2px;
                    background: #ccc;
                }
                .tree-child-branch {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    flex-shrink: 0;
                }
                .tree-child-branch::before {
                    content: '';
                    width: 2px;
                    height: 15px;
                    background: #ccc;
                }
                .generation-label {
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    color: #888;
                    margin: 1rem 0 0.5rem;
                    font-weight: 700;
                }
                .section-label {
                    font-size: 0.6rem;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    color: #999;
                    margin-bottom: 0.5rem;
                    font-weight: 600;
                }
            </style>
        `;

        // Generowanie HTML drzewa
        let treeHTML = treeStyles + '<div class="tree-scroll-wrapper"><div class="tree-content">';

        // POKOLENIE 1: Dziadkowie
        if (grandparentsFather.length > 0 || grandparentsMother.length > 0) {
            treeHTML += '<div class="generation-label">Dziadkowie</div>';
            treeHTML += '<div class="tree-level" style="gap: 4rem;">';

            if (grandparentsFather.length > 0) {
                treeHTML += '<div class="tree-branch"><div style="font-size: 0.6rem; color: #888; margin-bottom: 0.25rem;">od ojca</div><div class="tree-pair">';
                grandparentsFather.forEach((gp, i) => {
                    if (i > 0) treeHTML += '<div class="tree-pair-connector"></div>';
                    treeHTML += renderTreeNode(gp, false, false);
                });
                treeHTML += '</div></div>';
            }

            if (grandparentsMother.length > 0) {
                treeHTML += '<div class="tree-branch"><div style="font-size: 0.6rem; color: #888; margin-bottom: 0.25rem;">od matki</div><div class="tree-pair">';
                grandparentsMother.forEach((gp, i) => {
                    if (i > 0) treeHTML += '<div class="tree-pair-connector"></div>';
                    treeHTML += renderTreeNode(gp, false, false);
                });
                treeHTML += '</div></div>';
            }

            treeHTML += '</div>';
            treeHTML += '<div class="tree-connector-down"></div>';
        }

        // POKOLENIE 2: Rodzice
        if (parents.length > 0) {
            treeHTML += '<div class="generation-label">Rodzice</div>';
            treeHTML += '<div class="tree-level"><div class="tree-pair">';
            parents.forEach((p, i) => {
                if (i > 0) treeHTML += '<div class="tree-pair-connector"></div>';
                treeHTML += renderTreeNode(p);
            });
            treeHTML += '</div></div>';
            treeHTML += '<div class="tree-connector-down"></div>';
        }

        // POKOLENIE 3: Layout z rodzeństwem po bokach
        treeHTML += '<div class="tree-with-siblings">';

        // Rodzeństwo po LEWEJ stronie
        if (siblings.length > 0) {
            treeHTML += '<div class="tree-siblings-section">';
            treeHTML += '<div class="section-label">Rodzeństwo</div>';
            treeHTML += '<div class="tree-siblings-grid">';
            siblings.forEach(s => {
                treeHTML += renderTreeNode(s);
            });
            treeHTML += '</div></div>';
        }

        // GŁÓWNA KOLUMNA: Osoba + Małżonek + Dzieci
        treeHTML += '<div class="tree-main-column">';
        treeHTML += '<div class="generation-label">Główna osoba</div>';

        // Główna osoba z małżonkiem
        treeHTML += '<div class="tree-pair">';
        treeHTML += renderTreeNode(rootPerson, true);
        if (spouses.length > 0) {
            treeHTML += '<div class="tree-pair-connector"></div>';
            treeHTML += renderTreeNode(spouses[0]);
        }
        treeHTML += '</div>';

        // Dzieci - BEZPOŚREDNIO POD główną osobą
        if (children.length > 0) {
            treeHTML += '<div class="tree-connector-down"></div>';
            treeHTML += '<div class="generation-label">Dzieci</div>';
            treeHTML += '<div class="tree-children">';

            if (children.length > 1) {
                const childWidth = 160;
                const connectorWidth = (children.length - 1) * childWidth;
                treeHTML += `<div class="tree-children-connector" style="width: ${connectorWidth}px; left: calc(50% - ${connectorWidth / 2}px);"></div>`;
            }

            children.forEach(child => {
                treeHTML += '<div class="tree-child-branch">';
                treeHTML += renderTreeNode(child);
                treeHTML += '</div>';
            });
            treeHTML += '</div>';
        }

        treeHTML += '</div>'; // koniec tree-main-column
        treeHTML += '</div>'; // koniec tree-with-siblings



        treeHTML += '</div></div>'; // koniec tree-content i scroll-wrapper

        // Dodaj własny suwak do przesuwania w poziomie
        treeHTML += `
            <div class="tree-horizontal-scroll-control">
                <button class="scroll-arrow scroll-left" title="Przewiń w lewo">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <input type="range" class="horizontal-scroll-slider" min="0" max="100" value="50" title="Przesuń drzewo w lewo/prawo">
                <button class="scroll-arrow scroll-right" title="Przewiń w prawo">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;

        treeContainer.innerHTML = treeHTML;

        // Konfiguracja suwaka poziomego
        const scrollWrapper = treeContainer.querySelector('.tree-scroll-wrapper');
        const slider = treeContainer.querySelector('.horizontal-scroll-slider');
        const scrollLeftBtn = treeContainer.querySelector('.scroll-left');
        const scrollRightBtn = treeContainer.querySelector('.scroll-right');

        if (scrollWrapper && slider) {
            // Funkcja aktualizacji suwaka
            const updateSlider = () => {
                const maxScroll = treeContainer.scrollWidth - treeContainer.clientWidth;
                if (maxScroll > 0) {
                    slider.value = (treeContainer.scrollLeft / maxScroll) * 100;
                    slider.parentElement.style.display = 'flex';
                } else {
                    slider.parentElement.style.display = 'none';
                }
            };

            // Obsługa suwaka
            slider.addEventListener('input', () => {
                const maxScroll = treeContainer.scrollWidth - treeContainer.clientWidth;
                treeContainer.scrollLeft = (slider.value / 100) * maxScroll;
            });

            // Obsługa przycisków strzałek
            scrollLeftBtn.addEventListener('click', () => {
                treeContainer.scrollBy({ left: -200, behavior: 'smooth' });
            });

            scrollRightBtn.addEventListener('click', () => {
                treeContainer.scrollBy({ left: 200, behavior: 'smooth' });
            });

            // Synchronizacja suwaka z przewijaniem
            treeContainer.addEventListener('scroll', updateSlider);

            // Początkowa aktualizacja po załadowaniu
            setTimeout(updateSlider, 100);
        }

        // Aktualizacja legendy w nagłówku
        const dialogTitle = treeDialog.querySelector('.dialog-header h3');
        if (dialogTitle) {
            dialogTitle.innerHTML = `<i class="fas fa-sitemap"></i> Drzewo Genealogiczne <span style="font-size: 0.7rem; font-weight: normal; margin-left: 15px; color: #e0e0e0;">(Legenda: 💙 Mężczyzna | 💗 Kobieta | 💛 Właściciel | 💕 Małżeństwo)</span>`;
        }

        // Wyświetlenie dialogu
        treeDialog.showModal();
    };

    /* ==========================================================================
       GENEROWANIE PDF
       ========================================================================== */

    /**
     * Generuje PDF z treścią protokołu
     */
    const generatePDF = async () => {
        const ownerName = ownerData?.nazwa_wlasciciela || 'protokol';
        const fileName = `Protokol_${ownerName.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`;

        // Przygotowanie strony do eksportu
        document.body.classList.add('pdf-export');

        // Ukrycie elementów interaktywnych
        const elementsToHide = document.querySelectorAll(
            '.action-btn, .header-btn, .switch-btn, .details-toggle-btn, .view-switcher, .map-links-section, .top-header, .app-footer'
        );
        const originalDisplays = new Map();
        elementsToHide.forEach(el => originalDisplays.set(el, el.style.display));
        elementsToHide.forEach(el => el.style.display = 'none');

        // Rozwinięcie szczegółów działek
        const initiallyHiddenDetails = [...document.querySelectorAll('.plot-details-list.hidden')];
        document.querySelectorAll('.plot-details-list').forEach(el => el.classList.remove('hidden'));

        // Zarządzanie widokami działek
        const viewRzeczywiste = document.getElementById('view-rzeczywiste');
        const viewProtokol = document.getElementById('view-protokol');
        const wasRzeczywisteHidden = viewRzeczywiste?.classList.contains('hidden');
        const wasProtokolHidden = viewProtokol?.classList.contains('hidden');

        // Obliczenie różnic
        const computeHaveDifferences = () => {
            const A = ownerData?.dzialki_protokol || [];
            const B = ownerData?.dzialki_rzeczywiste || [];
            if (A.length !== B.length) return true;
            const idsA = new Set(A.map(p => p.id));
            const idsB = new Set(B.map(p => p.id));
            if (idsA.size !== idsB.size) return true;
            for (const id of idsA) if (!idsB.has(id)) return true;
            return false;
        };
        const differences = (typeof havePlotDifferences !== 'undefined')
            ? havePlotDifferences
            : computeHaveDifferences();

        if (differences) {
            viewRzeczywiste?.classList.remove('hidden');
            viewProtokol?.classList.remove('hidden');
        } else {
            viewRzeczywiste?.classList.remove('hidden');
            viewProtokol?.classList.add('hidden');
        }

        // Oczekiwanie na wyrenderowanie
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (document.fonts?.ready) { try { await document.fonts.ready; } catch (e) { } }
        await new Promise(r => setTimeout(r, 50));

        // Konfiguracja PDF
        const opt = {
            margin: 10,
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                scrollY: 0
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { avoid: '.content-card' }
        };

        const content = document.querySelector('.main-content');

        try {
            await html2pdf().from(content).set(opt).save();
        } finally {
            // Przywrócenie stanu strony
            elementsToHide.forEach(el => el.style.display = originalDisplays.get(el) || '');
            initiallyHiddenDetails.forEach(el => el.classList.add('hidden'));

            if (wasRzeczywisteHidden) viewRzeczywiste?.classList.add('hidden');
            else viewRzeczywiste?.classList.remove('hidden');
            if (wasProtokolHidden) viewProtokol?.classList.add('hidden');
            else viewProtokol?.classList.remove('hidden');

            document.body.classList.remove('pdf-export');
        }
    };

    /* ==========================================================================
       FUNKCJE POMOCNICZE
       ========================================================================== */

    /**
     * Wypełnia pole tekstem z obsługą wartości domyślnej
     */
    const fillField = (element, value) => {
        if (element) {
            element.innerHTML = value || '—';
        }
    };

    /**
     * Wyświetla sekcję opcjonalną jeśli zawiera treść
     */
    const showOptionalSection = (sectionId, fieldId, value) => {
        if (value && value.trim()) {
            const section = document.getElementById(sectionId);
            const field = document.getElementById(fieldId);

            if (section && field) {
                section.classList.remove('hidden');
                field.innerHTML = generateFractionHTML(value);
            }
        }
    };

    /**
     * Formatuje datę do polskiego formatu
     */
    const formatDate = (dateString) => {
        if (!dateString) return '—';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return dateString; // polski tekst daty
        return d.toLocaleDateString('pl-PL');
    };

    /**
     * Generuje HTML dla ułamków z formatowaniem
     */
    const generateFractionHTML = (text) => {
        if (!text) return '';

        return text
            .replace(/(\d+)\/(\d+)/g,
                `<span class="fraction">
                    <span class="numerator">$1</span>
                    <span class="denominator">$2</span>
                </span>`)
            .replace(/(?<!\/)\b(\d+)\b(?![\/<])/g,
                `<span class="whole-number">$1</span>`);
    };

    /**
     * Wyświetla komunikat błędu
     */
    const showError = (message) => {
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Inter, sans-serif;">
                <div style="text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #e53e3e; margin-bottom: 1rem;"></i>
                    <h1 style="color: #2d3748; margin-bottom: 0.5rem;">${message}</h1>
                    <a href="../mapa/mapa.html" style="color: #667eea; text-decoration: none; font-weight: 500;">
                        ← Wróć do mapy
                    </a>
                </div>
            </div>
        `;
    };

    /**
     * Zarządza motywem kolorystycznym
     */
    const setupThemeLogic = () => {
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (!themeToggleBtn) return;

        const icon = themeToggleBtn.querySelector('i');

        // Aplikacja motywu
        const applyTheme = (theme) => {
            document.body.classList.toggle('dark-mode', theme === 'dark');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
            }
        };

        // Odczyt zapisanego motywu
        const savedTheme = localStorage.getItem('mapTheme') || 'light';
        applyTheme(savedTheme);

        // Obsługa zmiany motywu
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('mapTheme', newTheme);
            applyTheme(newTheme);
        });
    };

    /**
     * Zarządza trybem pełnoekranowym
     */
    const setupFullscreen = () => {
        if (!fullscreenBtn) return;
        const icon = fullscreenBtn.querySelector('i');

        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (icon) {
                icon.className = document.fullscreenElement ? 'fas fa-compress' : 'fas fa-expand';
            }
        });
    };

    /* ==========================================================================
       URUCHOMIENIE APLIKACJI
       ========================================================================== */
    init();
});