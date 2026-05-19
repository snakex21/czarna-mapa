/**
 * Skrypt automatycznie wstawia dane miejscowości do placeholderów w HTML
 * Działa dla wszystkich stron: mapa, statystyki, historia, strona główna
 */

(function() {
    'use strict';

    console.log('🚀 location-data.js uruchomiony');

    // Sprawdź czy konfiguracja została załadowana
    if (typeof window.LOCATION_CONFIG === 'undefined') {
        console.error('❌ LOCATION_CONFIG nie został załadowany!');
        return;
    }

    const config = window.LOCATION_CONFIG;
    console.log('✓ Konfiguracja załadowana:', config);

    // Mapa placeholderów na wartości
    const placeholders = {
        '{{MIEJSCOWOSC}}': config.name || '',
        '{{MIEJSCOWOSC_PELNA}}': config.fullName || '',
        '{{POWIAT}}': config.powiat || '',
        '{{REGION}}': config.region || '',
        '{{YEAR}}': config.year || '',
        '{{WIEK}}': config.century || '',
        '{{HOMEPAGE_DESCRIPTION}}': config.homepageDescription || '',
        '{{HISTORY_P1}}': config.historyParagraph1 || '',
        '{{HISTORY_P2}}': config.historyParagraph2 || '',
        '{{HISTORY_P3}}': config.historyParagraph3 || '',
        '{{PHOTO1_PATH}}': config.photo1Path || '',
        '{{PHOTO1_CAPTION}}': config.photo1Caption || '',
        '{{PHOTO2_PATH}}': config.photo2Path || '',
        '{{PHOTO2_CAPTION}}': config.photo2Caption || ''
    };

    console.log('✓ Placeholdery do zastąpienia:', placeholders);

    /**
     * Zamienia wszystkie placeholdery w dokumencie na dane z konfiguracji
     */
    function replacePlaceholders(rootElement) {
        const root = rootElement || document.body;
        let replacedCount = 0;

        // Funkcja rekurencyjna do przeszukiwania wszystkich węzłów tekstowych
        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                // To jest węzeł tekstowy - zamień placeholdery
                let text = node.textContent;
                let originalText = text;

                for (const [placeholder, value] of Object.entries(placeholders)) {
                    if (text.includes(placeholder)) {
                        console.log(`🔍 Znaleziono placeholder: ${placeholder} w tekście:`, text);
                        text = text.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
                        replacedCount++;
                    }
                }

                if (text !== originalText) {
                    node.textContent = text;
                    console.log(`✅ Zamieniono: "${originalText}" → "${text}"`);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // To jest element - przeszukaj jego dzieci
                // Pomiń skrypty i style
                if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                    // Sprawdź również atrybuty (np. title, placeholder, data-*)
                    if (node.hasAttributes()) {
                        const attributes = node.attributes;
                        for (let i = 0; i < attributes.length; i++) {
                            const attr = attributes[i];
                            let attrValue = attr.value;
                            let originalValue = attrValue;

                            for (const [placeholder, value] of Object.entries(placeholders)) {
                                if (attrValue.includes(placeholder)) {
                                    console.log(`🔍 Znaleziono placeholder w atrybucie ${attr.name}: ${placeholder}`);
                                    attrValue = attrValue.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
                                    replacedCount++;
                                }
                            }

                            if (attrValue !== originalValue) {
                                attr.value = attrValue;
                                console.log(`✅ Zamieniono atrybut ${attr.name}: "${originalValue}" → "${attrValue}"`);
                            }
                        }
                    }

                    // Przeszukaj dzieci
                    for (let i = 0; i < node.childNodes.length; i++) {
                        processNode(node.childNodes[i]);
                    }
                }
            }
        }

        // Przetworz drzewo DOM
        processNode(root);

        // Zaktualizuj również tytuł strony (tylko jeśli przetwarzamy cały dokument)
        if (root === document.body && document.title) {
            let title = document.title;
            let originalTitle = title;
            for (const [placeholder, value] of Object.entries(placeholders)) {
                if (title.includes(placeholder)) {
                    console.log(`🔍 Znaleziono placeholder w tytule: ${placeholder}`);
                    title = title.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
                    replacedCount++;
                }
            }
            if (title !== originalTitle) {
                document.title = title;
                console.log(`✅ Zamieniono tytuł: "${originalTitle}" → "${title}"`);
            }
        }

        return replacedCount;
    }

    // Eksportuj funkcję globalnie, żeby można było wywołać ręcznie
    window.applyLocationData = function() {
        console.log('🔄 Ręczne wywołanie applyLocationData()');
        const count = replacePlaceholders();
        console.log(`✓ Zamieniono ${count} placeholderów`);
        console.log('✓ Dane miejscowości:', config);
    };

    /**
     * Generuje galerię zdjęć historycznych dynamicznie
     */
    function generateHistoryPhotos() {
        const gallery = document.getElementById('history-photo-gallery');
        if (!gallery) {
            console.log('ℹ️ Brak elementu #history-photo-gallery - pomijam generowanie zdjęć');
            return;
        }

        console.log('🔍 DEBUG: config.historyPhotos =', config.historyPhotos);
        console.log('🔍 DEBUG: typeof config.historyPhotos =', typeof config.historyPhotos);

        const photos = config.historyPhotos || [];
        console.log('🔍 DEBUG: photos =', photos);
        console.log('🔍 DEBUG: photos.length =', photos.length);

        if (photos.length === 0) {
            console.log('ℹ️ Brak zdjęć historycznych do wygenerowania');
            gallery.innerHTML = '<p class="no-photos">Brak zdjęć historycznych.</p>';
            return;
        }

        console.log(`📸 Generuję ${photos.length} zdjęć historycznych`);
        gallery.innerHTML = ''; // Wyczyść zawartość

        photos.forEach((photo, index) => {
            console.log(`🔍 DEBUG: Generuję zdjęcie ${index}:`, photo);

            const figure = document.createElement('figure');
            figure.className = 'gallery-item';

            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'image-wrapper';

            const img = document.createElement('img');
            img.src = `/history_photos/${photo.filename}`;
            img.alt = photo.caption || `Zdjęcie historyczne ${index + 1}`;

            console.log(`🔍 DEBUG: img.src = ${img.src}`);

            const overlay = document.createElement('div');
            overlay.className = 'image-overlay';
            overlay.innerHTML = '<i class="fas fa-search-plus"></i>';

            imageWrapper.appendChild(img);
            imageWrapper.appendChild(overlay);

            const figcaption = document.createElement('figcaption');
            figcaption.innerHTML = `<i class="fas fa-image"></i> ${photo.caption || 'Brak podpisu'}`;

            figure.appendChild(imageWrapper);
            figure.appendChild(figcaption);
            gallery.appendChild(figure);

            // Dodaj obsługę kliknięcia (modal)
            imageWrapper.addEventListener('click', function() {
                const modal = document.createElement('div');
                modal.className = 'image-modal';
                modal.innerHTML = `
                    <div class="modal-content">
                        <span class="modal-close">&times;</span>
                        <img src="${img.src}" alt="${img.alt}">
                        <p>${photo.caption || ''}</p>
                    </div>
                `;
                document.body.appendChild(modal);

                modal.addEventListener('click', function(e) {
                    if (e.target === modal || e.target.className === 'modal-close') {
                        modal.remove();
                    }
                });
            });
        });

        console.log(`✓ Wygenerowano ${photos.length} zdjęć w galerii`);
    }

    // Uruchom gdy DOM jest gotowy
    function initialize() {
        console.log('🔧 Inicjalizacja location-data.js');
        const count = replacePlaceholders();
        console.log(`✓ Dane miejscowości zostały wstawione (inicjalizacja): zamieniono ${count} placeholderów`);

        // Generuj galerię zdjęć
        generateHistoryPhotos();

        // Obserwuj zmiany DOM i automatycznie przetwarzaj nową zawartość
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                // Jeśli dodano nowe węzły
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const count = replacePlaceholders(node);
                            if (count > 0) {
                                console.log(`✓ MutationObserver: zamieniono ${count} placeholderów w nowej zawartości`);
                            }
                        }
                    });
                }
            });
        });

        // Zacznij obserwować zmiany w document.body
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('✓ MutationObserver aktywny - automatyczne przetwarzanie nowej zawartości');
    }

    // Uruchom
    if (document.readyState === 'loading') {
        console.log('⏳ Czekam na DOMContentLoaded...');
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // DOM już załadowany
        console.log('✓ DOM już załadowany, uruchamiam od razu');
        initialize();
    }

    // Dodatkowe wywołanie po pełnym załadowaniu strony (dla pewności)
    window.addEventListener('load', function() {
        setTimeout(function() {
            console.log('🔄 Dodatkowe wywołanie po window.load');
            const count = replacePlaceholders();
            console.log(`✓ Dane miejscowości ponownie wstawione: zamieniono ${count} placeholderów`);
        }, 100);
    });
})();
