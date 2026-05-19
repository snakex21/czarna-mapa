/**
 * Plik: genealogia_admin.js
 * Opis: Moduł odpowiedzialny za generowanie i obsługę drzewa genealogicznego
 *        w panelu administracyjnym. Zawiera algorytmy pozycjonowania węzłów,
 *        rysowanie w SVG (D3), pozyskiwanie danych z API oraz obsługę modala.
 * Zależności runtime: D3 v7 oraz d3-flextree (ładowane dynamicznie z CDN).
 */
(function () {
  const NODE_HEIGHT = 80;
  const NODE_MIN_W = 120;
  const H_GAP = 80;
  const V_GAP = 120;
  const MARGIN = 80;
  const FONT = '700 16px "Segoe UI", sans-serif';
  const MARRIAGE_GAP = 20;

  let COLORS = [];
  let people = [];
  let rootId = null;

  // Funkcja ładowania bibliotek
  // === 1. USTAWIENIA RYSOWANIA I STAN MODUŁU ===
  // Stałe kontrolują wymiary układu, odstępy i styl tekstu; people/rootId przechowują aktualny stan drzewa.
  const loadScript = (src) =>
    new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`Nie można załadować ${src}`));
      document.head.appendChild(s);
    });

  async function ensureLibs() {
    if (!window.d3) await loadScript("https://cdn.jsdelivr.net/npm/d3@7");
    if (!d3.flextree)
      await loadScript("https://cdn.jsdelivr.net/npm/d3-flextree@2");
    if (!COLORS.length) COLORS = d3.schemeTableau10;
  }

  // Pobieranie danych z bazy przez API
  async function fetchGenealogyData(protocolKey) {
    try {
      const response = await fetch(`/api/genealogia/${protocolKey}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();

      // Konwersja danych z bazy do formatu używanego przez wizualizację
      if (data.persons && Array.isArray(data.persons)) {
        people = data.persons.map((person) => ({
          id: person.id,
          imie: person.name.split(" ")[0] || "",
          nazwisko: person.name.split(" ").slice(1).join(" ") || "",
          plec: person.gender,
          rok_urodzenia: person.birthDate?.year || null,
          rok_smierci: person.deathDate?.year || null,
          ojciec_id: person.fatherId,
          matka_id: person.motherId,
          malzonek_id: person.spouseIds?.[0] || null,
          unikalny_klucz: person.protocolKey,
          numer_domu: person.houseNumber,
          uwagi: person.notes,
        }));
        rootId = data.rootId;
        return true;
      } else {
        throw new Error("Nieprawidłowa struktura danych genealogicznych");
      }
    } catch (error) {
      console.error("Błąd pobierania danych genealogicznych:", error);
      throw error;
    }
  }

  function expandUnions(rawPeople) {
    const nodes = [];
    const unions = [];
    rawPeople.forEach((p) => {
      if (Array.isArray(p.malzenstwa) && p.malzenstwa.length) {
        p.malzenstwa.forEach((m, idx) => {
          const uid = `u_${p.id}_${m.spouseId}_${idx}`;
          unions.push({
            id: uid,
            type: "union",
            parents: [p.id, m.spouseId],
            children: m.children,
          });
        });
      }
      nodes.push(p);
    });
    return nodes.concat(unions);
  }

  function drawTree(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Nie znaleziono kontenera o ID: ${containerId}`);
      return;
    }

    if (!people.length) {
      container.innerHTML =
        '<div class="no-data"><h3>Brak danych genealogicznych do wyświetlenia</h3></div>';
      return;
    }

    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = FONT;
    const textWidth = (t) => ctx.measureText(t).width;

    people = expandUnions(people);

    // Przygotowanie mapy osób
    const personMap = new Map();
    people.forEach((p) => {
      const title = `${p.imie} ${p.nazwisko || ""}`.trim();
      const rec = {
        nodeId: String(p.id),
        name: title,
        birth: p.rok_urodzenia,
        death: p.rok_smierci,
        ojciec_id: p.ojciec_id ? String(p.ojciec_id) : null,
        matka_id: p.matka_id ? String(p.matka_id) : null,
        malzonek_id: p.malzonek_id ? String(p.malzonek_id) : null,
        key: p.unikalny_klucz,
        isRoot: p.id === rootId,
        boxW: Math.max(NODE_MIN_W, Math.ceil(textWidth(title)) + 30),
        generation: 0,
        positioned: false,
      };
      personMap.set(String(p.id), rec);
    });

    // Grupowanie po pokoleniach
    function groupByGenerations() {
      personMap.forEach((p) => (p.generation = null));
      const roots = Array.from(personMap.values()).filter(
        (p) => !p.ojciec_id && !p.matka_id,
      );
      const queue = roots.map((p) => ({ person: p, gen: 0 }));
      const visited = new Set(roots.map((p) => p.nodeId));

      while (queue.length > 0) {
        const { person, gen } = queue.shift();
        person.generation = gen;

        personMap.forEach((child) => {
          if (
            (child.ojciec_id === person.nodeId ||
              child.matka_id === person.nodeId) &&
            !visited.has(child.nodeId)
          ) {
            queue.push({ person: child, gen: gen + 1 });
            visited.add(child.nodeId);
          }
        });
      }

      personMap.forEach((p) => {
        if (p.generation === null) p.generation = 0;
      });

      let changedInLoop = true;
      while (changedInLoop) {
        changedInLoop = false;

        personMap.forEach((person) => {
          const father = person.ojciec_id
            ? personMap.get(person.ojciec_id)
            : null;
          const mother = person.matka_id
            ? personMap.get(person.matka_id)
            : null;

          if (father || mother) {
            const parentGens = [];
            if (father) parentGens.push(father.generation);
            if (mother) parentGens.push(mother.generation);

            const maxParentGen = Math.max(...parentGens);
            const expectedGen = maxParentGen + 1;

            if (person.generation < expectedGen) {
              person.generation = expectedGen;
              changedInLoop = true;
            }
          }

          const spouse = person.malzonek_id
            ? personMap.get(person.malzonek_id)
            : null;
          if (spouse) {
            const maxGen = Math.max(person.generation, spouse.generation);
            if (person.generation !== maxGen) {
              person.generation = maxGen;
              changedInLoop = true;
            }
            if (spouse.generation !== maxGen) {
              spouse.generation = maxGen;
              changedInLoop = true;
            }
          }
        });
      }

      const generations = new Map();
      personMap.forEach((p) => {
        const g = p.generation;
        if (!generations.has(g)) generations.set(g, []);
        generations.get(g).push(p);
      });

      return new Map([...generations.entries()].sort((a, b) => a[0] - b[0]));
    }

    function positionNodes() {
      const generations = groupByGenerations();
      const generationNodes = [];
      let currentY = MARGIN;
      const surname = (p) => (p.name.split(" ").pop() || "").toLowerCase();

      generations.forEach((persons, genLevel) => {
        persons.sort((a, b) => surname(a).localeCompare(surname(b)));
        const marriagesArr = [];
        const singles = [];
        const used = new Set();

        persons.forEach((person) => {
          if (used.has(person.nodeId)) return;

          if (person.malzonek_id && personMap.has(person.malzonek_id)) {
            const spouse = personMap.get(person.malzonek_id);
            if (spouse.generation === genLevel) {
              const left = surname(person) <= surname(spouse) ? person : spouse;
              const right = left === person ? spouse : person;
              marriagesArr.push([left, right]);
              used.add(left.nodeId);
              used.add(right.nodeId);
              return;
            }
          }

          singles.push(person);
          used.add(person.nodeId);
        });

        singles.sort((a, b) => surname(a).localeCompare(surname(b)));
        marriagesArr.sort((a, b) => surname(a[0]).localeCompare(surname(b[0])));

        let currentX = MARGIN;
        const genNodes = [];

        singles.forEach((person) => {
          person.x = currentX;
          person.y = currentY;
          genNodes.push(person);
          currentX += person.boxW + H_GAP;
        });

        marriagesArr.forEach(([left, right]) => {
          left.x = currentX;
          left.y = currentY;
          right.x = currentX + left.boxW + MARRIAGE_GAP;
          right.y = currentY;
          genNodes.push(left, right);
          currentX += left.boxW + MARRIAGE_GAP + right.boxW + H_GAP;
        });

        generationNodes.push(...genNodes);
        currentY += NODE_HEIGHT + V_GAP;
      });

      return generationNodes;
    }

    function findConnections(allNodes) {
      const connections = [];
      const marriages = [];
      const nodeById = new Map(allNodes.map((n) => [n.nodeId, n]));

      allNodes.forEach((person) => {
        const spouseId = person.malzonek_id;
        if (!spouseId) return;
        const spouse = nodeById.get(spouseId);
        if (!spouse) return;

        if (spouse.malzonek_id === person.nodeId && person.x < spouse.x) {
          marriages.push([person, spouse]);
        }
      });

      allNodes.forEach((child) => {
        const father = child.ojciec_id ? nodeById.get(child.ojciec_id) : null;
        const mother = child.matka_id ? nodeById.get(child.matka_id) : null;
        if (!father && !mother) return;

        let sourceX, sourceY;
        if (father && mother) {
          const left = father.x < mother.x ? father : mother;
          const right = left === father ? mother : father;
          sourceX = (left.x + left.boxW + right.x) / 2;
          sourceY = left.y + NODE_HEIGHT / 2;
        } else {
          const solo = father || mother;
          sourceX = solo.x + solo.boxW / 2;
          sourceY = solo.y + NODE_HEIGHT;
        }

        connections.push({
          type: "parent-child",
          source: { x: sourceX, y: sourceY },
          target: { x: child.x + child.boxW / 2, y: child.y },
          child,
        });
      });

      return { connections, marriages };
    }

    // Wykonanie algorytmu pozycjonowania
    const allNodes = positionNodes();
    const { connections, marriages } = findConnections(allNodes);

    // Oblicz wymiary SVG
    const xs = allNodes.map((n) => [n.x, n.x + n.boxW]).flat();
    const ys = allNodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const W = maxX - minX + 2 * MARGIN;
    const H = maxY - minY + NODE_HEIGHT + 2 * MARGIN;

    // Tworzenie SVG
    container.innerHTML = "";
    const svg = d3
      .create("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .call(
        d3
          .zoom()
          .scaleExtent([0.2, 4])
          .on("zoom", (e) => g.attr("transform", e.transform)),
      );

    const g = svg
      .append("g")
      .attr("transform", `translate(${-minX + MARGIN}, ${-minY + MARGIN})`);

    // Rysowanie połączeń rodzic-dziecko
    g.append("g")
      .selectAll("path")
      .data(connections.filter((c) => c.type === "parent-child"))
      .join("path")
      .attr("d", (d) => {
        const midY = (d.source.y + d.target.y) / 2;
        return `M${d.source.x},${d.source.y}V${midY}H${d.target.x}V${d.target.y}`;
      })
      .attr("stroke", "#999")
      .attr("stroke-width", 2)
      .attr("fill", "none");

    // Rysowanie linii małżeństw
    g.append("g")
      .selectAll("line")
      .data(marriages)
      .join("line")
      .attr("x1", ([left, right]) => left.x + left.boxW)
      .attr("y1", ([left, right]) => left.y + NODE_HEIGHT / 2)
      .attr("x2", ([left, right]) => right.x)
      .attr("y2", ([left, right]) => right.y + NODE_HEIGHT / 2)
      .attr("stroke", "#e74c3c")
      .attr("stroke-width", 3);

    // Funkcja kolorowania według pokoleń
    const generationColors = [
      "#3498db",
      "#e74c3c",
      "#2ecc71",
      "#f39c12",
      "#9b59b6",
      "#1abc9c",
    ];
    const getColor = (generation) =>
      generationColors[generation % generationColors.length];

    // Rysowanie węzłów
    const ng = g
      .append("g")
      .selectAll("g")
      .data(allNodes)
      .join("g")
      .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
      .on("dblclick", (_, d) => {
        rootId = parseInt(d.nodeId);
        drawTree(containerId);
      });

    // Prostokąty węzłów
    ng.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", (d) => d.boxW)
      .attr("height", NODE_HEIGHT)
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", "#fff")
      .attr("stroke", (d) => (d.isRoot ? "#e74c3c" : getColor(d.generation)))
      .attr("stroke-width", (d) => (d.isRoot ? 4 : 2));

    // Nazwiska
    ng.append("text")
      .attr("x", (d) => d.boxW / 2)
      .attr("y", NODE_HEIGHT / 2 - 8)
      .attr("text-anchor", "middle")
      .style("font", FONT)
      .text((d) => d.name);

    // Daty życia
    ng.append("text")
      .attr("x", (d) => d.boxW / 2)
      .attr("y", NODE_HEIGHT / 2 + 8)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("fill", "#666")
      .text((d) => {
        const b = d.birth,
          dd = d.death;
        return b && !dd
          ? `ur. ${b}`
          : dd && !b
            ? `† ${dd}`
            : b && dd
              ? `${b} – ${dd}`
              : "";
      });

    // Linki do protokołów
    ng.filter((d) => d.key && !d.isRoot)
      .append("a")
      .attr("href", (d) => `../wlasciciele/protokol.html?ownerId=${d.key}`)
      .append("text")
      .attr("x", (d) => d.boxW / 2)
      .attr("y", NODE_HEIGHT - 8)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("fill", "#007bff")
      .style("text-decoration", "underline")
      .style("cursor", "pointer")
      .text("📜 Protokół");

    container.appendChild(svg.node());
  }

  // Funkcja otwierająca modal z drzewem genealogicznym
  async function showGenealogyTree(protocolKey, personName) {
    try {
      // Sprawdź czy modal już istnieje, jeśli nie - utwórz go
      let modal = document.getElementById("genealogyModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "genealogyModal";
        modal.className = "modal";
        modal.innerHTML = `
                    <div class="modal-content" style="max-width: 95vw; max-height: 95vh;">
                        <div class="modal-header">
                            <h2>Drzewo genealogiczne - ${personName}</h2>
                            <button class="close" id="closeGenealogyModal">&times;</button>
                        </div>
                        <div id="genealogy-chart" style="width: 100%; height: 80vh; border: 1px solid #ddd; overflow: hidden;"></div>
                        <div class="modal-footer">
                            <p><small>Kliknij dwukrotnie na osobę, aby ustawić ją jako punkt centralny drzewa</small></p>
                        </div>
                    </div>
                `;
        document.body.appendChild(modal);

        // Obsługa zamykania modala (klik X, klik w tło, ESC) + blokada scrolla
        const closeBtn = document.getElementById("closeGenealogyModal");
        const closeModal = () => {
          modal.classList.remove("visible");
          document.body.classList.remove("no-scroll");
          if (modal._escHandler) {
            document.removeEventListener("keydown", modal._escHandler);
          }
        };
        const escHandler = (e) => {
          if (e.key === "Escape") closeModal();
        };
        modal._closeModal = closeModal;
        modal._escHandler = escHandler;

        closeBtn.addEventListener("click", closeModal);
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal();
        });
      }

      // Upewnij się, że handler ESC jest gotowy także dla już istniejącego modala
      if (!modal._closeModal || !modal._escHandler) {
        const closeModal = () => {
          modal.classList.remove("visible");
          document.body.classList.remove("no-scroll");
          if (modal._escHandler) {
            document.removeEventListener("keydown", modal._escHandler);
          }
        };
        const escHandler = (e) => {
          if (e.key === "Escape") closeModal();
        };
        modal._closeModal = closeModal;
        modal._escHandler = escHandler;
        const closeBtn2 = document.getElementById("closeGenealogyModal");
        if (closeBtn2 && !closeBtn2._bound) {
          closeBtn2.addEventListener("click", closeModal);
          closeBtn2._bound = true;
        }
        if (!modal._overlayBound) {
          modal.addEventListener("click", (e) => {
            if (e.target === modal) closeModal();
          });
          modal._overlayBound = true;
        }
      }

      // Pokaż modal i załaduj biblioteki
      modal.classList.add("visible");
      document.body.classList.add("no-scroll");
      if (modal._escHandler) {
        document.addEventListener("keydown", modal._escHandler);
      }
      // Fokus na przycisk zamknięcia lub kontener treści
      const focusClose = document.getElementById("closeGenealogyModal");
      const contentEl = modal.querySelector(".modal-content");
      if (focusClose) {
        setTimeout(() => focusClose.focus(), 0);
      } else if (contentEl) {
        contentEl.setAttribute("tabindex", "-1");
        setTimeout(() => contentEl.focus(), 0);
      }

      const chart = document.getElementById("genealogy-chart");
      chart.innerHTML =
        '<div style="text-align: center; padding: 50px;"><h3>Ładowanie danych genealogicznych...</h3></div>';

      await ensureLibs();
      await fetchGenealogyData(protocolKey);
      drawTree("genealogy-chart");
    } catch (error) {
      console.error("Błąd ładowania drzewa genealogicznego:", error);
      const chart = document.getElementById("genealogy-chart");
      if (chart) {
        chart.innerHTML = `<div style="text-align: center; padding: 50px; color: #e74c3c;">
                    <h3>Błąd ładowania danych</h3>
                    <p>${error.message}</p>
                </div>`;
      }
    }
  }

async function showClientTree(localPeople, familyTitle = "Rodzina", rootId = null) {
    try {
      // Sprawdź czy mamy ustawiony kontener
      const containerId = window.GenealogyAdmin.treeContainerId || 'genealogy-chart';
      const container = document.getElementById(containerId);
      
      if (!container) {
        console.error('Nie znaleziono kontenera dla drzewa');
        return;
      }
      
      container.innerHTML = '<div style="text-align:center;padding:50px;"><h3>Ładowanie…</h3></div>';
      
      await ensureLibs();
      
      // Konwersja formatu
      people = localPeople.map((p) => ({
        id: p.id,
        imie: p.imie || "",
        nazwisko: p.nazwisko || "",
        plec: p.plec,
        rok_urodzenia: p.rok_urodzenia,
        rok_smierci: p.rok_smierci,
        ojciec_id: p.ojciec_id,
        matka_id: p.matka_id,
        malzonek_id: p.malzonek_id,
        unikalny_klucz: p.unikalny_klucz,
        numer_domu: p.numer_domu,
        uwagi: p.uwagi,
      }));
      
      rootId = rootId || people[0]?.id || null;
      drawTree(containerId);
      
    } catch (err) {
      console.error('Błąd generowania drzewa:', err);
      const container = document.getElementById(window.GenealogyAdmin.treeContainerId || 'genealogy-chart');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 50px; color: #e74c3c;">
            <h3>Błąd ładowania drzewa</h3>
            <p>${err.message}</p>
          </div>
        `;
      }
    }
  }

  /* ---------- eksport ---------- */
  // Funkcja do ustawienia kontenera
  const setTreeContainer = (containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      // Zapamiętaj ID kontenera
      window.GenealogyAdmin.treeContainerId = containerId;
    }
  };
  
  window.GenealogyAdmin = {
    showGenealogyTree,
    showClientTree,
    ensureLibs,
    fetchGenealogyData,
    drawTree,
    setTreeContainer  // Dodaj tę funkcję
  };
})();


