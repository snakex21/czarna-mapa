// =============================================================================
// GENEALOGIA.JS — Widok drzewa genealogicznego z wyszukiwarką
// 1770 osób, 135 małżeństw — dane z SQLite przez Tauri API
// =============================================================================

const GenealogiaView = {
    drzewo: null,       // { osoby: [], malzenstwa: [] }
    osobyMap: new Map(), // id -> osoba
    wybranaOsoba: null,

    async init() {
        const container = document.getElementById('genealogy-container');
        container.innerHTML = `
            <div id="genealogy-list-panel">
                <div class="search-bar" style="padding:12px;">
                    <input type="text" id="genealogy-search" placeholder="Szukaj osoby (imie, nazwisko, dom)...">
                </div>
                <div id="genealogy-results"></div>
            </div>
            <div id="genealogy-tree"></div>
            <div id="genealogy-detail" class="detail-panel"></div>`;

        document.getElementById('genealogy-search').addEventListener('input', (e) => {
            this.szukaj(e.target.value);
        });

        try {
            this.drzewo = await API.genealogia.pobierzDrzewo();
            this.osobyMap.clear();
            for (const o of this.drzewo.osoby) {
                this.osobyMap.set(o.id, o);
            }
            this.szukaj('');
        } catch (e) {
            document.getElementById('genealogy-results').innerHTML =
                `<p class="text-muted">Blad ladowania: ${e}</p>`;
        }
    },

    szukaj(query) {
        const results = document.getElementById('genealogy-results');
        const q = query.toLowerCase().trim();

        let osoby = this.drzewo.osoby;
        if (q) {
            osoby = osoby.filter(o =>
                o.imie_nazwisko.toLowerCase().includes(q) ||
                (o.numer_domu && o.numer_domu.includes(q)) ||
                (o.uwagi && o.uwagi.toLowerCase().includes(q))
            );
        }

        if (osoby.length === 0) {
            results.innerHTML = '<p class="text-muted" style="padding:20px;">Brak wynikow</p>';
            return;
        }

        // Ogranicz wyniki dla wydajności
        const limit = q ? osoby.slice(0, 100) : osoby.slice(0, 50);

        results.innerHTML = limit.map(o => `
            <div class="person-item" data-id="${o.id}">
                <span class="person-gender ${o.plec === 'K' ? 'female' : 'male'}">
                    ${o.plec === 'K' ? '&#9792;' : '&#9794;'}
                </span>
                <div class="person-info">
                    <strong>${o.imie_nazwisko}</strong>
                    <span class="person-meta">
                        ${o.rok_urodzenia ? `*${o.rok_urodzenia}` : ''}
                        ${o.rok_smierci ? ` †${o.rok_smierci}` : ''}
                        ${o.numer_domu ? ` · Dom ${o.numer_domu}` : ''}
                    </span>
                </div>
            </div>
        `).join('');

        results.querySelectorAll('.person-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                this.pokazOsobe(id);
            });
        });
    },

    pokazOsobe(id) {
        const osoba = this.osobyMap.get(id);
        if (!osoba) return;
        this.wybranaOsoba = osoba;

        // Panel szczegółów
        const detail = document.getElementById('genealogy-detail');
        const rodzicOjciec = osoba.id_ojca ? this.osobyMap.get(osoba.id_ojca) : null;
        const rodzicMatka = osoba.id_matki ? this.osobyMap.get(osoba.id_matki) : null;

        // Znajdź małżonków
        const malzonkowie = [];
        for (const m of this.drzewo.malzenstwa) {
            if (m.malzonek1_id === id) malzonkowie.push(this.osobyMap.get(m.malzonek2_id));
            if (m.malzonek2_id === id) malzonkowie.push(this.osobyMap.get(m.malzonek1_id));
        }

        // Znajdź dzieci
        const dzieci = this.drzewo.osoby.filter(o => o.id_ojca === id || o.id_matki === id);

        // Znajdź rodzeństwo
        const rodzenstwo = this.drzewo.osoby.filter(o =>
            o.id !== id &&
            ((osoba.id_ojca && o.id_ojca === osoba.id_ojca) ||
             (osoba.id_matki && o.id_matki === osoba.id_matki))
        );

        detail.innerHTML = `
            <h3>${osoba.imie_nazwisko}</h3>
            <div class="detail-grid">
                <div><strong>Plec:</strong> ${osoba.plec === 'M' ? 'Mezczyzna' : osoba.plec === 'K' ? 'Kobieta' : '?'}</div>
                ${osoba.rok_urodzenia ? `<div><strong>Ur.:</strong> ${osoba.rok_urodzenia}</div>` : ''}
                ${osoba.rok_smierci ? `<div><strong>Zm.:</strong> ${osoba.rok_smierci}</div>` : ''}
                ${osoba.numer_domu ? `<div><strong>Dom:</strong> ${osoba.numer_domu}</div>` : ''}
            </div>

            ${rodzicOjciec ? `<p><strong>Ojciec:</strong> <a href="#" onclick="GenealogiaView.pokazOsobe(${rodzicOjciec.id})">${rodzicOjciec.imie_nazwisko}</a></p>` : ''}
            ${rodzicMatka ? `<p><strong>Matka:</strong> <a href="#" onclick="GenealogiaView.pokazOsobe(${rodzicMatka.id})">${rodzicMatka.imie_nazwisko}</a></p>` : ''}

            ${malzonkowie.length > 0 ? `
                <h4>Malzonkowie (${malzonkowie.length})</h4>
                ${malzonkowie.filter(m => m).map(m => `
                    <a href="#" onclick="GenealogiaView.pokazOsobe(${m.id})" class="relation-link">${m.imie_nazwisko}</a>
                `).join(', ')}
            ` : ''}

            ${rodzenstwo.length > 0 ? `
                <h4>Rodzenstwo (${rodzenstwo.length})</h4>
                ${rodzenstwo.slice(0, 15).map(r => `
                    <a href="#" onclick="GenealogiaView.pokazOsobe(${r.id})" class="relation-link">${r.imie_nazwisko}</a>
                `).join(', ')}
                ${rodzenstwo.length > 15 ? `<span class="text-muted">... +${rodzenstwo.length - 15}</span>` : ''}
            ` : ''}

            ${dzieci.length > 0 ? `
                <h4>Dzieci (${dzieci.length})</h4>
                ${dzieci.map(d => `
                    <a href="#" onclick="GenealogiaView.pokazOsobe(${d.id})" class="relation-link">${d.imie_nazwisko}</a>
                `).join(', ')}
            ` : ''}

            ${osoba.uwagi ? `<p class="card-desc">${osoba.uwagi}</p>` : ''}
        `;

        // Rysuj drzewo
        const parents = [rodzicOjciec, rodzicMatka].filter(r => r);
        this.rysujDrzewo(osoba, parents, malzonkowie.filter(m => m), dzieci);
    },

    rysujDrzewo(osoba, rodzice, malzonkowie, dzieci) {
        const container = document.getElementById('genealogy-tree');
        container.innerHTML = '';

        const width = container.clientWidth || 600;
        const height = container.clientHeight || 500;

        if (width < 100) return;

        const svg = d3.select('#genealogy-tree')
            .append('svg')
            .attr('width', width)
            .attr('height', height);

        const g = svg.append('g').attr('transform', `translate(${width/2}, 60)`);

        // Proste drzewo: rodzice na gorze, osoba w centrum, dzieci na dole
        const nodes = [];
        const links = [];

        // Główna osoba
        nodes.push({ id: osoba.id, label: osoba.imie_nazwisko, plec: osoba.plec, x: 0, y: 0, type: 'self' });

        // Rodzice
        const validRodzice = rodzice.filter(r => r);
        validRodzice.forEach((r, i) => {
            const x = (i - (validRodzice.length-1)/2) * 120;
            nodes.push({ id: r.id, label: r.imie_nazwisko, plec: r.plec, x, y: -80, type: 'parent' });
            links.push({ source: r.id, target: osoba.id });
        });

        // Małżonkowie
        const validMalz = malzonkowie.filter(m => m);
        validMalz.forEach((m, i) => {
            const x = (i - (validMalz.length-1)/2) * 100 + 60;
            nodes.push({ id: m.id, label: m.imie_nazwisko, plec: m.plec, x, y: -10, type: 'spouse' });
            links.push({ source: m.id, target: osoba.id, type: 'spouse' });
        });

        // Dzieci
        const validDzieci = dzieci.filter(d => d).slice(0, 20); // max 20 dzieci
        validDzieci.forEach((d, i) => {
            const x = (i - (validDzieci.length-1)/2) * 70;
            nodes.push({ id: d.id, label: d.imie_nazwisko, plec: d.plec, x, y: 100, type: 'child' });
            links.push({ source: osoba.id, target: d.id });
        });

        // Rysuj łączniki
        g.selectAll('.tree-link')
            .data(links)
            .enter().append('line')
            .attr('class', 'tree-link')
            .attr('x1', d => nodes.find(n => n.id === d.source)?.x || 0)
            .attr('y1', d => nodes.find(n => n.id === d.source)?.y || 0)
            .attr('x2', d => nodes.find(n => n.id === d.target)?.x || 0)
            .attr('y2', d => nodes.find(n => n.id === d.target)?.y || 0)
            .attr('stroke', d => d.type === 'spouse' ? '#d4a853' : 'var(--border)')
            .attr('stroke-width', d => d.type === 'spouse' ? 2 : 1.5)
            .attr('stroke-dasharray', d => d.type === 'spouse' ? '5,3' : 'none');

        // Rysuj węzły
        const nodeGroups = g.selectAll('.tree-node')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'tree-node')
            .attr('transform', d => `translate(${d.x}, ${d.y})`)
            .on('click', (event, d) => this.pokazOsobe(d.id));

        nodeGroups.append('circle')
            .attr('r', d => d.type === 'self' ? 8 : 5)
            .attr('fill', d => {
                if (d.type === 'self') return '#d4a853';
                return d.plec === 'K' ? '#ff6b9d' : '#4facfe';
            })
            .attr('stroke', 'var(--bg-primary)')
            .attr('stroke-width', 2);

        nodeGroups.append('text')
            .attr('dy', -12)
            .attr('text-anchor', 'middle')
            .text(d => d.label.split(' ')[0]) // tylko imię
            .style('font-size', '10px')
            .style('fill', 'var(--text-primary)');
    },
};
