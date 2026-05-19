document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let currentSection = 'dashboard';
    let allOwners = [];
    let allObjects = [];
    let allDemography = [];
    let allGenealogy = [];
    let allProtocols = [];
    let showPersonDetails = null; // Zmienna globalna w ramach modułu

    const API = {
        login: '/api/admin/login',
        logout: '/api/admin/logout',
        stats: '/api/admin/dashboard-stats',
        owners: '/api/admin/wlasciciele',
        objects: '/api/admin/obiekty',
        allObjects: '/api/admin/wszystkie-obiekty',
        demography: '/api/admin/demografia',
        genealogy: '/api/admin/genealogia',
        protocols: '/api/admin/protocols',
        backup: '/api/admin/export-backup',
        authStatus: '/api/admin/auth-status'
    };

    const elements = {
        loginScreen: document.getElementById('loginScreen'),
        adminPanel: document.getElementById('adminPanel'),
        loginForm: document.getElementById('loginForm'),
        loginError: document.getElementById('loginError'),
        sidebar: document.querySelector('.sidebar'),
        sidebarToggle: document.querySelector('.sidebar-toggle'),
        menuItems: document.querySelectorAll('.menu-item'),
        sections: document.querySelectorAll('.section'),
        currentSection: document.getElementById('currentSection'),
        currentDate: document.getElementById('currentDate'),
        currentTime: document.getElementById('currentTime'),
        themeToggle: document.getElementById('themeToggle'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalTitle: document.getElementById('modalTitle'),
        modalBody: document.getElementById('modalBody'),
        modalSave: document.getElementById('modalSave'),
        modalCancel: document.getElementById('modalCancel'),
        modalClose: document.getElementById('modalClose'),
        toastContainer: document.getElementById('toastContainer'),
        logoutBtn: document.getElementById('logoutBtn')
    };

    const init = () => {
        setupEventListeners();
        updateDateTime();
        setInterval(updateDateTime, 1000); // 1000ms = 1 sekunda
        checkAuth();
    };

    // Funkcja normalizująca nazwiska (tylko do grupowania w tabeli)
    const canonicalSurname = (raw) => {
        if (!raw) return "";
        let last = raw.trim().split(/\s+/).pop().toLowerCase();
        if (last.endsWith("ska")) last = last.slice(0, -3) + "ski";
        else if (last.endsWith("cka")) last = last.slice(0, -3) + "cki";
        else if (last.endsWith("dzka")) last = last.slice(0, -4) + "dzki";
        else if (last.endsWith("owa")) last = last.slice(0, -3);
        else if (last.endsWith("a") && last.length > 4) last = last.slice(0, -1);
        return last.charAt(0).toUpperCase() + last.slice(1);
    };

    const checkAuth = async () => {
        try {
            // Zapytaj serwer, czy autoryzacja jest w ogóle włączona
            const response = await fetch(API.authStatus);
            if (!response.ok) throw new Error('Nie można sprawdzić statusu autoryzacji.');

            const authConfig = await response.json();

            if (!authConfig.enabled) {
                // Autoryzacja jest WYŁĄCZONA
                elements.logoutBtn.classList.add('hidden'); // Ukryj przycisk wylogowania
                showAdminPanel();
                return; // Zakończ dalsze sprawdzanie
            }

            // Autoryzacja jest WŁĄCZONA
            elements.logoutBtn.classList.remove('hidden'); // Upewnij się, że przycisk jest widoczny
            const isLoggedIn = localStorage.getItem('adminLoggedIn') === 'true';
            if (isLoggedIn) {
                showAdminPanel();
            } else {
                showLoginScreen();
            }

        } catch (error) {
            // W przypadku błędu sieci, bezpieczniej jest pokazać ekran logowania
            console.error('Błąd podczas sprawdzania autoryzacji:', error);
            elements.logoutBtn.classList.add('hidden'); // Ukryj przycisk również w razie błędu
            showLoginScreen();
            elements.loginError.textContent = 'Błąd połączenia z serwerem. Spróbuj odświeżyć stronę.';
            elements.loginError.classList.remove('hidden');
        }
    };

    const showLoginScreen = () => {
        elements.loginScreen.classList.remove('hidden');
        elements.adminPanel.classList.add('hidden');
    };

    const showAdminPanel = () => {
        elements.loginScreen.classList.add('hidden');
        elements.adminPanel.classList.remove('hidden');
        loadDashboardData();
    };

    const setupEventListeners = () => {
        elements.loginForm.addEventListener('submit', handleLogin);
        const treeModalClose = document.getElementById('treeModalClose');
        if (treeModalClose) {
            treeModalClose.addEventListener('click', () => {
                const modal = document.getElementById('treeModal');
                if (modal) {
                    modal.classList.add('hidden');
                    document.body.classList.remove('modal-open');
                    document.getElementById('treeContainer').innerHTML = '';
                }
            });
        }
        elements.sidebarToggle.addEventListener('click', () => {
            elements.sidebar.classList.toggle('collapsed');
        });

        elements.menuItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.dataset.section;
                if (section) {
                    switchSection(section);
                } else if (item.id === 'backupBtn') {
                    downloadBackup();
                } else if (item.id === 'logoutBtn') {
                    handleLogout();
                }
            });
        });

        elements.themeToggle.addEventListener('click', toggleTheme);

        elements.modalClose.addEventListener('click', closeModal);
        elements.modalCancel.addEventListener('click', closeModal);
        elements.modalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.modalOverlay) closeModal();
        });

        document.getElementById('addOwnerBtn')?.addEventListener('click', () => openOwnerModal());
        document.getElementById('searchOwners')?.addEventListener('input', (e) => filterOwners(e.target.value));

        document.getElementById('searchObjects')?.addEventListener('input', (e) => filterObjects(e.target.value));

        document.getElementById('addDemographyBtn')?.addEventListener('click', () => openDemographyModal());

        document.getElementById('addGenealogyBtn')?.addEventListener('click', () => openGenealogyModal());
        document.getElementById('searchGenealogy')?.addEventListener('input', (e) => filterGenealogy());
        document.getElementById('filterHouse')?.addEventListener('input', (e) => filterGenealogy());
        document.getElementById('sortFilter')?.addEventListener('change', (e) => filterGenealogy());

        // Filtry płci w genealogii
        document.querySelectorAll('.genealogy-filters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.genealogy-filters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterGenealogy();
            });
        });

        document.querySelectorAll('.action-card').forEach(card => {
            card.addEventListener('click', () => {
                const action = card.dataset.action;
                handleQuickAction(action);
            });
        });
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        const login = document.getElementById('login').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(API.login, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: login, password })
            });

            const data = await response.json();

            if (data.status === 'ok') {
                localStorage.setItem('adminLoggedIn', 'true');
                currentUser = login;
                showAdminPanel();
                showToast('success', 'Zalogowano pomyślnie');
            } else {
                elements.loginError.textContent = data.message || 'Błędne dane logowania';
                elements.loginError.classList.remove('hidden');
            }
        } catch (error) {
            elements.loginError.textContent = 'Błąd połączenia z serwerem';
            elements.loginError.classList.remove('hidden');
        }
    };

    const handleLogout = async () => {
        if (confirm('Czy na pewno chcesz się wylogować?')) {
            try {
                await fetch(API.logout, { method: 'POST' });
            } catch (error) {
                console.error('Błąd wylogowania:', error);
            }

            localStorage.removeItem('adminLoggedIn');
            currentUser = null;
            showLoginScreen();
            showToast('info', 'Wylogowano z systemu');
        }
    };

    const switchSection = (section) => {
        elements.sections.forEach(s => s.classList.remove('active'));
        elements.menuItems.forEach(m => m.classList.remove('active'));

        document.getElementById(section)?.classList.add('active');
        document.querySelector(`[data-section="${section}"]`)?.classList.add('active');

        currentSection = section;
        elements.currentSection.textContent = getSectionName(section);

        loadSectionData(section);
    };

    const getSectionName = (section) => {
        const names = {
            dashboard: 'Pulpit',
            owners: 'Właściciele',
            objects: 'Obiekty',
            demography: 'Demografia',
            genealogy: 'Genealogia'
        };
        return names[section] || section;
    };

    const loadSectionData = async (section) => {
        switch (section) {
            case 'dashboard':
                loadDashboardData();
                break;
            case 'owners':
                loadOwners();
                break;
            case 'objects':
                loadObjects();
                break;
            case 'demography':
                loadDemography();
                break;
            case 'genealogy':
                loadGenealogy();
                break;
        }
    };

    const loadDashboardData = async () => {
        try {
            const response = await fetch(API.stats);
            const data = await response.json();

            document.getElementById('statOwners').textContent = data.total_owners || 0;
            document.getElementById('statObjects').textContent = data.total_objects || 0;

            const genealogyResponse = await fetch(API.genealogy);
            const genealogyData = await genealogyResponse.json();
            document.getElementById('statGenealogy').textContent = genealogyData.length || 0;

            const demographyResponse = await fetch(API.demography);
            const demographyData = await demographyResponse.json();
            document.getElementById('statDemography').textContent = demographyData.length || 0;
        } catch (error) {
            console.error('Błąd ładowania statystyk:', error);
        }
    };

    const loadOwners = async () => {
        try {
            const response = await fetch(API.owners);
            allOwners = await response.json();
            renderOwners(allOwners);
        } catch (error) {
            console.error('Błąd ładowania właścicieli:', error);
            showToast('error', 'Nie udało się załadować właścicieli');
        }
    };

    const renderOwners = (owners) => {
        const container = document.getElementById('ownersList');
        container.innerHTML = '';

        owners.forEach(owner => {
            const card = document.createElement('div');
            card.className = 'owner-card';
            card.innerHTML = `
                <div class="owner-card-header">
                    <div class="owner-name">${owner.nazwa_wlasciciela}</div>
                    <div class="owner-protocol">Lp. ${owner.numer_protokolu || 'N/A'}</div>
                </div>
                <div class="owner-details">
                    <div>Dom: ${owner.numer_domu || '-'}</div>
                    <div>Klucz: ${owner.unikalny_klucz}</div>
                </div>
                <div class="owner-actions">
                    <button class="edit-btn" onclick="editOwner(${owner.id})">
                        <i class="fas fa-edit"></i> Edytuj
                    </button>
                    <button class="delete-btn" onclick="deleteOwner(${owner.id})">
                        <i class="fas fa-trash"></i> Usuń
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    };

    const filterOwners = (searchTerm) => {
        const filtered = allOwners.filter(owner =>
            owner.nazwa_wlasciciela.toLowerCase().includes(searchTerm.toLowerCase()) ||
            owner.unikalny_klucz.toLowerCase().includes(searchTerm.toLowerCase())
        );
        renderOwners(filtered);
    };

    const loadObjects = async () => {
        try {
            const response = await fetch(API.objects);
            allObjects = await response.json();
            renderObjects(allObjects);
        } catch (error) {
            console.error('Błąd ładowania obiektów:', error);
            showToast('error', 'Nie udało się załadować obiektów');
        }
    };

    const renderObjects = (objects) => {
        const tbody = document.getElementById('objectsTableBody');
        tbody.innerHTML = '';

        objects.forEach(obj => {
            const row = document.createElement('tr');
            row.dataset.id = obj.id; // Przechowujemy ID obiektu w atrybucie data

            row.innerHTML = `
                <td data-field="nazwa_lub_numer">${obj.nazwa_lub_numer}</td>
                <td data-field="kategoria">${obj.kategoria}</td>
                <td>${obj.is_linked ? '<span style="color: var(--success-color);">Przypisany</span>' : '<span style="color: var(--text-secondary);">Wolny</span>'}</td>
                <td class="actions">
                    <button class="btn-warning edit-btn"><i class="fas fa-edit"></i> Edytuj</button>
                    <button class="btn-danger delete-btn"><i class="fas fa-trash"></i> Usuń</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Delegacja zdarzeń dla całej tabeli
        tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => editObject(btn.closest('tr'))));
        tbody.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteObject(btn.closest('tr'))));
    };

    const filterObjects = (searchTerm) => {
        const filtered = allObjects.filter(obj =>
            obj.nazwa_lub_numer.toLowerCase().includes(searchTerm.toLowerCase()) ||
            obj.kategoria.toLowerCase().includes(searchTerm.toLowerCase())
        );
        renderObjects(filtered);
    };

    const loadDemography = async () => {
        try {
            const response = await fetch(API.demography);
            allDemography = await response.json();
            renderDemography(allDemography);
        } catch (error) {
            console.error('Błąd ładowania demografii:', error);
            showToast('error', 'Nie udało się załadować danych demograficznych');
        }
    };

    const renderDemography = (data) => {
        const tbody = document.getElementById('demographyTableBody');
        tbody.innerHTML = '';

        data.forEach(entry => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="number" value="${entry.rok}" data-field="rok"></td>
                <td><input type="number" value="${entry.populacja_ogolem || ''}" data-field="populacja_ogolem"></td>
                <td><input type="number" value="${entry.katolicy || ''}" data-field="katolicy"></td>
                <td><input type="number" value="${entry.zydzi || ''}" data-field="zydzi"></td>
                <td><input type="number" value="${entry.inni || ''}" data-field="inni"></td>
                <td><textarea data-field="opis">${entry.opis || ''}</textarea></td>
                <td class="actions">
                    <button class="btn-success" onclick="saveDemography(${entry.id})">Zapisz</button>
                    <button class="delete-btn" onclick="deleteDemography(${entry.id})">Usuń</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    };

    const loadGenealogy = async () => {
        try {
            // Równoległe pobieranie danych i protokołów
            const [genealogyResponse, protocolsResponse] = await Promise.all([
                fetch(`/api/admin/genealogia?t=${Date.now()}`),
                fetch(API.protocols)
            ]);

            if (!genealogyResponse.ok) throw new Error('Błąd pobierania danych genealogicznych');

            const data = await genealogyResponse.json();
            allGenealogy = data;

            if (protocolsResponse.ok) {
                allProtocols = await protocolsResponse.json();
            } else {
                console.warn('Nie udało się pobrać protokołów');
            }

            // Zastosuj domyślne filtry i sortowanie
            filterGenealogy();
        } catch (error) {
            console.error('Błąd:', error);
            showNotification('Nie udało się pobrać danych genealogicznych', 'error');
        }
    };

    const renderGenealogy = (data) => {
        const listContainer = document.getElementById('personsListContainer');
        const detailsPanel = document.getElementById('personDetailsPanel');
        const countEl = document.getElementById('genPersonCount');

        // Wyczyść
        listContainer.innerHTML = '';

        // Mapy pomocnicze
        // Map 1: JSON_ID -> Person (podstawowa)
        const peopleMap = new Map(allGenealogy.map(p => [String(p.id_osoby), p]));
        // Map 2: DB_ID -> Person (pomocnicza, gdyby API zwracało DB_ID w relacjach)
        const dbIdMap = new Map(allGenealogy.map(p => [p.db_id, p]));

        // Funkcja Lookup - szuka osoby po ID (sprawdza JSON_ID, a potem DB_ID)
        const getPersonById = (id) => {
            if (!id) return null;
            const idStr = String(id);
            // Najpierw szukaj po json_id (np. "1845")
            if (peopleMap.has(idStr)) return peopleMap.get(idStr);
            // Jak nie znajdzie, szukaj po db_id (np. 15), jeśli id jest liczbą
            return dbIdMap.get(id) || dbIdMap.get(parseInt(id));
        };

        // Buduj mapę dzieci (kto jest dzieckiem kogo)
        const childrenMap = new Map();
        allGenealogy.forEach(p => {
            if (p.id_ojca) {
                const father = getPersonById(p.id_ojca);
                if (father) {
                    const fatherId = String(father.id_osoby);
                    if (!childrenMap.has(fatherId)) childrenMap.set(fatherId, []);
                    childrenMap.get(fatherId).push(String(p.id_osoby));
                }
            }
            if (p.id_matki) {
                const mother = getPersonById(p.id_matki);
                if (mother) {
                    const motherId = String(mother.id_osoby);
                    if (!childrenMap.has(motherId)) childrenMap.set(motherId, []);
                    childrenMap.get(motherId).push(String(p.id_osoby));
                }
            }
        });

        // Aktualizuj licznik
        countEl.textContent = data.length;

        // Dane są już posortowane w filterGenealogy
        const sortedData = data;

        // Funkcja do formatowania dat życia
        const formatLifespan = (person) => {
            if (!person) return '? - ?';
            if (!person.rok_urodzenia && !person.rok_smierci) return '? - ?';
            const birth = person.rok_urodzenia || '?';
            const death = person.rok_smierci || '?';
            return `${birth} - ${death}`;
        };

        // Funkcja pomocnicza - znajdź dziadków
        const findGrandparents = (person, side) => {
            const parentId = side === 'father' ? person.id_ojca : person.id_matki;
            const parent = getPersonById(parentId);

            if (!parent) return [];

            const grandparents = [];
            if (parent.id_ojca) {
                const gf = getPersonById(parent.id_ojca);
                if (gf) grandparents.push({ ...gf, role: 'Dziadek' });
            }
            if (parent.id_matki) {
                const gm = getPersonById(parent.id_matki);
                if (gm) grandparents.push({ ...gm, role: 'Babcia' });
            }
            return grandparents;
        };

        // Funkcja pomocnicza - znajdź rodziców
        const findParents = (person) => {
            const parents = [];
            if (person.id_ojca) {
                const father = getPersonById(person.id_ojca);
                if (father) parents.push({ ...father, role: 'Ojciec' });
            }
            if (person.id_matki) {
                const mother = getPersonById(person.id_matki);
                if (mother) parents.push({ ...mother, role: 'Matka' });
            }
            return parents;
        };

        // Funkcja pomocnicza - znajdź małżonków (Robust)
        const findSpouses = (person) => {
            const spousesIds = new Set();

            // 1. Sprawdź tablicę marriages (jeśli dostępna z nowego API)
            if (person.marriages && Array.isArray(person.marriages)) {
                person.marriages.forEach(m => {
                    if (m.spouseId) spousesIds.add(String(m.spouseId));
                    // Fallback dla starego formatu w marriages
                    if (m.spouseDbId) {
                        const spouse = getPersonById(m.spouseDbId);
                        if (spouse) spousesIds.add(String(spouse.id_osoby));
                    }
                });
            }

            // 2. Fallback: id_malzonka
            if (person.id_malzonka) {
                const s = getPersonById(person.id_malzonka);
                if (s) spousesIds.add(String(s.id_osoby));
            }

            // 3. Fallback: szukanie w drugą stronę (reverse lookup)
            const personIdStr = String(person.id_osoby);
            const personDbId = person.db_id;

            allGenealogy.forEach(p => {
                // Sprawdź czy p wskazuje na nas jako małżonka
                let match = false;
                if (String(p.id_malzonka) === personIdStr) match = true;
                if (personDbId && p.id_malzonka == personDbId) match = true;

                if (p.marriages) {
                    p.marriages.forEach(m => {
                        if (String(m.spouseId) === personIdStr) match = true;
                        if (personDbId && m.spouseDbId == personDbId) match = true;
                    });
                }

                if (match) spousesIds.add(String(p.id_osoby));
            });

            return Array.from(spousesIds).map(id => {
                const s = peopleMap.get(id); // ID w secie to zawsze JSON_ID
                return s ? { ...s, role: 'Małżonek' } : null;
            }).filter(s => s);
        };

        // Funkcja pomocnicza - znajdź rodzeństwo (Robust)
        const findSiblings = (person) => {
            const siblingsSet = new Set();
            const personIdStr = String(person.id_osoby);

            // Rodzeństwo od strony ojca
            if (person.id_ojca) {
                const father = getPersonById(person.id_ojca);
                if (father) {
                    const fatherId = String(father.id_osoby);
                    const children = childrenMap.get(fatherId) || [];
                    children.forEach(id => {
                        if (id !== personIdStr) siblingsSet.add(id);
                    });
                }
            }

            // Rodzeństwo od strony matki
            if (person.id_matki) {
                const mother = getPersonById(person.id_matki);
                if (mother) {
                    const motherId = String(mother.id_osoby);
                    const children = childrenMap.get(motherId) || [];
                    children.forEach(id => {
                        if (id !== personIdStr) siblingsSet.add(id);
                    });
                }
            }

            return Array.from(siblingsSet).map(id => {
                const sibling = peopleMap.get(id);
                if (sibling) return { ...sibling, role: 'Rodzeństwo' };
                return null;
            }).filter(s => s);
        };

        // Funkcja pomocnicza - znajdź dzieci (Robust - używa childrenMap)
        const findChildren = (personId) => {
            // personId to JSON_ID (ale dla pewności resolwujemy)
            const person = getPersonById(personId);
            if (!person) return [];

            const pId = String(person.id_osoby);
            const childrenIds = childrenMap.get(pId) || [];

            return childrenIds.map(id => {
                const child = peopleMap.get(id);
                return child ? { ...child, role: 'Dziecko' } : null;
            }).filter(c => c)
                .sort((a, b) => (a.rok_urodzenia || 9999) - (b.rok_urodzenia || 9999));
        };

        // Funkcja pomocnicza - znajdź kuzynostwo (Robust)
        const findCousins = (person) => {
            const cousinsSet = new Set();
            const parents = findParents(person);

            parents.forEach(parent => {
                const parentSiblings = findSiblings(parent);
                parentSiblings.forEach(uncleAunt => {
                    const uncleAuntChildren = findChildren(uncleAunt.id_osoby);
                    uncleAuntChildren.forEach(cousin => {
                        cousinsSet.add(String(cousin.id_osoby));
                    });
                });
            });

            return Array.from(cousinsSet).map(id => {
                const cousin = getPersonById(id); // getPersonById dla bezpieczeństwa
                if (cousin) {
                    const role = cousin.plec === 'M' ? 'Kuzyn' : (cousin.plec === 'F' ? 'Kuzynka' : 'Kuzynostwo');
                    return { ...cousin, role: role };
                }
                return null;
            }).filter(c => c);
        };


        // Funkcja BFS do zbierania całej sieci rodzinnej (przodkowie, potomkowie, kuzyni)
        const collectFamilyNetwork = (startPerson) => {
            const visitedIds = new Set();
            const results = [];
            // depth 0 = startPerson
            const queue = [{ person: startPerson, depth: 0 }];
            const MAX_DEPTH = 4; // Sięgamy głęboko: Ja -> Rodzic -> Dziadek -> Pradziadek ORAZ Ja -> Rodzic -> Rodzeństwo -> Kuzyn

            visitedIds.add(String(startPerson.id_osoby));
            results.push(startPerson);

            let head = 0;
            while (head < queue.length) {
                const { person: p, depth } = queue[head++];
                if (depth >= MAX_DEPTH) continue;

                const pId = String(p.id_osoby);
                const relativesIds = new Set();

                // 1. Rodzice (w górę)
                if (p.id_ojca) relativesIds.add(String(p.id_ojca));
                if (p.id_matki) relativesIds.add(String(p.id_matki));

                // 2. Dzieci (w dół)
                const children = childrenMap.get(pId) || [];
                children.forEach(id => relativesIds.add(id));

                // 3. Małżonkowie (poziomo)
                const spouses = findSpouses(p);
                spouses.forEach(s => relativesIds.add(String(s.id_osoby)));

                // 4. Rodzeństwo (poziomo - jeśli nie znalezione przez rodziców)
                if (p.id_ojca) {
                    const fatherChildren = childrenMap.get(String(p.id_ojca)) || [];
                    fatherChildren.forEach(id => relativesIds.add(id));
                }
                if (p.id_matki) {
                    const motherChildren = childrenMap.get(String(p.id_matki)) || [];
                    motherChildren.forEach(id => relativesIds.add(id));
                }

                // Przetwarzanie znalezionych krewnych
                relativesIds.forEach(rId => {
                    if (!visitedIds.has(rId)) {
                        const r = peopleMap.get(rId);
                        if (r) {
                            visitedIds.add(rId);
                            results.push(r);
                            queue.push({ person: r, depth: depth + 1 });
                        }
                    }
                });
            }
            return results;
        };

        // Funkcja do tworzenia karty relacji
        const createRelationCard = (person, role) => {
            if (!person || !person.id_osoby) {
                return `
                <div class="relation-card unknown">
                    <div class="relation-role">${role || '?'}</div>
                    <div class="relation-name">?</div>
                    <div class="relation-dates">? - ?</div>
                </div>
            `;
            }

            const genderClass = person.plec === 'M' ? 'male' : (person.plec === 'F' ? 'female' : '');

            return `
            <div class="relation-card ${genderClass}" data-person-id="${person.id_osoby}">
                <div class="relation-role">${role || person.role || ''}</div>
                <div class="relation-name">${person.imie} ${person.nazwisko || ''}</div>
                <div class="relation-dates">${formatLifespan(person)}</div>
            </div>
        `;
        };

        // Funkcja do renderowania sekcji relacji
        const renderRelationSection = (title, relations) => {
            if (!relations || relations.length === 0) return '';
            return `
            <div class="section-title"><i class="fas fa-users"></i> ${title}</div>
            <div class="relations-grid">
                ${relations.map(r => createRelationCard(r, r.role)).join('')}
            </div>
        `;
        };

        // Funkcja do wyświetlania szczegółów osoby
        showPersonDetails = (person) => {
            // Oznacz aktywną osobę na liście
            document.querySelectorAll('.person-list-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`.person-list-item[data-person-id="${person.id_osoby}"]`)?.classList.add('active');

            // Pobierz dane rodzinne
            const grandparentsFather = findGrandparents(person, 'father');
            const grandparentsMother = findGrandparents(person, 'mother');
            const parents = findParents(person);
            const spouses = findSpouses(person);
            const siblings = findSiblings(person);
            const children = findChildren(person.id_osoby);
            const cousins = findCousins(person);

            const genderText = person.plec === 'M' ? 'Mężczyzna' : (person.plec === 'F' ? 'Kobieta' : '?');

            // Dom - ? jeśli brak
            const houseDisplay = person.numer_domu ? `Dom ${person.numer_domu}` : 'Dom ?';

            // Budowanie HTML
            let html = `
            <!-- Nagłówek profilu -->
            <div class="profile-header">
                <div class="profile-title">
                    <h1>${person.imie} ${person.nazwisko || ''}</h1>
                    <div class="profile-id">ID: ${person.id_osoby} • ${genderText} • ${formatLifespan(person)}</div>
                </div>
                <div class="profile-actions">
                    <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">${houseDisplay}</div>
                    ${person.protokol_klucz ? `
                        <a href="../wlasciciele/protokol.html?ownerId=${person.protokol_klucz}" class="btn btn-secondary">
                            <i class="fas fa-file-alt"></i> Protokół
                        </a>
                    ` : ''}
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary tree-btn" data-person-id="${person.id_osoby}">
                            <i class="fas fa-sitemap"></i> Drzewo
                        </button>
                        <button class="btn btn-secondary edit-btn" data-db-id="${person.db_id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-danger delete-btn" data-db-id="${person.db_id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

            // Uwagi/Notatki osoby
            if (person.uwagi) {
                html += `
                <div class="section-title"><i class="fas fa-sticky-note"></i> Notatki</div>
                <p style="margin-bottom: 1.5rem; color: var(--text-secondary); line-height: 1.8; font-size: 0.95rem; background: var(--bg-card); padding: 1rem; border-radius: 8px; border-left: 4px solid var(--primary-color);">${person.uwagi}</p>
            `;
            }

            // Sekcja Rodziny
            html += `<div class="section-title" style="font-size: 1rem;"><i class="fas fa-users"></i> RODZINA</div>`;

            // Dziadkowie
            if (grandparentsFather.length > 0 || grandparentsMother.length > 0) {
                html += `<div class="section-title">Dziadkowie</div>`;

                if (grandparentsFather.length > 0) {
                    html += `
                    <div class="section-subtitle">od strony ojca:</div>
                    <div class="relations-grid">
                        ${grandparentsFather.map(g => createRelationCard(g, g.role)).join('')}
                    </div>
                `;
                }

                if (grandparentsMother.length > 0) {
                    html += `
                    <div class="section-subtitle">od strony matki:</div>
                    <div class="relations-grid">
                        ${grandparentsMother.map(g => createRelationCard(g, g.role)).join('')}
                    </div>
                `;
                }
            }

            // Rodzice
            html += renderRelationSection('Rodzice', parents);

            // Małżonkowie
            html += renderRelationSection('Małżonkowie', spouses);

            // Rodzeństwo
            html += renderRelationSection('Rodzeństwo', siblings);

            // Dzieci
            html += renderRelationSection('Dzieci', children);

            // Kuzynostwo
            html += renderRelationSection('Kuzynostwo', cousins);

            // Jeśli brak rodziny
            if (parents.length === 0 && spouses.length === 0 && siblings.length === 0 &&
                children.length === 0 && cousins.length === 0 &&
                grandparentsFather.length === 0 && grandparentsMother.length === 0) {
                html += `
                <p style="color: var(--text-light); font-style: italic; padding: 1rem;">
                    Brak powiązań rodzinnych w bazie danych.
                </p>
            `;
            }

            detailsPanel.innerHTML = html;

            // Event listenery dla kart relacji
            detailsPanel.querySelectorAll('.relation-card[data-person-id]').forEach(card => {
                card.addEventListener('click', () => {
                    const personId = card.dataset.personId;
                    const targetPerson = peopleMap.get(String(personId));
                    if (targetPerson) {
                        showPersonDetails(targetPerson);
                        const listItem = document.querySelector(`.person-list-item[data-person-id="${personId}"]`);
                        if (listItem) listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            });

            // Event listenery dla akcji
            detailsPanel.querySelector('.edit-btn')?.addEventListener('click', () => editGenealogy(person.db_id));
            detailsPanel.querySelector('.delete-btn')?.addEventListener('click', () => deleteGenealogy(person.db_id));

            // TREE BUTTON - Wywołanie mini-drzewa
            detailsPanel.querySelector('.tree-btn')?.addEventListener('click', () => {
                console.log('Generowanie mini-drzewa dla:', person.imie, person.nazwisko);
                showMiniTree(person);
            });
        };

        // Renderuj listę osób
        if (sortedData.length === 0) {
            listContainer.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #64748b;">
                <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 1rem; display: block;"></i>
                Nie znaleziono osób
            </div>
        `;
            return;
        }

        sortedData.forEach(person => {
            const genderClass = person.plec === 'M' ? 'male' : (person.plec === 'F' ? 'female' : '');
            const genderIcon = person.plec === 'M' ? 'fa-mars' : (person.plec === 'F' ? 'fa-venus' : 'fa-genderless');

            const item = document.createElement('div');
            item.className = `person-list-item ${genderClass}`;
            item.dataset.personId = person.id_osoby;
            item.innerHTML = `
            <div class="person-list-icon">
                <i class="fas ${genderIcon}"></i>
            </div>
            <div class="person-list-info">
                <div class="person-list-name">${person.imie} ${person.nazwisko || ''}</div>
                <div class="person-list-dates">
                    <i class="fas fa-calendar"></i> ${formatLifespan(person)}
                </div>
            </div>
            <div class="person-list-arrow">
                <i class="fas fa-chevron-right"></i>
            </div>
        `;

            item.addEventListener('click', () => showPersonDetails(person));
            listContainer.appendChild(item);
        });

        // Domyślnie pokaż pierwszą osobę
        if (sortedData.length > 0) {
            showPersonDetails(sortedData[0]);
        }
    };

    // =======================================================================
    // MINI-TREE - Compact 3-generation tree visualization
    // Based on mapa_rodzin.html renderFamilyTree
    // =======================================================================
    const showMiniTree = (rootPerson) => {
        // Modal elements
        const modal = document.getElementById('treeModal');
        const modalTitle = document.getElementById('treeModalTitle');
        const treeContainer = document.getElementById('treeContainer');
        const closeBtn = document.getElementById('treeModalClose');

        if (!modal || !modalTitle || !treeContainer) {
            console.error('Nie znaleziono elementów modala drzewa');
            return;
        }

        // Helper functions
        const getPersonById = (id) => {
            if (!id) return null;
            return allGenealogy.find(p => p.id_osoby == id || p.db_id == id);
        };

        const formatYears = (p) => {
            if (!p) return '';
            const birth = p.rok_urodzenia || '?';
            const death = p.rok_smierci || '?';
            return `${birth} - ${death}`;
        };

        const getNodeClass = (person, isRoot = false) => {
            if (isRoot) return 'tree-node tree-node-root';
            if (person?.plec === 'M') return 'tree-node tree-node-male';
            if (person?.plec === 'F') return 'tree-node tree-node-female';
            return 'tree-node';
        };

        // Get family members
        const father = getPersonById(rootPerson.id_ojca);
        const mother = getPersonById(rootPerson.id_matki);

        // Grandparents
        const grandparentsFather = [];
        const grandparentsMother = [];

        if (father) {
            const gf = getPersonById(father.id_ojca);
            const gm = getPersonById(father.id_matki);
            if (gf) grandparentsFather.push({ role: 'Dziadek', ...gf });
            if (gm) grandparentsFather.push({ role: 'Babcia', ...gm });
        }
        if (mother) {
            const gf = getPersonById(mother.id_ojca);
            const gm = getPersonById(mother.id_matki);
            if (gf) grandparentsMother.push({ role: 'Dziadek', ...gf });
            if (gm) grandparentsMother.push({ role: 'Babcia', ...gm });
        }

        // Parents
        const parents = [];
        if (father) parents.push({ role: 'Ojciec', ...father });
        if (mother) parents.push({ role: 'Matka', ...mother });

        // Spouses
        const spouses = [];
        if (rootPerson.marriages && rootPerson.marriages.length > 0) {
            rootPerson.marriages.forEach(m => {
                const spouse = getPersonById(m.spouseId);
                if (spouse) spouses.push({ role: 'Małżonek', ...spouse });
            });
        } else if (rootPerson.id_malzonka) {
            const spouse = getPersonById(rootPerson.id_malzonka);
            if (spouse) spouses.push({ role: 'Małżonek', ...spouse });
        }

        // Siblings
        const siblingIds = new Set();
        if (rootPerson.id_ojca) {
            allGenealogy.filter(p => p.id_ojca === rootPerson.id_ojca && p.id_osoby !== rootPerson.id_osoby)
                .forEach(p => siblingIds.add(p.id_osoby));
        }
        if (rootPerson.id_matki) {
            allGenealogy.filter(p => p.id_matki === rootPerson.id_matki && p.id_osoby !== rootPerson.id_osoby)
                .forEach(p => siblingIds.add(p.id_osoby));
        }
        const siblings = Array.from(siblingIds).map(id => {
            const p = getPersonById(id);
            return p ? { role: 'Rodzeństwo', ...p } : null;
        }).filter(Boolean);

        // Children
        const children = allGenealogy.filter(p =>
            p.id_ojca === rootPerson.id_osoby || p.id_matki === rootPerson.id_osoby
        ).map(p => ({ role: 'Dziecko', ...p }));

        // Render tree node
        const renderTreeNode = (person, isRoot = false, showRole = true) => {
            if (!person) return '';
            return `
                <div class="${getNodeClass(person, isRoot)}" 
                     onclick="window.showMiniTreeForPerson && window.showMiniTreeForPerson('${person.id_osoby}')"
                     title="Kliknij aby zobaczyć drzewo tej osoby">
                    ${showRole && person.role ? `<div style="font-size: 0.6rem; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 0.2rem;">${person.role}</div>` : ''}
                    <div style="font-weight: 700; font-size: 0.85rem;">
                        ${person.imie} ${person.nazwisko || ''}
                    </div>
                    <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem;">
                        ${formatYears(person)}
                    </div>
                </div>
            `;
        };

        // Build HTML
        let html = '<div class="tree-scroll-wrapper"><div class="tree-container">';

        // Grandparents
        if (grandparentsFather.length > 0 || grandparentsMother.length > 0) {
            html += '<div class="generation-label">Dziadkowie</div>';
            html += '<div class="tree-level" style="gap: 4rem;">';

            if (grandparentsFather.length > 0) {
                html += '<div class="tree-branch"><div style="font-size: 0.6rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">od ojca</div><div class="tree-pair">';
                grandparentsFather.forEach((gp, i) => {
                    if (i > 0) html += '<div class="tree-pair-connector"></div>';
                    html += renderTreeNode(gp, false, false);
                });
                html += '</div></div>';
            }

            if (grandparentsMother.length > 0) {
                html += '<div class="tree-branch"><div style="font-size: 0.6rem; color: var(--text-tertiary); margin-bottom: 0.25rem;">od matki</div><div class="tree-pair">';
                grandparentsMother.forEach((gp, i) => {
                    if (i > 0) html += '<div class="tree-pair-connector"></div>';
                    html += renderTreeNode(gp, false, false);
                });
                html += '</div></div>';
            }

            html += '</div>';
            html += '<div class="tree-connector-down"></div>';
        }

        // Parents
        if (parents.length > 0) {
            html += '<div class="generation-label">Rodzice</div>';
            html += '<div class="tree-level"><div class="tree-pair">';
            parents.forEach((p, i) => {
                if (i > 0) html += '<div class="tree-pair-connector"></div>';
                html += renderTreeNode(p);
            });
            html += '</div></div>';
            html += '<div class="tree-connector-down"></div>';
        }

        // Main person with siblings
        html += '<div class="tree-with-siblings">';

        if (siblings.length > 0) {
            html += '<div class="tree-siblings-section">';
            html += '<div class="section-label">Rodzeństwo</div>';
            html += '<div class="tree-siblings-grid">';
            siblings.forEach(s => {
                html += renderTreeNode(s, false, false);
            });
            html += '</div></div>';
        }

        html += '<div class="tree-main-column">';
        html += '<div class="generation-label">Główna osoba</div>';

        html += '<div class="tree-pair">';
        html += renderTreeNode({ ...rootPerson, role: null }, true, false);
        if (spouses.length > 0) {
            html += '<div class="tree-pair-connector"></div>';
            html += renderTreeNode(spouses[0], false, false);
        }
        html += '</div>';

        // Children
        if (children.length > 0) {
            html += '<div class="tree-connector-down"></div>';
            html += '<div class="generation-label">Dzieci</div>';
            html += '<div class="tree-children">';

            if (children.length > 1) {
                const childWidth = 160;
                const connectorWidth = (children.length - 1) * childWidth;
                html += `<div class="tree-children-connector" style="width: ${connectorWidth}px; left: calc(50% - ${connectorWidth / 2}px);"></div>`;
            }

            children.forEach(child => {
                html += '<div class="tree-child-branch">';
                html += renderTreeNode(child, false, false);
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>'; // tree-main-column
        html += '</div>'; // tree-with-siblings

        html += '</div></div>'; // tree-container, tree-scroll-wrapper
        treeContainer.innerHTML = html;

        // Set title with inline legend and show modal
        modalTitle.innerHTML = `🌳 Drzewo: ${rootPerson.imie} ${rootPerson.nazwisko || ''} <span style="margin-left: 2rem; font-size: 0.7rem; font-weight: 400; color: var(--text-secondary);">💙 Mężczyzna | 💗 Kobieta | 💛 Główna osoba | 💕 Małżeństwo | Kliknij węzeł by nawigować</span>`;
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');

        // Global function for node clicks
        window.showMiniTreeForPerson = (personId) => {
            const person = getPersonById(personId);
            if (person) showMiniTree(person);
        };

        // Close handlers
        const closeModal = () => {
            modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
        };

        closeBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    };

    const getParentNames = (person) => {
        const parents = [];
        if (person.id_ojca) {
            const father = allGenealogy.find(p => p.id_osoby === person.id_ojca);
            if (father) parents.push(father.imie);
        }
        if (person.id_matki) {
            const mother = allGenealogy.find(p => p.id_osoby === person.id_matki);
            if (mother) parents.push(mother.imie);
        }
        return parents.join(', ') || '-';
    };

    const getSpouseName = (person) => {
        if (!person.id_malzonka) return '-';
        const spouse = allGenealogy.find(p => p.id_osoby === person.id_malzonka);
        return spouse ? spouse.imie : '-';
    };

    const filterGenealogy = () => {
        const searchTerm = document.getElementById('searchGenealogy')?.value || '';
        const houseFilter = document.getElementById('filterHouse')?.value || '';
        const sortOrder = document.getElementById('sortFilter')?.value || 'az';
        const genderFilter = document.querySelector('.genealogy-filters .filter-btn.active')?.dataset.filter || 'all';

        let filtered = allGenealogy;

        // Filtr wyszukiwania (imię, nazwisko, rok)
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(person => {
                const fullName = `${person.imie} ${person.nazwisko}`.toLowerCase();
                const yearStr = String(person.rok_urodzenia || '');
                return fullName.includes(term) || yearStr.includes(term);
            });
        }

        // Filtr numeru domu
        if (houseFilter) {
            const term = houseFilter.toLowerCase();
            filtered = filtered.filter(person => {
                const houseStr = String(person.numer_domu || '');
                return houseStr.toLowerCase().includes(term);
            });
        }

        // Filtr płci
        if (genderFilter !== 'all') {
            const genderKey = genderFilter === 'male' ? 'M' : 'F';
            filtered = filtered.filter(person => person.plec === genderKey);
        }

        // Sortowanie
        filtered.sort((a, b) => {
            // Sortowanie po ID
            if (sortOrder === 'id_asc') {
                const idA = parseInt(a.id_osoby) || 0;
                const idB = parseInt(b.id_osoby) || 0;
                return idA - idB;
            }
            if (sortOrder === 'id_desc') {
                const idA = parseInt(a.id_osoby) || 0;
                const idB = parseInt(b.id_osoby) || 0;
                return idB - idA;
            }

            // Sortowanie alfabetyczne (A-Z, Z-A)
            // 1. Sprawdź czy osoba ma nazwisko (w polu lub w nawiasie w imieniu)
            const getSurnameStatus = (p) => {
                if (p.nazwisko && p.nazwisko.trim()) return true;
                if (p.imie && p.imie.includes('(')) return true;
                return false;
            };

            const hasSurnameA = getSurnameStatus(a);
            const hasSurnameB = getSurnameStatus(b);

            // Reguła: Osoby bez nazwiska ZAWSZE na końcu
            if (hasSurnameA && !hasSurnameB) return -1;
            if (!hasSurnameA && hasSurnameB) return 1;

            // 2. Sortowanie po IMIENIU (główne), potem po NAZWISKU (pomocnicze)
            const firstNameA = (a.imie || '').toLowerCase();
            const firstNameB = (b.imie || '').toLowerCase();
            const surnameA = (a.nazwisko || '').toLowerCase();
            const surnameB = (b.nazwisko || '').toLowerCase();

            if (sortOrder === 'za') {
                // Najpierw porównaj imiona Z-A
                const firstNameCompare = firstNameB.localeCompare(firstNameA, 'pl');
                if (firstNameCompare !== 0) return firstNameCompare;
                // Jeśli imiona takie same, porównaj nazwiska Z-A
                return surnameB.localeCompare(surnameA, 'pl');
            }
            // Domyślnie A-Z: najpierw imię, potem nazwisko
            const firstNameCompare = firstNameA.localeCompare(firstNameB, 'pl');
            if (firstNameCompare !== 0) return firstNameCompare;
            return surnameA.localeCompare(surnameB, 'pl');
        });

        renderGenealogy(filtered);
    };

    const openOwnerModal = (owner = null) => {
        elements.modalTitle.textContent = owner ? 'Edytuj Właściciela' : 'Dodaj Właściciela';

        const formatDateForInput = (dateString) => {
            if (!dateString) return '';
            try {
                // Tworzymy obiekt daty i wyciągamy część YYYY-MM-DD
                return new Date(dateString).toISOString().split('T')[0];
            } catch (e) {
                return ''; // Zwróć pusty string w razie błędu
            }
        };
        const formatTextForTextarea = (text) => (text ? String(text).replace(/\\n/g, "\n") : "");

        elements.modalBody.innerHTML = `
            <form id="ownerForm">
                <div class="form-grid">
                    <!-- Pola podstawowe bez zmian -->
                    <div class="form-group"><label>Unikalny klucz</label><input type="text" name="unikalny_klucz" value="${owner?.unikalny_klucz || ''}" required></div>
                    <div class="form-group"><label>Nazwisko i imię</label><input type="text" name="nazwa_wlasciciela" value="${owner?.nazwa_wlasciciela || ''}" required></div>
                    <div class="form-group"><label>Numer protokołu</label><input type="text" name="numer_protokolu" value="${owner?.numer_protokolu || ''}"></div>
                    <div class="form-group"><label>Numer domu</label><input type="text" name="numer_domu" value="${owner?.numer_domu || ''}"></div>
                    <div class="form-group">
                        <label>Data protokołu</label>
                        <input type="date" name="data_protokolu" value="${formatDateForInput(owner?.data_protokolu)}">
                    </div>
                    <div class="form-group"><label>Miejsce protokołu</label><input type="text" name="miejsce_protokolu" value="${owner?.miejsce_protokolu || ''}"></div>
                </div>

                <!-- Przywrócony edytor działek -->
                <div class="parcel-editor" id="parcelEditorContainer">
                    <!-- Treść edytora działek zostanie wstawiona dynamicznie -->
                </div>

                <!-- Pola opisowe bez zmian -->
                <div class="form-group"><label>Genealogia</label><textarea name="genealogia">${formatTextForTextarea(owner?.genealogia)}</textarea></div>
                <div class="form-group"><label>Historia własności</label><textarea name="historia_wlasnosci">${formatTextForTextarea(owner?.historia_wlasnosci)}</textarea></div>
                <div class="form-group"><label>Ciąg dalszy / Uwagi</label><textarea name="uwagi">${formatTextForTextarea(owner?.uwagi)}</textarea></div>
                <div class="form-group"><label>Współwłasność / Służebność</label><textarea name="wspolwlasnosc">${formatTextForTextarea(owner?.wspolwlasnosc)}</textarea></div>
                <div class="form-group"><label>Powiązania i transakcje</label><textarea name="powiazania_i_transakcje">${formatTextForTextarea(owner?.powiazania_i_transakcje)}</textarea></div>
                <div class="form-group"><label>Interpretacja i wnioski</label><textarea name="interpretacja_i_wnioski">${formatTextForTextarea(owner?.interpretacja_i_wnioski)}</textarea></div>
            </form>
        `;

        // Populacja i obsługa edytora działek
        populateAndSetupParcelEditor(owner);

        elements.modalSave.onclick = () => saveOwner(owner?.id);
        elements.modalOverlay.classList.remove('hidden');
    };

    // Ta funkcja jest wywoływana z openOwnerModal
    const populateAndSetupParcelEditor = async (owner) => {
        const container = document.getElementById('parcelEditorContainer');
        if (!container) return;

        // Pobierz świeżą listę wszystkich obiektów
        const allObjectsResponse = await fetch(API.allObjects);
        const allParcels = await allObjectsResponse.json();

        // Podziel działki właściciela na dwie grupy
        const ownerParcels = owner?.dzialki_wszystkie || [];
        const realPlotIds = new Set(ownerParcels.filter(p => p.typ_posiadania === 'własność rzeczywista').map(p => p.id));
        const protocolPlotIds = new Set(ownerParcels.filter(p => p.typ_posiadania !== 'własność rzeczywista').map(p => p.id));

        // Funkcja do tworzenia opcji dla list <select>
        const createOptions = (assignedIds) => {
            let assignedHTML = '';
            let availableHTML = '';

            // Lista kategorii do ukrycia w edytorze działek
            const excludedCategories = ['budynek', 'kapliczka', 'obiekt_specjalny'];

            allParcels.forEach(p => {
                // Sprawdź, czy kategoria obiektu znajduje się na liście wykluczonych
                if (excludedCategories.includes(p.kategoria)) {
                    return; // Pomiń ten obiekt i przejdź do następnego
                }

                const option = `<option value="${p.id}">${p.nazwa_lub_numer} (${p.kategoria})</option>`;
                if (assignedIds.has(p.id)) {
                    assignedHTML += option;
                } else {
                    availableHTML += option;
                }
            });
            return { assignedHTML, availableHTML };
        };

        const realOptions = createOptions(realPlotIds);
        const protocolOptions = createOptions(protocolPlotIds);

        container.innerHTML = `
            <!-- Edytor dla działek rzeczywistych -->
            <div class="parcel-list">
                <label>Działki rzeczywiste (przypisane)</label>
                <select id="assigned-real" multiple>${realOptions.assignedHTML}</select>
            </div>
            <div class="parcel-buttons">
                <button type="button" data-type="real" data-action="add">&lt;&lt;</button>
                <button type="button" data-type="real" data-action="remove">&gt;&gt;</button>
            </div>
            <div class="parcel-list">
                <label>Dostępne</label>
                <select id="available-real" multiple>${realOptions.availableHTML}</select>
            </div>

            <!-- Edytor dla działek z protokołu -->
            <div class="parcel-list">
                <label>Działki z protokołu (przypisane)</label>
                <select id="assigned-protocol" multiple>${protocolOptions.assignedHTML}</select>
            </div>
            <div class="parcel-buttons">
                <button type="button" data-type="protocol" data-action="add">&lt;&lt;</button>
                <button type="button" data-type="protocol" data-action="remove">&gt;&gt;</button>
            </div>
            <div class="parcel-list">
                <label>Dostępne</label>
                <select id="available-protocol" multiple>${protocolOptions.availableHTML}</select>
            </div>
        `;

        // Dodaj event listenery do przycisków
        container.querySelectorAll('.parcel-buttons button').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const action = btn.dataset.action;
                const source = document.getElementById(action === 'add' ? `available-${type}` : `assigned-${type}`);
                const dest = document.getElementById(action === 'add' ? `assigned-${type}` : `available-${type}`);

                Array.from(source.selectedOptions).forEach(opt => dest.appendChild(opt));
            });
        });
    };

    const saveOwner = async (id) => {
        const form = document.getElementById('ownerForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        // Zbierz ID działek z list <select>
        data.dzialki_rzeczywiste_ids = Array.from(document.getElementById('assigned-real').options).map(o => o.value);
        data.dzialki_protokol_ids = Array.from(document.getElementById('assigned-protocol').options).map(o => o.value);

        try {
            const url = id ? `${API.owners}/${id}` : API.owners;
            const method = id ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                showToast('success', 'Właściciel został zapisany');
                closeModal();
                loadOwners();
                loadDashboardData(); // Odśwież statystyki na pulpicie
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Błąd zapisu');
            }
        } catch (error) {
            showToast('error', `Nie udało się zapisać właściciela: ${error.message}`);
        }
    };

    const openDemographyModal = () => {
        elements.modalTitle.textContent = 'Dodaj Wpis Demograficzny';

        elements.modalBody.innerHTML = `
            <form id="demographyForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label>Rok</label>
                        <input type="number" name="rok" required>
                    </div>
                    <div class="form-group">
                        <label>Populacja</label>
                        <input type="number" name="populacja_ogolem">
                    </div>
                    <div class="form-group">
                        <label>Katolicy</label>
                        <input type="number" name="katolicy">
                    </div>
                    <div class="form-group">
                        <label>Żydzi</label>
                        <input type="number" name="zydzi">
                    </div>
                    <div class="form-group">
                        <label>Inni</label>
                        <input type="number" name="inni">
                    </div>
                </div>
                <div class="form-group">
                    <label>Opis</label>
                    <textarea name="opis"></textarea>
                </div>
            </form>
        `;

        elements.modalSave.onclick = saveDemographyEntry;
        elements.modalOverlay.classList.remove('hidden');
    };

    const saveDemographyEntry = async () => {
        const form = document.getElementById('demographyForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch(API.demography, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                showToast('success', 'Wpis demograficzny został dodany');
                closeModal();
                loadDemography();
            } else {
                throw new Error('Błąd zapisu');
            }
        } catch (error) {
            showToast('error', 'Nie udało się dodać wpisu');
        }
    };

    // Funkcja globalna do filtrowania selectów
    window.filterSelect = (input, selectId) => {
        const filter = input.value.toLowerCase();
        const select = document.getElementById(selectId);
        if (!select) return;

        const options = select.options;
        for (let i = 0; i < options.length; i++) {
            const txt = options[i].text.toLowerCase();
            // Pokaż opcję jeśli pasuje lub jeśli to opcja "Brak"/"Wybierz..." (pusta wartość)
            // Ale chcemy móc ukryć "Brak" jeśli szukamy konkretnego imienia
            if (options[i].value === "") {
                options[i].style.display = "";
            } else {
                options[i].style.display = txt.includes(filter) ? "" : "none";
            }
        }
    };

    const openGenealogyModal = (person = null) => {
        elements.modalTitle.textContent = person ? 'Edytuj Osobę' : 'Dodaj Osobę';

        // Sortujemy alfabetycznie dla łatwiejszego szukania
        const sortedGenealogy = [...allGenealogy].sort((a, b) =>
            (a.imie + a.nazwisko).localeCompare(b.imie + b.nazwisko)
        );

        const peopleOptions = sortedGenealogy.map(p =>
            `<option value="${p.id_osoby}">${p.imie} ${p.nazwisko || ''} (ID: ${p.id_osoby})</option>`
        ).join('');

        const protocolOptions = allProtocols.map(p =>
            `<option value="${p.key}">${p.name}</option>`
        ).join('');

        elements.modalBody.innerHTML = `
            <form id="genealogyForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label>ID Osoby</label>
                        <input type="text" name="id_osoby" value="${person?.id_osoby || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Imię</label>
                        <input type="text" name="imie" value="${person?.imie || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Nazwisko</label>
                        <input type="text" name="nazwisko" value="${person?.nazwisko || ''}">
                    </div>
                    <div class="form-group">
                        <label>Płeć</label>
                        <select name="plec">
                            <option value="M" ${person?.plec === 'M' ? 'selected' : ''}>Mężczyzna</option>
                            <option value="F" ${person?.plec === 'F' ? 'selected' : ''}>Kobieta</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Rok urodzenia</label>
                        <input type="number" name="rok_urodzenia" value="${person?.rok_urodzenia || ''}">
                    </div>
                    <div class="form-group">
                        <label>Rok śmierci</label>
                        <input type="number" name="rok_smierci" value="${person?.rok_smierci || ''}">
                    </div>
                    <div class="form-group">
                        <label>Ojciec</label>
                        <div style="position: relative;">
                            <input type="hidden" name="id_ojca" id="fatherIdInput">
                            <input type="text" id="fatherAutocomplete" placeholder="Szukaj ojca (imię lub ID)..." autocomplete="off" style="width: 100%;">
                            <div id="fatherSuggestions" class="autocomplete-suggestions hidden"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Matka</label>
                        <div style="position: relative;">
                            <input type="hidden" name="id_matki" id="motherIdInput">
                            <input type="text" id="motherAutocomplete" placeholder="Szukaj matki (imię lub ID)..." autocomplete="off" style="width: 100%;">
                            <div id="motherSuggestions" class="autocomplete-suggestions hidden"></div>
                        </div>
                    </div>
                    
                    <!-- Nowa sekcja małżonków -->
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>Małżeństwa (Małżonek + Rok)</label>
                        <div id="spousesContainer"></div>
                        <button type="button" class="btn-add-spouse" id="addSpouseBtn">+ Dodaj małżonka</button>
                    </div>

                    <div class="form-group">
                        <label>Protokół</label>
                        <div style="position: relative;">
                            <input type="hidden" name="protokol_klucz" id="protocolIdInput">
                            <input type="text" id="protocolAutocomplete" placeholder="Wybierz protokół (nazwa lub Lp.)..." autocomplete="off" style="width: 100%;">
                            <div id="protocolSuggestions" class="autocomplete-suggestions hidden"></div>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Uwagi</label>
                    <textarea name="uwagi">${person?.uwagi || ''}</textarea>
                </div>
            </form>
        `;

        // Logic for Autocomplete
        const protocolInput = document.getElementById('protocolAutocomplete');
        const protocolIdInput = document.getElementById('protocolIdInput');
        const suggestionsBox = document.getElementById('protocolSuggestions');

        // Close suggestions on click outside
        document.addEventListener('click', (e) => {
            if (!protocolInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
                suggestionsBox.classList.add('hidden');
            }
        });

        protocolInput.addEventListener('input', () => {
            const query = protocolInput.value.toLowerCase();
            suggestionsBox.innerHTML = '';

            if (query.length < 1) {
                suggestionsBox.classList.add('hidden');
                // Clear ID if user clears input? Maybe safe to keep until they select something else or clear explicitly
                if (query === '') protocolIdInput.value = '';
                return;
            }

            const matches = allProtocols.filter(p => {
                const nameMatch = p.name && p.name.toLowerCase().includes(query);
                const numMatch = String(p.ordernumber || p.orderNumber || '').includes(query);
                return nameMatch || numMatch;
            });

            // Sortowanie: exact match first → starts with → contains
            matches.sort((a, b) => {
                const aNum = String(a.ordernumber || a.orderNumber || '');
                const bNum = String(b.ordernumber || b.orderNumber || '');
                const aName = (a.name || '').toLowerCase();
                const bName = (b.name || '').toLowerCase();

                // Funkcja scoring: 0 = exact match, 1 = starts with, 2 = contains
                const getScore = (num, name) => {
                    if (num === query) return 0; // Exact match on number
                    if (num.startsWith(query)) return 1; // Starts with number
                    if (name === query) return 2; // Exact match on name
                    if (name.startsWith(query)) return 3; // Starts with name
                    return 4; // Contains
                };

                const scoreA = getScore(aNum, aName);
                const scoreB = getScore(bNum, bName);

                if (scoreA !== scoreB) return scoreA - scoreB;

                // Secondary sort: by number ascending
                return parseInt(aNum || 0) - parseInt(bNum || 0);
            });

            if (matches.length > 0) {
                matches.forEach(p => {
                    const div = document.createElement('div');
                    div.className = 'autocomplete-suggestion';
                    // Display orderNumber (numeric) instead of key (text)
                    const displayNum = p.ordernumber || p.orderNumber || '?';
                    div.innerHTML = `<strong>${p.name}</strong> (Lp. ${displayNum})`;
                    div.onclick = () => {
                        protocolInput.value = `${p.name} (Lp. ${displayNum})`;
                        protocolIdInput.value = p.key; // Still save the key for DB reference
                        suggestionsBox.classList.add('hidden');
                    };
                    suggestionsBox.appendChild(div);
                });
                suggestionsBox.classList.remove('hidden');
            } else {
                suggestionsBox.classList.add('hidden');
            }
        });

        // Initial Logic for existing person protocol
        if (person && person.protokol_klucz) {
            const existing = allProtocols.find(p => p.key == person.protokol_klucz);
            if (existing) {
                const displayNum = existing.ordernumber || existing.orderNumber || '?';
                protocolInput.value = `${existing.name} (Lp. ${displayNum})`;
                protocolIdInput.value = existing.key;
            } else {
                // Fallback if key exists but not found in list (shouldn't happen usually)
                protocolIdInput.value = person.protokol_klucz;
                protocolInput.value = `Protokół nr ${person.protokol_klucz}`;
            }
        }

        // =====================================================
        // Autocomplete dla Ojca
        // =====================================================
        const fatherInput = document.getElementById('fatherAutocomplete');
        const fatherIdInput = document.getElementById('fatherIdInput');
        const fatherSuggestions = document.getElementById('fatherSuggestions');

        const setupPersonAutocomplete = (input, idInput, suggestions, genderFilter = null) => {
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !suggestions.contains(e.target)) {
                    suggestions.classList.add('hidden');
                }
            });

            input.addEventListener('input', () => {
                const query = input.value.toLowerCase().trim();
                suggestions.innerHTML = '';

                if (query.length < 1) {
                    suggestions.classList.add('hidden');
                    if (query === '') idInput.value = '';
                    return;
                }

                let matches = allGenealogy.filter(p => {
                    const fullName = `${p.imie || ''} ${p.nazwisko || ''}`.toLowerCase();
                    const idMatch = String(p.id_osoby).includes(query);
                    return fullName.includes(query) || idMatch;
                });

                // Filter by gender if specified
                if (genderFilter) {
                    matches = matches.filter(p => p.plec === genderFilter);
                }

                // Sortowanie: exact match first → starts with → contains
                matches.sort((a, b) => {
                    const aName = `${a.imie || ''} ${a.nazwisko || ''}`.toLowerCase();
                    const bName = `${b.imie || ''} ${b.nazwisko || ''}`.toLowerCase();

                    const getScore = (name) => {
                        if (name === query) return 0;
                        if (name.startsWith(query)) return 1;
                        return 2;
                    };

                    return getScore(aName) - getScore(bName) || aName.localeCompare(bName);
                });

                // Limit to 15 results
                matches = matches.slice(0, 15);

                if (matches.length > 0) {
                    matches.forEach(p => {
                        const div = document.createElement('div');
                        div.className = 'autocomplete-suggestion';
                        const lifespan = p.rok_urodzenia ? `${p.rok_urodzenia}-${p.rok_smierci || '?'}` : '';
                        // Wyświetl ID + imię + nazwisko + lata życia
                        div.innerHTML = `<strong>${p.imie} ${p.nazwisko || ''}</strong> <span style="color: #64748b;">(ID: ${p.id_osoby}${lifespan ? `, ${lifespan}` : ''})</span>`;
                        div.onclick = () => {
                            // W input pokaż imię + ID dla łatwej identyfikacji
                            input.value = `${p.imie} ${p.nazwisko || ''} (ID: ${p.id_osoby})`;
                            idInput.value = p.id_osoby;
                            suggestions.classList.add('hidden');
                        };
                        suggestions.appendChild(div);
                    });
                    suggestions.classList.remove('hidden');
                } else {
                    suggestions.classList.add('hidden');
                }
            });

            // Allow clearing with "x" button or keyboard
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    suggestions.classList.add('hidden');
                } else if (e.key === 'Backspace' && input.value === '') {
                    idInput.value = '';
                }
            });
        };

        // Setup father autocomplete (filter to males)
        setupPersonAutocomplete(fatherInput, fatherIdInput, fatherSuggestions, 'M');

        // Setup mother autocomplete (filter to females)
        const motherInput = document.getElementById('motherAutocomplete');
        const motherIdInput = document.getElementById('motherIdInput');
        const motherSuggestions = document.getElementById('motherSuggestions');
        setupPersonAutocomplete(motherInput, motherIdInput, motherSuggestions, 'F');

        // Fill existing father/mother values
        if (person && person.id_ojca) {
            const father = allGenealogy.find(p => p.id_osoby == person.id_ojca || p.db_id == person.id_ojca);
            if (father) {
                fatherInput.value = `${father.imie} ${father.nazwisko || ''} (ID: ${father.id_osoby})`;
                fatherIdInput.value = father.id_osoby;
            }
        }
        if (person && person.id_matki) {
            const mother = allGenealogy.find(p => p.id_osoby == person.id_matki || p.db_id == person.id_matki);
            if (mother) {
                motherInput.value = `${mother.imie} ${mother.nazwisko || ''} (ID: ${mother.id_osoby})`;
                motherIdInput.value = mother.id_osoby;
            }
        }

        // Logika dynamicznych małżonków
        const spousesContainer = document.getElementById('spousesContainer');

        // Funkcja tworząca wiersz z autocomplete
        const addSpouseRow = (spouseId = '', year = '') => {
            const uniqueId = 'spouse_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const row = document.createElement('div');
            row.className = 'spouse-row';
            row.style.display = 'flex';
            row.style.gap = '10px';
            row.style.alignItems = 'flex-start';
            row.style.marginBottom = '10px';

            row.innerHTML = `
                <div style="flex: 2; position: relative;">
                    <input type="hidden" class="spouse-id" id="${uniqueId}_id">
                    <input type="text" class="spouse-autocomplete" id="${uniqueId}_input" placeholder="Szukaj małżonka (imię lub ID)..." autocomplete="off" style="width: 100%;">
                    <div class="autocomplete-suggestions hidden" id="${uniqueId}_suggestions"></div>
                </div>
                <input type="number" class="spouse-year" placeholder="Rok" value="${year}" style="flex: 1;">
                <button type="button" class="btn-remove" onclick="this.closest('.spouse-row').remove()">×</button>
            `;

            spousesContainer.appendChild(row);

            // Setup autocomplete for this spouse row
            const spouseInput = document.getElementById(`${uniqueId}_input`);
            const spouseIdField = document.getElementById(`${uniqueId}_id`);
            const spouseSuggestions = document.getElementById(`${uniqueId}_suggestions`);

            setupPersonAutocomplete(spouseInput, spouseIdField, spouseSuggestions, null);

            // Fill existing spouse value
            if (spouseId) {
                const spouse = allGenealogy.find(p => p.id_osoby == spouseId || p.db_id == spouseId);
                if (spouse) {
                    spouseInput.value = `${spouse.imie} ${spouse.nazwisko || ''} (ID: ${spouse.id_osoby})`;
                    spouseIdField.value = spouse.id_osoby;
                }
            }
        };

        // Obsługa przycisku dodawania
        document.getElementById('addSpouseBtn').onclick = () => addSpouseRow();

        if (person) {
            // ojciec i matka są teraz obsługiwane przez autocomplete wyżej
            // protokol_klucz handled above by autocomplete logic

            // Wypełnij istniejącymi małżeństwami
            if (person.marriages && person.marriages.length > 0) {
                person.marriages.forEach(m => addSpouseRow(m.spouseId, m.date));
            } else if (person.id_malzonka) {
                // Fallback dla starego formatu (tylko ID, bez daty)
                // Znajdź json_id małżonka na podstawie db_id (jeśli to db_id) lub json_id
                const spouse = allGenealogy.find(p => p.db_id === person.id_malzonka) ||
                    allGenealogy.find(p => p.id_osoby == person.id_malzonka);
                if (spouse) addSpouseRow(spouse.id_osoby, '');
            }
        }

        elements.modalSave.onclick = () => saveGenealogy(person?.db_id);
        elements.modalOverlay.classList.remove('hidden');
    };

    const saveGenealogy = async (id) => {
        const form = document.getElementById('genealogyForm');

        // Walidacja formularza HTML5
        if (!form.reportValidity()) {
            return;
        }

        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        // Zbierz dane o małżeństwach i WALIDUJ
        const marriageRows = document.querySelectorAll('.spouse-row');
        const marriages = [];
        let hasError = false;

        // Reset stylów błędów
        marriageRows.forEach(row => {
            const autocomplete = row.querySelector('.spouse-autocomplete');
            if (autocomplete) autocomplete.style.borderColor = '';
        });

        for (const row of marriageRows) {
            const hiddenInput = row.querySelector('.spouse-id');
            const autocomplete = row.querySelector('.spouse-autocomplete');
            const sid = hiddenInput ? hiddenInput.value : '';
            const year = row.querySelector('.spouse-year').value;

            if (!sid) {
                // Jeśli dodano wiersz, ale nie wybrano osoby -> BŁĄD
                if (autocomplete) autocomplete.style.borderColor = 'red';
                hasError = true;
            } else {
                marriages.push({
                    spouse_json_id: sid,
                    year: year ? parseInt(year, 10) : null
                });
            }
        }

        if (hasError) {
            showToast('error', 'Wybierz małżonka w dodanym wierszu lub usuń pusty wiersz.');
            return; // Przerwij zapis
        }

        data.marriages = marriages;

        Object.keys(data).forEach(key => {
            if (data[key] === '') data[key] = null;
        });

        try {
            const url = id ? `${API.genealogy}/${id}` : API.genealogy;
            const method = id ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                showToast('success', 'Osoba została zapisana');
                closeModal();

                // Pomyślnie zapisano. Teraz odświeżamy widok.
                // Robimy to w osobnym bloku try/catch, aby błąd widoku nie raportował błędu zapisu.
                try {
                    await loadGenealogy(); // Poczekaj na przeładowanie listy

                    // PO ZAPISIE: Otwórz widok szczegółów tej osoby
                    const savedId = data.id_osoby; // To jest string z formularza
                    if (savedId) {
                        // Znajdź osobę w nowo pobranej liście (niezależnie czy ID to string czy int)
                        // Używamy luźnego porównania (==) lub konwersji na String dla pewności
                        const person = allGenealogy.find(p => String(p.id_osoby) === String(savedId));
                        if (person) {
                            showPersonDetails(person); // Przekazujemy CAŁY obiekt osoby
                        } else {
                            console.warn('Nie znaleziono nowo dodanej osoby na liście:', savedId);
                        }
                    }
                } catch (viewError) {
                    console.error('Błąd podczas odświeżania widoku po zapisie:', viewError);
                    showToast('warning', 'Osoba zapisana, ale wystąpił błąd odświeżania widoku.');
                }

            } else {
                // Jeśli status HTTP nie jest 200-299
                try {
                    const errData = await response.json();
                    throw new Error(errData.message || 'Błąd zapisu');
                } catch (e) {
                    throw new Error('Błąd zapisu (nieznana odpowiedź serwera)');
                }
            }
        } catch (error) {
            console.error('Błąd zapisu:', error);
            showToast('error', error.message || 'Nie udało się zapisać osoby');
        }
    };

    const closeModal = () => {
        elements.modalOverlay.classList.add('hidden');
        elements.modalBody.innerHTML = '';
    };

    const showToast = (type, message) => {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;

        elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    const toggleTheme = () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        elements.themeToggle.innerHTML = `<i class="fas fa-${isDark ? 'sun' : 'moon'}"></i>`;
    };

    const updateDateTime = () => {
        const now = new Date();

        // Formatowanie daty (bez zmian)
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        elements.currentDate.textContent = now.toLocaleDateString('pl-PL', options);

        // Formatowanie czasu (nowa logika)
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        // Wyświetlenie zegara w formacie HH:MM:SS
        elements.currentTime.textContent = `${hours}:${minutes}:${seconds}`;
    };

    const downloadBackup = () => {
        window.location.href = API.backup;
        showToast('info', 'Rozpoczęto pobieranie backupu');
    };

    const handleQuickAction = (action) => {
        switch (action) {
            case 'add-owner':
                switchSection('owners');
                openOwnerModal();
                break;
            case 'view-map':
                window.location.href = '../mapa/mapa.html';
                break;
            case 'export-data':
                downloadBackup();
                break;
            case 'system-info':
                showSystemInfo();
                break;
        }
    };

    const showSystemInfo = () => {
        elements.modalTitle.textContent = 'Informacje o Systemie';
        elements.modalBody.innerHTML = `
            <div style="padding: 1rem;">
                <h3>System Zarządzania Mapą Katastralną</h3>
                <p><strong>Wersja:</strong> 2.0</p>
                <p><strong>Autor:</strong> Maksymilian Augustyn</p>
                <p><strong>Technologie:</strong> HTML5, CSS3, JavaScript, Node.js</p>
                <p><strong>Status:</strong> Aktywny</p>
            </div>
        `;
        elements.modalSave.style.display = 'none';
        elements.modalOverlay.classList.remove('hidden');
    };

    window.editOwner = async (id) => {
        const owner = allOwners.find(o => o.id === id);
        if (owner) {
            const response = await fetch(`${API.owners}/${id}`);
            const fullData = await response.json();
            openOwnerModal(fullData);
        }
    };

    window.deleteOwner = async (id) => {
        if (confirm('Czy na pewno chcesz usunąć tego właściciela?')) {
            try {
                const response = await fetch(`${API.owners}/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('success', 'Właściciel został usunięty');
                    loadOwners();
                }
            } catch (error) {
                showToast('error', 'Nie udało się usunąć właściciela');
            }
        }
    };

    // Definiujemy dwie logiczne grupy kategorii
    const areaCategories = ['rolna', 'budowlana', 'las', 'pastwisko', 'droga', 'rzeka'];
    const pointCategories = ['budynek', 'kapliczka', 'obiekt_specjalny'];

    // Główna lista jest teraz sumą obu grup (na wszelki wypadek, gdyby była używana gdzieś indziej)
    const objectCategories = [...areaCategories, ...pointCategories].sort();

    const editObject = (row) => {
        const objId = row.dataset.id;
        const currentName = row.querySelector('[data-field="nazwa_lub_numer"]').textContent;
        const currentCategory = row.querySelector('[data-field="kategoria"]').textContent;

        // --- Określ, które kategorie są dozwolone ---
        let availableOptions;
        let tooltipText = '';

        if (pointCategories.includes(currentCategory)) {
            availableOptions = pointCategories;
            tooltipText = 'Można zmienić tylko na inny typ obiektu punktowego (pinezki).';
        } else {
            // Domyślnie traktujemy resztę jako obiekty powierzchniowe/liniowe
            availableOptions = areaCategories;
            tooltipText = 'Można zmienić tylko na inny typ działki (obiektu z geometrią).';
        }

        // Zamień komórki na pola edycji
        row.querySelector('[data-field="nazwa_lub_numer"]').innerHTML = `<input type="text" class="form-control" value="${currentName}">`;

        const categorySelectHTML = `
            <select class="form-control" title="${tooltipText}">
                ${availableOptions.map(cat => `<option value="${cat}" ${cat === currentCategory ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
        `;
        row.querySelector('[data-field="kategoria"]').innerHTML = categorySelectHTML;

        // Zmień przyciski (bez zmian)
        const actionsCell = row.querySelector('.actions');
        actionsCell.innerHTML = `
            <button class="btn-success save-btn"><i class="fas fa-save"></i> Zapisz</button>
            <button class="btn-cancel"><i class="fas fa-times"></i> Anuluj</button>
        `;

        actionsCell.querySelector('.save-btn').addEventListener('click', () => saveObject(row));
        actionsCell.querySelector('.btn-cancel').addEventListener('click', () => loadObjects());
    };

    const saveObject = async (row) => {
        const objId = row.dataset.id;
        const newName = row.querySelector('input[type="text"]').value;
        const newCategory = row.querySelector('select').value;

        try {
            const response = await fetch(`${API.objects}/${objId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nazwa_lub_numer: newName, kategoria: newCategory })
            });

            if (response.ok) {
                showToast('success', 'Obiekt został zaktualizowany');
                loadObjects(); // Odśwież widok
            } else {
                throw new Error('Błąd zapisu na serwerze.');
            }
        } catch (error) {
            showToast('error', 'Nie udało się zapisać obiektu.');
            loadObjects(); // Przywróć oryginalny stan w razie błędu
        }
    };

    const deleteObject = async (row) => {
        const objId = row.dataset.id;
        const objName = row.querySelector('[data-field="nazwa_lub_numer"]').textContent;

        if (confirm(`Czy na pewno chcesz usunąć obiekt "${objName}"?`)) {
            try {
                const response = await fetch(`${API.objects}/${objId}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('success', 'Obiekt został usunięty');
                    loadObjects(); // Odśwież widok
                } else {
                    throw new Error('Błąd usuwania na serwerze.');
                }
            } catch (error) {
                showToast('error', 'Nie udało się usunąć obiektu.');
            }
        }
    };

    window.saveDemography = async (id) => {
        const row = event.target.closest('tr');
        const inputs = row.querySelectorAll('input, textarea');
        const data = {};

        inputs.forEach(input => {
            data[input.dataset.field] = input.value || null;
        });

        try {
            const response = await fetch(`${API.demography}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                showToast('success', 'Wpis został zapisany');
            }
        } catch (error) {
            showToast('error', 'Nie udało się zapisać wpisu');
        }
    };

    window.deleteDemography = async (id) => {
        if (confirm('Czy na pewno chcesz usunąć ten wpis?')) {
            try {
                const response = await fetch(`${API.demography}/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('success', 'Wpis został usunięty');
                    loadDemography();
                }
            } catch (error) {
                showToast('error', 'Nie udało się usunąć wpisu');
            }
        }
    };

    const editGenealogy = (id) => {
        const person = allGenealogy.find(p => p.db_id === id);
        if (person) openGenealogyModal(person);
    };


    const deleteGenealogy = async (id) => {
        const person = allGenealogy.find(p => p.db_id === id);
        if (confirm(`Czy na pewno chcesz usunąć osobę: ${person.imie} ${person.nazwisko}?`)) {
            try {
                const response = await fetch(`${API.genealogy}/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    showToast('success', 'Osoba została usunięta');
                    loadGenealogy();
                } else {
                    throw new Error('Błąd serwera podczas usuwania.');
                }
            } catch (error) {
                showToast('error', 'Nie udało się usunąć osoby.');
            }
        }
    };

    // === PRZENIESIONYMY TUTAJ PRZED init(); ===

    // Stałe konfiguracyjne dla rysowania drzewa
    const TREE_CONFIG = {
        NODE_HEIGHT: 80,
        NODE_MIN_W: 120,
        H_GAP: 80,
        V_GAP: 120,
        MARGIN: 80,
        FONT: '700 16px "Segoe UI", sans-serif',
        MARRIAGE_GAP: 20
    };

    // Pokazywanie drzewa genealogicznego na podstawie protokołu
    const showGenealogyTreeFromProtocol = async (protocolKey, familyName) => {
        try {
            const response = await fetch(`/api/genealogia/${protocolKey}`);
            if (!response.ok) throw new Error('Błąd pobierania danych');

            const data = await response.json();
            if (data.persons && Array.isArray(data.persons)) {
                const personsForTree = data.persons.map(person => ({
                    id: person.id,
                    name: person.name,
                    gender: person.gender,
                    birthDate: person.birthDate,
                    deathDate: person.deathDate,
                    fatherId: person.fatherId,
                    motherId: person.motherId,
                    spouseIds: person.spouseIds,
                    protocolKey: person.protocolKey,
                    houseNumber: person.houseNumber
                }));

                elements.treeModalTitle.textContent = `Drzewo Genealogiczne - ${familyName}`;
                elements.treeModal.classList.remove('hidden');
                AdvancedTreeRenderer.render(elements.treeContainer, personsForTree, data.rootId);
            }
        } catch (error) {
            console.error('Błąd ładowania drzewa:', error);
            showToast('error', 'Nie udało się załadować drzewa genealogicznego');
        }
    };

    // Pokazywanie lokalnego drzewa rodziny
    const showLocalFamilyTree = (lineName, members, peopleMap) => {
        const famCanon = canonicalSurname(lineName.replace(/\s*KATEX_INLINE_OPEN.*$/, ""));

        const coreMemberIds = new Set(
            allGenealogy
                .filter(p => canonicalSurname(p.nazwisko) === famCanon)
                .map(p => p.id_osoby)
        );

        const spouseIds = new Set(
            allGenealogy
                .filter(p => p.id_malzonka && coreMemberIds.has(p.id_malzonka))
                .map(p => p.id_osoby)
        );

        const childIds = new Set(
            allGenealogy
                .filter(p =>
                    (p.id_ojca && coreMemberIds.has(p.id_ojca)) ||
                    (p.id_matki && coreMemberIds.has(p.id_matki))
                )
                .map(p => p.id_osoby)
        );

        const includeIds = new Set([...coreMemberIds, ...spouseIds, ...childIds]);

        const localPeople = allGenealogy
            .filter(p => includeIds.has(p.id_osoby))
            .map(p => ({
                id: p.id_osoby,
                name: `${p.imie} ${p.nazwisko || ''}`.trim(),
                gender: p.plec,
                birthDate: { year: p.rok_urodzenia },
                deathDate: { year: p.rok_smierci },
                fatherId: p.id_ojca,
                motherId: p.id_matki,
                spouseIds: p.id_malzonka ? [p.id_malzonka] : [],
                protocolKey: p.protokol_klucz
            }));

        elements.treeModalTitle.textContent = `Drzewo Genealogiczne - ${lineName}`;
        elements.treeModal.classList.remove('hidden');
        AdvancedTreeRenderer.render(elements.treeContainer, localPeople);
    };

    // Moduł GenealogyTreeViewer
    const GenealogyTreeViewer = (() => {
        const showClientTree = (members, familyName) => {
            const personsForTree = members.map(person => ({
                id: person.id_osoby,
                name: `${person.imie} ${person.nazwisko || ''}`.trim(),
                gender: person.plec,
                birthDate: { year: person.rok_urodzenia },
                deathDate: { year: person.rok_smierci },
                fatherId: person.id_ojca,
                motherId: person.id_matki,
                spouseIds: person.id_malzonka ? [person.id_malzonka] : [],
                protocolKey: person.protokol_klucz,
                houseNumber: person.numer_domu
            }));

            AdvancedTreeRenderer.render(elements.treeContainer, personsForTree);
        };

        return { showClientTree };
    })();

    // Moduł AdvancedTreeRenderer
    const AdvancedTreeRenderer = (() => {
        const expandUnions = (rawPeople) => {
            const nodes = [];
            const unions = [];

            rawPeople.forEach(p => {
                if (p.spouseIds && p.spouseIds.length > 0) {
                    p.spouseIds.forEach((spouseId, idx) => {
                        const uid = `u_${p.id}_${spouseId}_${idx}`;
                        unions.push({
                            id: uid,
                            type: "union",
                            parents: [p.id, spouseId],
                            children: []
                        });
                    });
                }
                nodes.push(p);
            });

            return nodes.concat(unions);
        };

        const render = (container, persons, rootId = null) => {
            container.innerHTML = '';

            if (!persons || persons.length === 0) {
                container.innerHTML = '<div style="padding: 2rem; text-align: center;">Brak danych do wyświetlenia</div>';
                return;
            }

            // Filtruj osoby - usuń wszystkie z undefined ID lub nazwą
            const validPersons = persons.filter(p =>
                p && p.id && p.name && !p.name.includes('undefined')
            );

            // Przygotowanie canvas do pomiaru tekstu
            const ctx = document.createElement("canvas").getContext("2d");
            ctx.font = TREE_CONFIG.FONT;
            const textWidth = (t) => ctx.measureText(t).width;

            // Mapa osób - tylko istniejące osoby
            const personMap = new Map();
            const existingIds = new Set(validPersons.map(p => String(p.id)));

            validPersons.forEach(p => {
                // Filtruj rodziców i małżonków - tylko jeśli istnieją w danych
                const validFatherId = p.fatherId && existingIds.has(String(p.fatherId)) ? String(p.fatherId) : null;
                const validMotherId = p.motherId && existingIds.has(String(p.motherId)) ? String(p.motherId) : null;
                const validSpouseIds = (p.spouseIds || []).filter(id => existingIds.has(String(id)));

                const rec = {
                    nodeId: String(p.id),
                    name: p.name,
                    birth: p.birthDate?.year,
                    death: p.deathDate?.year,
                    gender: p.gender,
                    ojciec_id: validFatherId,
                    matka_id: validMotherId,
                    malzonek_ids: validSpouseIds,
                    key: p.protocolKey,
                    isRoot: p.id === rootId,
                    boxW: Math.max(TREE_CONFIG.NODE_MIN_W, Math.ceil(textWidth(p.name || '')) + 30),
                    generation: 0,
                    x: 0,
                    y: 0
                };
                personMap.set(String(p.id), rec);
            });

            // Pozycjonowanie węzłów
            const allNodes = positionTreeNodes(personMap);
            const { connections, marriages } = findTreeConnections(allNodes);

            if (allNodes.length === 0) {
                container.innerHTML = '<div style="padding: 2rem; text-align: center;">Brak danych do wyświetlenia</div>';
                return;
            }

            // Obliczenie wymiarów
            const xs = allNodes.map(n => [n.x, n.x + n.boxW]).flat();
            const ys = allNodes.map(n => n.y);
            const minX = Math.min(...xs) || 0;
            const maxX = Math.max(...xs) || 100;
            const minY = Math.min(...ys) || 0;
            const maxY = Math.max(...ys) || 100;
            const W = maxX - minX + 2 * TREE_CONFIG.MARGIN;
            const H = maxY - minY + TREE_CONFIG.NODE_HEIGHT + 2 * TREE_CONFIG.MARGIN;

            // Tworzenie SVG
            const svg = d3.create("svg")
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("viewBox", `0 0 ${W} ${H}`)
                .call(
                    d3.zoom()
                        .scaleExtent([0.2, 4])
                        .on("zoom", (e) => g.attr("transform", e.transform))
                );

            const g = svg.append("g")
                .attr("transform", `translate(${-minX + TREE_CONFIG.MARGIN}, ${-minY + TREE_CONFIG.MARGIN})`);

            // Rysowanie połączeń rodzic-dziecko
            g.append("g")
                .selectAll("path")
                .data(connections.filter(c => c.type === "parent-child"))
                .join("path")
                .attr("d", d => {
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
                .attr("y1", ([left, right]) => left.y + TREE_CONFIG.NODE_HEIGHT / 2)
                .attr("x2", ([left, right]) => right.x)
                .attr("y2", ([left, right]) => right.y + TREE_CONFIG.NODE_HEIGHT / 2)
                .attr("stroke", "#e74c3c")
                .attr("stroke-width", 3)
                .attr("stroke-dasharray", "5,5");

            // Kolory pokoleń
            const generationColors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
            const getColor = (generation) => generationColors[Math.abs(generation) % generationColors.length];

            // Rysowanie węzłów
            const ng = g.append("g")
                .selectAll("g")
                .data(allNodes)
                .join("g")
                .attr("transform", d => `translate(${d.x}, ${d.y})`)
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                    // Po kliknięciu pokaż info o osobie
                    console.log('Kliknięto:', d.name);
                });

            // Prostokąty
            ng.append("rect")
                .attr("width", d => d.boxW)
                .attr("height", TREE_CONFIG.NODE_HEIGHT)
                .attr("rx", 8)
                .attr("fill", d => d.gender === 'F' ? "#FFE4E1" : "#E6F3FF")
                .attr("stroke", d => d.isRoot ? "#e74c3c" : getColor(d.generation))
                .attr("stroke-width", d => d.isRoot ? 3 : 2);

            // Ikona płci
            ng.append("text")
                .attr("x", 10)
                .attr("y", 25)
                .style("font-size", "18px")
                .text(d => d.gender === 'F' ? '♀' : '♂')
                .style("fill", d => d.gender === 'F' ? "#FF69B4" : "#4169E1");

            // Tekst - imię i nazwisko
            ng.append("text")
                .attr("x", d => d.boxW / 2)
                .attr("y", TREE_CONFIG.NODE_HEIGHT / 2 - 8)
                .attr("text-anchor", "middle")
                .style("font", "14px 'Segoe UI', sans-serif")
                .style("font-weight", "600")
                .text(d => d.name);

            // Daty
            ng.append("text")
                .attr("x", d => d.boxW / 2)
                .attr("y", TREE_CONFIG.NODE_HEIGHT / 2 + 12)
                .attr("text-anchor", "middle")
                .style("font-size", "12px")
                .style("fill", "#666")
                .text(d => {
                    const b = d.birth, dd = d.death;
                    return b && !dd ? `ur. ${b}` :
                        dd && !b ? `† ${dd}` :
                            b && dd ? `${b} – ${dd}` : "";
                });

            container.appendChild(svg.node());
        };

        const positionTreeNodes = (personMap) => {
            // Najpierw ustal generacje na podstawie relacji rodzic-dziecko
            const setGenerations = () => {
                // Resetuj generacje
                personMap.forEach(p => p.generation = null);

                // Znajdź osoby bez rodziców (najstarsze pokolenie)
                const roots = Array.from(personMap.values()).filter(
                    p => !p.ojciec_id && !p.matka_id
                );

                if (roots.length === 0) {
                    // Jeśli nie ma korzeni, zacznij od najstarszej osoby
                    const oldest = Array.from(personMap.values()).sort((a, b) =>
                        (a.birth || 0) - (b.birth || 0)
                    )[0];
                    if (oldest) {
                        oldest.generation = 0;
                        roots.push(oldest);
                    }
                } else {
                    roots.forEach(r => r.generation = 0);
                }

                // BFS do ustalenia generacji
                const queue = [...roots];
                const visited = new Set(roots.map(r => r.nodeId));

                while (queue.length > 0) {
                    const current = queue.shift();

                    // Znajdź dzieci
                    personMap.forEach(person => {
                        if (!visited.has(person.nodeId)) {
                            if (person.ojciec_id === current.nodeId ||
                                person.matka_id === current.nodeId) {
                                person.generation = current.generation + 1;
                                queue.push(person);
                                visited.add(person.nodeId);
                            }
                        }
                    });

                    // Ustaw małżonka na tym samym poziomie
                    if (current.malzonek_ids && current.malzonek_ids.length > 0) {
                        current.malzonek_ids.forEach(spouseId => {
                            const spouse = personMap.get(spouseId);
                            if (spouse && spouse.generation === null) {
                                spouse.generation = current.generation;
                                if (!visited.has(spouse.nodeId)) {
                                    queue.push(spouse);
                                    visited.add(spouse.nodeId);
                                }
                            }
                        });
                    }
                }

                // Dla osób które nie zostały przypisane
                personMap.forEach(p => {
                    if (p.generation === null) {
                        // Spróbuj ustalić na podstawie małżonka
                        if (p.malzonek_ids && p.malzonek_ids.length > 0) {
                            for (const spouseId of p.malzonek_ids) {
                                const spouse = personMap.get(spouseId);
                                if (spouse && spouse.generation !== null) {
                                    p.generation = spouse.generation;
                                    break;
                                }
                            }
                        }
                        // Jeśli nadal null, ustaw na 0
                        if (p.generation === null) {
                            p.generation = 0;
                        }
                    }
                });
            };

            setGenerations();

            // Grupuj osoby po generacjach
            const generations = new Map();
            personMap.forEach(p => {
                const gen = p.generation;
                if (!generations.has(gen)) {
                    generations.set(gen, []);
                }
                generations.get(gen).push(p);
            });

            // Sortuj generacje
            const sortedGenerations = Array.from(generations.keys()).sort((a, b) => a - b);

            // Pozycjonuj węzły
            const positioned = [];
            let currentY = 0;

            sortedGenerations.forEach(genLevel => {
                const genMembers = generations.get(genLevel);

                // Grupuj małżeństwa razem
                const couples = [];
                const singles = [];
                const processed = new Set();

                genMembers.forEach(person => {
                    if (processed.has(person.nodeId)) return;

                    if (person.malzonek_ids && person.malzonek_ids.length > 0) {
                        // Znajdź małżonka na tym samym poziomie
                        const spouseId = person.malzonek_ids[0];
                        const spouse = genMembers.find(m => m.nodeId === spouseId);

                        if (spouse && !processed.has(spouse.nodeId)) {
                            couples.push([person, spouse]);
                            processed.add(person.nodeId);
                            processed.add(spouse.nodeId);
                        } else if (!spouse) {
                            // Małżonek nie jest na tym poziomie
                            singles.push(person);
                            processed.add(person.nodeId);
                        }
                    } else {
                        singles.push(person);
                        processed.add(person.nodeId);
                    }
                });

                // Pozycjonuj pary i single
                let currentX = TREE_CONFIG.MARGIN;

                // Najpierw pary małżeńskie
                couples.forEach(([person1, person2]) => {
                    // Ustaw pierwszą osobę z pary
                    person1.x = currentX;
                    person1.y = currentY;
                    positioned.push(person1);
                    currentX += person1.boxW + TREE_CONFIG.MARRIAGE_GAP;

                    // Ustaw drugą osobę z pary
                    person2.x = currentX;
                    person2.y = currentY;
                    positioned.push(person2);
                    currentX += person2.boxW + TREE_CONFIG.H_GAP;
                });

                // Potem osoby single
                singles.forEach(person => {
                    person.x = currentX;
                    person.y = currentY;
                    positioned.push(person);
                    currentX += person.boxW + TREE_CONFIG.H_GAP;
                });

                currentY += TREE_CONFIG.NODE_HEIGHT + TREE_CONFIG.V_GAP;
            });

            return positioned;
        };

        return { render };
    })();

    // Sprawdzenie theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        elements.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }

    const findTreeConnections = (allNodes) => {
        const connections = [];
        const marriages = [];
        const nodeById = new Map(allNodes.map(n => [n.nodeId, n]));

        // Znajdź małżeństwa - tylko między osobami na tym samym poziomie
        const processed = new Set();
        allNodes.forEach(person => {
            if (person.malzonek_ids && person.malzonek_ids.length > 0) {
                person.malzonek_ids.forEach(spouseId => {
                    const spouse = nodeById.get(String(spouseId));
                    if (spouse &&
                        person.generation === spouse.generation &&
                        !processed.has(`${person.nodeId}-${spouseId}`) &&
                        !processed.has(`${spouseId}-${person.nodeId}`)) {

                        // Ustaw od lewej do prawej
                        const left = person.x < spouse.x ? person : spouse;
                        const right = person.x < spouse.x ? spouse : person;
                        marriages.push([left, right]);
                        processed.add(`${person.nodeId}-${spouseId}`);
                    }
                });
            }
        });

        // Znajdź połączenia rodzic-dziecko
        allNodes.forEach(child => {
            const father = child.ojciec_id ? nodeById.get(child.ojciec_id) : null;
            const mother = child.matka_id ? nodeById.get(child.matka_id) : null;

            if (!father && !mother) return;

            let sourceX, sourceY;

            if (father && mother) {
                // Oboje rodzice istnieją
                // Sprawdź czy są małżeństwem na tym samym poziomie
                if (father.generation === mother.generation &&
                    Math.abs(father.x - mother.x) < (TREE_CONFIG.H_GAP * 2)) {
                    // Rodzice są obok siebie - linia schodzi z środka między nimi
                    const leftParent = father.x < mother.x ? father : mother;
                    const rightParent = father.x < mother.x ? mother : father;
                    sourceX = (leftParent.x + leftParent.boxW + rightParent.x) / 2;
                    sourceY = leftParent.y + TREE_CONFIG.NODE_HEIGHT;
                } else {
                    // Rodzice nie są obok siebie - użyj środka między nimi
                    sourceX = (father.x + father.boxW / 2 + mother.x + mother.boxW / 2) / 2;
                    sourceY = Math.max(father.y, mother.y) + TREE_CONFIG.NODE_HEIGHT;
                }
            } else {
                // Tylko jeden rodzic
                const parent = father || mother;
                sourceX = parent.x + parent.boxW / 2;
                sourceY = parent.y + TREE_CONFIG.NODE_HEIGHT;
            }

            connections.push({
                type: "parent-child",
                source: { x: sourceX, y: sourceY },
                target: { x: child.x + child.boxW / 2, y: child.y },
                child: child
            });
        });

        return { connections, marriages };
    };



    // INICJALIZACJA
    init();
}); // <-- Tutaj kończy się DOMContentLoaded