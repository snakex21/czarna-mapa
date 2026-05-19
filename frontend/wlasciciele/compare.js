/* ==========================================================================
   Plik: compare.js
   Opis: Skrypt obsługujący porównywanie dwóch protokołów katastralnych.
         Umożliwia równoległe wyświetlanie danych, generowanie PDF,
         przeglądanie skanów oraz wizualizację drzew genealogicznych.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  /* ==========================================================================
     INICJALIZACJA KOMPONENTÓW UI
     ========================================================================== */

  /**
   * Konfiguracja dialogu drzewa genealogicznego
   */
  const setupTreeDialog = () => {
    const closeTreeBtn = document.getElementById("closeTreeBtn");
    const treeDialog = document.getElementById("treeDialog");
    const treeContainer = document.getElementById("treeContainer");

    console.log("Inicjalizacja dialogu drzewa:", { closeTreeBtn, treeDialog, treeContainer });

    if (closeTreeBtn && !closeTreeBtn.hasAttribute('data-initialized')) {
      closeTreeBtn.addEventListener("click", () => {
        console.log("Zamykanie dialogu drzewa");
        if (treeDialog) {
          treeDialog.close();
          if (treeContainer) treeContainer.innerHTML = "";
        }
      });
      closeTreeBtn.setAttribute('data-initialized', 'true');

      // Obsługa klawisza ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && treeDialog && treeDialog.open) {
          treeDialog.close();
          if (treeContainer) treeContainer.innerHTML = "";
        }
      });

      console.log("Dialog drzewa zainicjalizowany");
    }
  };

  /**
   * Zarządzanie motywem kolorystycznym
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
   * Zarządzanie trybem pełnoekranowym
   */
  const setupFullscreen = () => {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
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

  // Inicjalizacja komponentów
  setupTreeDialog();
  setupThemeLogic();
  setupFullscreen();

  /* ==========================================================================
     WALIDACJA PARAMETRÓW I INICJALIZACJA
     ========================================================================== */

  const urlParams = new URLSearchParams(window.location.search);
  const ownerKeys = urlParams.get("owners")?.split(",");

  // Ustawienie aktualnej daty
  const currentDateEl = document.getElementById('currentDate');
  if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString('pl-PL');
  }

  // Walidacja - wymagane dokładnie 2 klucze właścicieli
  if (!ownerKeys || ownerKeys.length !== 2) {
    showError("Proszę wybrać dwóch właścicieli do porównania.");
    return;
  }

  /**
   * Wyświetla komunikat błędu
   */
  function showError(message) {
    document.querySelector('.compare-container').innerHTML = `
      <div style="width: 100%; display: flex; justify-content: center; align-items: center; min-height: 400px;">
        <div style="text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #e53e3e; margin-bottom: 1rem;"></i>
          <h2 style="color: #2d3748; margin-bottom: 0.5rem;">Błąd</h2>
          <p style="color: #718096;">${message}</p>
        </div>
      </div>
    `;
  }

  /**
   * Wyświetla spinner ładowania
   */
  function showLoadingSpinner() {
    document.querySelector('.compare-container').innerHTML = `
      <div class="loading-spinner" style="width: 100%;">
        <i class="fas fa-spinner fa-spin"></i>
        <span style="margin-left: 1rem;">Ładowanie protokołów...</span>
      </div>
    `;
  }

  /* ==========================================================================
     KONFIGURACJA LINKÓW DO MAPY
     ========================================================================== */

  const mapLinkReal = document.getElementById("mapLinkReal");
  const mapLinkProtocol = document.getElementById("mapLinkProtocol");
  const mapLinkBoth = document.getElementById("mapLinkBoth");
  const mapUrl = "../mapa/mapa.html";

  const ownersParam = ownerKeys.join(",");

  // Tworzenie parametryzowanych linków
  if (mapLinkReal)
    mapLinkReal.href = `${mapUrl}?${new URLSearchParams({ highlightTopOwners: ownersParam, ownership: "rzeczywista" })}`;
  if (mapLinkProtocol)
    mapLinkProtocol.href = `${mapUrl}?${new URLSearchParams({ highlightTopOwners: ownersParam, ownership: "protokol" })}`;
  if (mapLinkBoth)
    mapLinkBoth.href = `${mapUrl}?${new URLSearchParams({ highlightTopOwners: ownersParam, ownership: "wszystkie" })}`;

  /* ==========================================================================
     MODAL SKANÓW PROTOKOŁU
     ========================================================================== */

  const imageModal = document.getElementById("imageModal");
  const modalImg = document.getElementById("modalImageSrc");
  const prevBtn = document.getElementById("prevImageBtn");
  const nextBtn = document.getElementById("nextImageBtn");
  const counterLbl = document.getElementById("pageCounter");
  let panzoomInst = null;
  let imgs = [];
  let idx = 0;

  const treeDialog = document.getElementById("treeDialog");
  const closeTreeBtn = document.getElementById("closeTreeBtn");
  const treeContainer = document.getElementById("treeContainer");

  /**
   * Otwiera modal z galerią skanów
   */
  const openModal = (arr) => {
    if (!arr || arr.length === 0) {
      alert("Brak skanów protokołu.");
      return;
    }
    imgs = arr;
    idx = 0;
    updateModal();
    imageModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    panzoomInst = Panzoom(modalImg, { maxScale: 5, minScale: 0.5 });
    modalImg.parentElement.addEventListener("wheel", panzoomInst.zoomWithWheel);
  };

  /**
   * Zamyka modal skanów
   */
  const closeModal = () => {
    imageModal.classList.add("hidden");
    document.body.style.overflow = "auto";
    if (panzoomInst) {
      panzoomInst.destroy();
      panzoomInst = null;
    }
  };

  /**
   * Aktualizuje zawartość modala
   */
  const updateModal = () => {
    modalImg.src = imgs[idx];
    counterLbl.textContent = `Strona ${idx + 1} / ${imgs.length}`;
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === imgs.length - 1;
    document.querySelector(".modal-nav-controls").style.display =
      imgs.length > 1 ? "flex" : "none";
  };

  // Event listenery dla modala
  prevBtn.addEventListener("click", () => {
    if (idx > 0) {
      idx--;
      updateModal();
      panzoomInst.reset();
    }
  });

  nextBtn.addEventListener("click", () => {
    if (idx < imgs.length - 1) {
      idx++;
      updateModal();
      panzoomInst.reset();
    }
  });

  document
    .querySelector(".modal-close-btn")
    .addEventListener("click", closeModal);

  imageModal.addEventListener("click", (e) => {
    if (e.target === imageModal) closeModal();
  });

  /* ==========================================================================
  /* ==========================================================================
     DRZEWO GENEALOGICZNE
     ========================================================================== */

  /**
   * Rysuje drzewo genealogiczne (metoda kart - port z protokol.js)
   */
  const drawGenealogyTree = (treeData) => {
    // Pobieranie elementów DOM
    const treeDialog = document.getElementById("treeDialog");
    const treeContainer = document.getElementById("treeContainer");

    // Walidacja elementów
    if (!treeDialog || !treeContainer) {
      console.error("BŁĄD: Nie znaleziono elementów dialogu", { treeDialog, treeContainer });
      alert("Błąd: Nie można otworzyć drzewa genealogicznego (brak elementów DOM)");
      return;
    }

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
            .tree-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0;
                padding: 1.5rem;
                min-width: max-content;
            }
            .tree-scroll-wrapper {
                height: 100%;
                width: 100%;
                padding: 1rem;
                box-sizing: border-box;
            }
            .tree-level {
                display: flex;
                justify-content: center;
                gap: 2rem;
                position: relative;
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
            }
            .tree-pair-connector {
                width: 30px;
                height: 2px;
                background: #e74c3c;
                position: relative;
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
                flex-wrap: wrap;
                gap: 0.5rem;
                max-width: 400px;
                justify-content: center;
            }
            .tree-children {
                display: flex;
                justify-content: center;
                gap: 1rem;
                position: relative;
                padding-top: 30px;
                flex-wrap: wrap;
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
    let treeHTML = treeStyles + '<div class="tree-scroll-wrapper"><div class="tree-container">';

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



    treeHTML += '</div></div>'; // koniec tree-container i scroll-wrapper
    treeContainer.innerHTML = treeHTML;

    // Aktualizacja legendy w nagłówku
    const dialogTitle = treeDialog.querySelector('.dialog-header h3');
    if (dialogTitle) {
      dialogTitle.innerHTML = `<i class="fas fa-sitemap"></i> Drzewo Genealogiczne <span style="font-size: 0.7rem; font-weight: normal; margin-left: 15px; color: #e0e0e0;">(Legenda: 💙 Mężczyzna | 💗 Kobieta | 💛 Właściciel | 💕 Małżeństwo)</span>`;
    }

    // Wyświetlenie dialogu
    if (treeDialog.showModal) {
      treeDialog.showModal();
    } else {
      treeDialog.setAttribute('open', '');
    }
  };

  /* ==========================================================================
     FUNKCJE POMOCNICZE
     ========================================================================== */

  /**
   * Generuje HTML dla formatowania ułamków
   */
  const generateFractionHTML = (txt) => {
    if (!txt) return "";

    return String(txt)
      .replace(
        /(\d+)\/(\d+)/g,
        '<span class="fraction"><span class="numerator">$1</span><span class="denominator">$2</span></span>',
      )
      .replace(
        /(?<!\/)\b(\d+)\b(?![\/<])/g,
        '<span class="whole-number">$1</span>',
      );
  };

  /**
   * Zapewnia załadowanie biblioteki html2pdf
   */
  let pdfLibPromise = null;
  const ensureHtml2Pdf = () => {
    if (typeof html2pdf !== "undefined") return Promise.resolve();
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject();
      document.head.appendChild(s);
    });
    return pdfLibPromise;
  };

  /**
   * Generuje PDF z kolumny protokołu
   */
  const createPDF = async (columnEl, ownerName = "protokol", ownerData = null) => {
    // Ładowanie biblioteki
    try {
      await ensureHtml2Pdf();
    } catch {
      return alert("Nie udało się załadować modułu PDF.");
    }

    // Tryb eksportu PDF
    document.body.classList.add('pdf-export');

    // Ukrycie elementów interaktywnych
    const elementsToHide = columnEl.querySelectorAll(
      '.action-btn, .switch-btn, .details-toggle-btn, .view-switcher'
    );
    const originalDisplays = new Map();
    elementsToHide.forEach(el => originalDisplays.set(el, el.style.display));
    elementsToHide.forEach(el => el.style.display = 'none');

    // Zachowanie stanu widoków
    const allViews = Array.from(columnEl.querySelectorAll('.view-container'));
    const viewStates = allViews.map(el => ({
      el,
      hadHiddenClass: el.classList.contains('hidden'),
      prevDisplay: el.style.display
    }));

    const isVisible = (el) =>
      !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';

    let visibleViews = allViews.filter(isVisible);

    // Logika ukrywania duplikatów
    let forcedHideProtocol = false;
    if (ownerData) {
      const allPlots = ownerData.dzialki_wszystkie || [];
      const real = allPlots.filter(p => p.typ_posiadania === 'własność rzeczywista');
      const prot = allPlots.filter(p => p.typ_posiadania !== 'własność rzeczywista');

      const listsEqualById = (A, B) => {
        if (A.length !== B.length) return false;
        const idsA = new Set(A.map(p => p.id));
        for (const p of B) if (!idsA.has(p.id)) return false;
        return true;
      };

      const equal = listsEqualById(real, prot);
      if (equal) {
        const protocolView = columnEl.querySelector(`#view-protokol-${ownerData.unikalny_klucz}`);
        if (protocolView && isVisible(protocolView)) {
          protocolView.classList.add('hidden');
          forcedHideProtocol = true;
          visibleViews = allViews.filter(isVisible);
        }
      }
    }

    // Rozwinięcie szczegółów działek
    const detailsOpened = [];
    visibleViews.forEach(v => {
      v.querySelectorAll('.plot-details-list.hidden').forEach(dl => {
        detailsOpened.push(dl);
        dl.classList.remove('hidden');
      });
    });

    // Oczekiwanie na stabilność renderowania
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch (e) { } }
    await new Promise(r => setTimeout(r, 50));

    // Konfiguracja PDF
    const opt = {
      margin: 10,
      filename: `Protokol_${String(ownerName).replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollY: 0
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: {
        mode: ['css', 'avoid-all'],
        avoid: ['.plot-category-block', '.content-card']
      }
    };

    try {
      await html2pdf().from(columnEl).set(opt).save();
    } finally {
      // Przywrócenie stanu
      elementsToHide.forEach(el => el.style.display = originalDisplays.get(el) || '');
      detailsOpened.forEach(dl => dl.classList.add('hidden'));

      // Przywrócenie widoków
      viewStates.forEach(s => {
        s.el.style.display = s.prevDisplay;
        s.el.classList.toggle('hidden', s.hadHiddenClass);
      });

      document.body.classList.remove('pdf-export');
    }
  };

  /**
   * Wyszukuje skany protokołu
   */
  const findProtocolImages = (key) =>
    new Promise((resolve) => {
      const baseDir = `/protokoly/${key}/`;
      let result = [],
        i = 1;

      const loadNext = () => {
        const img = new Image();
        img.src = `${baseDir}${i}.jpg`;
        img.onload = () => {
          result.push(img.src);
          i++;
          loadNext();
        };
        img.onerror = () => {
          if (i === 1 && result.length === 0) {
            const single = `/protokoly/${key}.jpg`;
            const sImg = new Image();
            sImg.src = single;
            sImg.onload = () => {
              result.push(sImg.src);
              resolve(result);
            };
            sImg.onerror = () => resolve(result);
          } else resolve(result);
        };
      };
      loadNext();
    });

  /* ==========================================================================
     SZABLONY HTML I BUDOWANIE INTERFEJSU
     ========================================================================== */

  /**
   * Szablon HTML kolumny protokołu
   */
  const columnTemplate = (d) => {
    const uid = d.unikalny_klucz;
    const genealogyButtonHTML = d.ma_drzewo_genealogiczne
      ? `<button id="showTreeBtn-${uid}" class="action-btn tree-btn">
          <i class="fas fa-project-diagram"></i> Drzewo genealogiczne
         </button>`
      : "";

    return `
      <!-- Nagłówek protokołu -->
      <div class="protocol-header-card">
        <div class="protocol-number-badge">L.p. ${d.numer_protokolu || "—"}</div>
        <h2 class="protocol-main-title">
          Protokół dochodzeń miejscowych
          <span class="protocol-location">${d.gmina_katastralna ? `w gminie katastralnej ${d.gmina_katastralna}` : ''}</span>
        </h2>
        <div class="protocol-actions">
          <button id="downloadPdfBtn-${uid}" class="action-btn">
            <i class="fas fa-file-pdf"></i> Pobierz PDF
          </button>
          ${genealogyButtonHTML}
          <button id="showOriginalBtn-${uid}" class="action-btn hidden">
            <i class="fas fa-images"></i> Oryginał
          </button>
        </div>
      </div>
      
      <!-- Dane właściciela -->
      <div class="content-card owner-card-section">
        <div class="card-header">
          <h3><i class="fas fa-user"></i> Dane Właściciela</h3>
        </div>
        <div class="card-body">
          <div class="owner-info">
            <div>
              <div class="owner-name-main">${d.nazwa_wlasciciela || ""}</div>
              ${d.numer_domu ? `
              <div class="owner-secondary-info">
                Dom: <span class="owner-details-value">${generateFractionHTML(d.numer_domu)}</span>
              </div>` : ''}
            </div>
          </div>
          <button id="showHouseOnMapBtn-${uid}" class="action-btn map-btn hidden">
            <i class="fas fa-home"></i> Pokaż dom na mapie
          </button>
        </div>
      </div>
      
      <!-- Genealogia -->
      ${d.genealogia ? `
      <div class="content-card genealogy-section">
        <div class="card-header">
          <h3><i class="fas fa-sitemap"></i> Genealogia</h3>
        </div>
        <div class="card-body">
          <div class="info-content">${d.genealogia}</div>
        </div>
      </div>` : ''}
      
      <!-- Przełącznik widoków -->
      <div class="view-switcher" data-target-id="${uid}">
        <button class="switch-btn active" data-view="rzeczywiste">
          <i class="fas fa-check-circle"></i> Stan Rzeczywisty
        </button>
        <button class="switch-btn" data-view="protokol">
          <i class="fas fa-file-alt"></i> Stan wg Protokołu
        </button>
      </div>
      
      <!-- Działki rzeczywiste -->
      <div id="view-rzeczywiste-${uid}" class="view-container">
        <div class="content-card plots-section">
          <div class="card-header">
            <h3><i class="fas fa-layer-group"></i> Działki Rzeczywiste</h3>
            <button class="details-toggle-btn" data-target="rzeczywiste-details-${uid}">
              <i class="fas fa-chevron-down"></i>
            </button>
          </div>
          <div class="card-body">
            <div class="plots-summary">
              <div class="plot-numbers"></div>
              <div class="plot-summary"></div>
            </div>
            <div class="plot-details-list hidden" id="rzeczywiste-details-${uid}"></div>
          </div>
        </div>
      </div>
      
      <!-- Działki wg protokołu -->
      <div id="view-protokol-${uid}" class="view-container hidden">
        <div class="content-card plots-section">
          <div class="card-header">
            <h3><i class="fas fa-layer-group"></i> Działki wg Protokołu</h3>
            <button class="details-toggle-btn" data-target="protokol-details-${uid}">
              <i class="fas fa-chevron-down"></i>
            </button>
          </div>
          <div class="card-body">
            <div class="plots-summary">
              <div class="plot-numbers"></div>
              <div class="plot-summary"></div>
            </div>
            <div class="plot-details-list hidden" id="protokol-details-${uid}"></div>
          </div>
        </div>
      </div>
      
      <!-- Treść protokołu -->
      <div class="content-card protocol-content-section">
        <div class="card-header">
          <h3><i class="fas fa-scroll"></i> Treść protokołu</h3>
        </div>
        <div class="card-body">
          <div class="info-content">${generateFractionHTML(d.pelna_historia || "")}</div>
        </div>
      </div>
      
      <!-- Współwłasność -->
      ${d.wspolwlasnosc ? `
      <div class="content-card" id="wspolwlasnoscSection-${uid}">
        <div class="card-header">
          <h3><i class="fas fa-users"></i> Współwłasność / Służebność</h3>
        </div>
        <div class="card-body">
          <div class="info-content">${generateFractionHTML(d.wspolwlasnosc)}</div>
        </div>
      </div>` : ''}
      
      <!-- Powiązania i transakcje -->
      ${d.powiazania_i_transakcje_html ? `
      <div class="content-card" id="powiazaniaTransakcjeSection-${uid}">
        <div class="card-header">
          <h3><i class="fas fa-exchange-alt"></i> Powiązania i transakcje</h3>
        </div>
        <div class="card-body">
          <div class="info-content">${generateFractionHTML(d.powiazania_i_transakcje_html)}</div>
        </div>
      </div>` : ''}
      
      <!-- Interpretacja -->
      ${d.interpretacja_i_wnioski ? `
      <div class="content-card" id="interpretacjaWnioskiSection-${uid}">
        <div class="card-header">
          <h3><i class="fas fa-lightbulb"></i> Interpretacja i wnioski</h3>
        </div>
        <div class="card-body">
          <div class="info-content">${generateFractionHTML(d.interpretacja_i_wnioski)}</div>
        </div>
      </div>` : ''}
    `;
  };

  /**
   * Wypełnia sekcję działek danymi
   */
  const fillPlotSection = (containerId, plots, uid) => {
    const container = document.querySelector(`#${containerId}`);
    if (!container) return;

    const plotsSection = container.querySelector('.plots-section');
    if (!plotsSection) return;

    if (!plots || plots.length === 0) {
      container.style.display = "none";
      return;
    }
    container.style.display = "block";

    const summaryEl = plotsSection.querySelector(".plots-summary");
    const numbersDiv = summaryEl.querySelector(".plot-numbers");
    const summaryDiv = summaryEl.querySelector(".plot-summary");
    const detailsList = plotsSection.querySelector(".plot-details-list");

    // Lista numerów działek
    numbersDiv.innerHTML = plots
      .map((p) => generateFractionHTML(p.nazwa_lub_numer))
      .join(", ");

    // Podsumowanie kategorii
    const counts = plots.reduce((acc, p) => {
      const k = p.kategoria || "nieznana";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    summaryDiv.textContent = `(w tym: ${Object.entries(counts)
      .map(([k, c]) => `${c} ${k}`)
      .join(", ")})`;

    // Szczegóły według kategorii
    const byCat = plots.reduce((acc, p) => {
      const k = p.kategoria || "nieznana";
      (acc[k] = acc[k] || []).push(p);
      return acc;
    }, {});

    detailsList.innerHTML = Object.entries(byCat)
      .map(
        ([k, list]) => `
          <div class="plot-category-block">
            <h4>${k.charAt(0).toUpperCase() + k.slice(1)} (${list.length}):</h4>
            <div class="plot-numbers">
              ${list.map((p) => generateFractionHTML(p.nazwa_lub_numer)).join(", ")}
            </div>
          </div>
        `,
      )
      .join("");
  };

  /**
   * Buduje kolumnę protokołu z danymi
   */
  const buildColumn = (data, columnIndex) => {
    const colEl = document.getElementById(`protocol-${columnIndex + 1}`);
    if (!colEl) {
      console.error(`Nie znaleziono elementu protocol-${columnIndex + 1}`);
      return;
    }

    colEl.innerHTML = columnTemplate(data);

    // Przycisk "Pokaż dom na mapie"
    const showHouseBtn = colEl.querySelector(`#showHouseOnMapBtn-${data.unikalny_klucz}`);
    if (data.dom_obiekt_id && showHouseBtn) {
      showHouseBtn.classList.remove('hidden');
      showHouseBtn.addEventListener('click', () => {
        const mapUrl = '../mapa/mapa.html';
        const plotIds = (data.dzialki_wszystkie || []).map(p => p.id);
        const allIdsToHighlight = [data.dom_obiekt_id, ...plotIds];
        const uniqueIds = [...new Set(allIdsToHighlight)].join(',');
        const params = new URLSearchParams({
          highlightByIds: uniqueIds
        });
        window.location.href = `${mapUrl}?${params.toString()}`;
      });
    }

    // Wypełnienie sekcji działek
    const allPlots = data.dzialki_wszystkie || [];
    const rzeczywistePlots = allPlots.filter((p) => p.typ_posiadania === "własność rzeczywista");
    const protokolPlots = allPlots.filter((p) => p.typ_posiadania !== "własność rzeczywista");

    fillPlotSection(`view-rzeczywiste-${data.unikalny_klucz}`, rzeczywistePlots, data.unikalny_klucz);
    fillPlotSection(`view-protokol-${data.unikalny_klucz}`, protokolPlots, data.unikalny_klucz);

    // Przełącznik widoków
    const switcher = colEl.querySelector(".view-switcher");
    const switchBtns = switcher.querySelectorAll(".switch-btn");

    switchBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        const uid = switcher.dataset.targetId;

        colEl.querySelectorAll(".view-container").forEach((v) => v.classList.add("hidden"));
        const targetView = colEl.querySelector(`#view-${view}-${uid}`);
        if (targetView) targetView.classList.remove("hidden");

        switchBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Przyciski rozwijania szczegółów
    colEl.querySelectorAll('.details-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const targetEl = document.getElementById(targetId);
        const icon = btn.querySelector('i');

        if (targetEl) {
          targetEl.classList.toggle('hidden');
          if (icon) {
            icon.className = targetEl.classList.contains('hidden')
              ? 'fas fa-chevron-down'
              : 'fas fa-chevron-up';
          }
        }
      });
    });

    // Przycisk PDF
    const pdfBtn = colEl.querySelector(`#downloadPdfBtn-${data.unikalny_klucz}`);
    if (pdfBtn) {
      pdfBtn.addEventListener("click", () => createPDF(colEl, data.nazwa_wlasciciela, data));
    }

    // Sprawdzenie dostępności skanów
    findProtocolImages(data.unikalny_klucz).then((imgArr) => {
      if (imgArr.length) {
        const origBtn = colEl.querySelector(`#showOriginalBtn-${data.unikalny_klucz}`);
        if (origBtn) {
          origBtn.classList.remove("hidden");
          origBtn.addEventListener("click", () => openModal(imgArr));
        }
      }
    });

    // Przycisk drzewa genealogicznego
    const treeBtn = colEl.querySelector(`#showTreeBtn-${data.unikalny_klucz}`);
    if (treeBtn) {
      console.log(`Znaleziono przycisk drzewa dla ${data.unikalny_klucz}`);

      treeBtn.addEventListener("click", () => {
        console.log(`Kliknięto przycisk drzewa dla ${data.unikalny_klucz}`);

        treeBtn.disabled = true;
        treeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ładowanie...';

        fetch(`/api/genealogia/${data.unikalny_klucz}`)
          .then((r) => {
            console.log(`Odpowiedź API dla ${data.unikalny_klucz}:`, r.status);
            if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
            return r.json();
          })
          .then((treeData) => {
            console.log(`Otrzymano dane drzewa dla ${data.unikalny_klucz}:`, treeData);
            drawGenealogyTree(treeData);
          })
          .catch((err) => {
            console.error(`Błąd ładowania drzewa dla ${data.unikalny_klucz}:`, err);

            // Komunikat o błędzie w dialogu
            const treeDialog = document.getElementById("treeDialog");
            const treeContainer = document.getElementById("treeContainer");

            if (treeDialog && treeContainer) {
              treeContainer.innerHTML = `
                <div style="padding: 2rem; text-align: center;">
                  <h3 style="color: red;">Błąd ładowania drzewa</h3>
                  <p>${err.message}</p>
                  <button onclick="document.getElementById('treeDialog').close()" 
                          style="margin-top: 1rem; padding: 0.5rem 1rem; 
                                background: #007bff; color: white; 
                                border: none; border-radius: 4px; cursor: pointer;">
                    Zamknij
                  </button>
                </div>
              `;
              treeDialog.showModal();
            } else {
              alert("Błąd ładowania drzewa: " + err.message);
            }
          })
          .finally(() => {
            treeBtn.disabled = false;
            treeBtn.innerHTML = '<i class="fas fa-project-diagram"></i> Drzewo genealogiczne';
          });
      });
    }

    // Jednorazowe podpięcie zamykania dialogu
    if (!closeTreeBtn.handlerAttached) {
      closeTreeBtn.addEventListener("click", () => {
        treeDialog.close();
        treeContainer.innerHTML = "";
      });
      closeTreeBtn.handlerAttached = true;
    }
  };

  /* ==========================================================================
     GŁÓWNA LOGIKA - POBIERANIE I WYŚWIETLANIE DANYCH
     ========================================================================== */

  // Wyświetlenie spinnera ładowania
  showLoadingSpinner();

  // Przygotowanie zapytań API
  const fetchPromises = ownerKeys.map((key) =>
    fetch(`/api/wlasciciel/${key}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Błąd pobierania danych dla ${key}: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.error) {
          throw new Error(data.error);
        }
        return data;
      })
      .catch((error) => {
        console.error(`Błąd dla klucza ${key}:`, error);
        throw error;
      })
  );

  // Pobieranie danych i budowanie interfejsu
  Promise.all(fetchPromises)
    .then(([data1, data2]) => {
      // Przywrócenie kontenera
      document.querySelector('.compare-container').innerHTML = `
        <div class="protocol-column" id="protocol-1"></div>
        <div class="protocol-column" id="protocol-2"></div>
      `;

      // Budowanie kolumn
      buildColumn(data1, 0);
      buildColumn(data2, 1);

      // Sprawdzenie dostępności działek
      const maDzialkiRzeczywiste =
        data1.dzialki_wszystkie?.some((p) => p.typ_posiadania === "własność rzeczywista") ||
        data2.dzialki_wszystkie?.some((p) => p.typ_posiadania === "własność rzeczywista");

      const maDzialkiProtokol =
        data1.dzialki_wszystkie?.some((p) => p.typ_posiadania !== "własność rzeczywista") ||
        data2.dzialki_wszystkie?.some((p) => p.typ_posiadania !== "własność rzeczywista");

      // Pokazanie odpowiednich przycisków nawigacji
      if (maDzialkiRzeczywiste && mapLinkReal) mapLinkReal.classList.remove("hidden");
      if (maDzialkiProtokol && mapLinkProtocol) mapLinkProtocol.classList.remove("hidden");
      if (maDzialkiRzeczywiste && maDzialkiProtokol && mapLinkBoth)
        mapLinkBoth.classList.remove("hidden");
    })
    .catch((error) => {
      console.error("Błąd podczas pobierania danych:", error);
      showError(`Nie udało się pobrać danych właścicieli. ${error.message}`);
    });
});