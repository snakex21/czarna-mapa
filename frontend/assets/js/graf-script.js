/**
 * Plik: graf-script.js
 * Opis: System wizualizacji grafu powiązań protokołów katastralnych.
 *       Wykorzystuje bibliotekę Vis.js do renderowania interaktywnego grafu.
 */

// Tauri API bridge
async function invoke(cmd, args = {}) {
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        return await window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    console.warn('[FALLBACK] invoke:', cmd, args);
    return null;
}

/* ==========================================================================
   KLASA GŁÓWNA - MENEDŻER GRAFU
   ========================================================================== */
class GraphManager {
    /**
     * Konstruktor - inicjalizacja właściwości i uruchomienie systemu
     */
    constructor() {
        this.network = null;
        this.allNodes = null;
        this.allEdges = null;
        this.physicsEnabled = true;
        this.currentLayout = 'physics';
        this.selectedNode = null;
        this.highlightedNodes = new Set();
        
        this.init();
    }
    
    /* ==========================================================================
       SEKCJA INICJALIZACJI
       ========================================================================== */
    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.initializeTooltips();
        this.updateStats();
        this.hideLoading();
    }
    
    /**
     * Ładowanie danych grafu z serwera
     */
    async loadData() {
        const loadingOverlay = document.getElementById('loading-overlay');
        const progressBar = loadingOverlay.querySelector('.progress-bar');
        
        try {
            // Symulacja postępu ładowania
            progressBar.style.width = '30%';
            
            const data = await invoke('pobierz_dane_grafu');
            progressBar.style.width = '90%';
            
            this.createNetwork(data);
            progressBar.style.width = '100%';
            
        } catch (error) {
            console.error('Błąd ładowania:', error);
            this.showError();
        }
    }
    
    /* ==========================================================================
       TWORZENIE I KONFIGURACJA SIECI
       ========================================================================== */
    /**
     * Tworzenie instancji grafu Vis.js z pełną konfiguracją
     */
    createNetwork(data) {
        const container = document.getElementById('mynetwork');
        
        // Przetwarzanie węzłów - dodanie metadanych
        const processedNodes = data.nodes.map(node => {
            const connections = data.edges.filter(
                edge => edge.from === node.id || edge.to === node.id
            ).length;
            
            return {
                ...node,
                value: connections, // Wielkość węzła zależna od połączeń
                title: undefined, // Wyłączenie domyślnego tooltip
                group: this.getNodeGroup(connections)
            };
        });
        
        this.allNodes = new vis.DataSet(processedNodes);
        this.allEdges = new vis.DataSet(data.edges);
        
        const graphData = {
            nodes: this.allNodes,
            edges: this.allEdges
        };
        
        // Konfiguracja opcji wizualizacji
        const options = {
            nodes: {
                shape: 'dot',
                scaling: {
                    min: 10,
                    max: 30,
                    label: {
                        min: 8,
                        max: 14,
                        drawThreshold: 5,
                        maxVisible: 20
                    }
                },
                font: {
                    size: 12,
                    face: 'Inter',
                    color: '#ffffff',
                    strokeWidth: 3,
                    strokeColor: '#1a1a2e'
                },
                borderWidth: 2,
                borderWidthSelected: 3,
                color: {
                    border: 'rgba(255,255,255,0.3)',
                    background: '#4a90e2',
                    highlight: {
                        border: '#ffd700',
                        background: '#ff6b6b'
                    },
                    hover: {
                        border: '#ffffff',
                        background: '#5aa3f0'
                    }
                },
                shadow: {
                    enabled: true,
                    color: 'rgba(0,0,0,0.5)',
                    size: 10,
                    x: 2,
                    y: 2
                }
            },
            edges: {
                width: 1,
                smooth: {
                    type: 'dynamic',
                    roundness: 0.5
                },
                color: {
                    color: 'rgba(255,255,255,0.2)',
                    highlight: '#ffd700',
                    hover: 'rgba(255,255,255,0.5)'
                },
                selectionWidth: 2,
                hoverWidth: 2
            },
            groups: {
                normal: {
                    color: {
                        background: '#4a90e2',
                        border: 'rgba(255,255,255,0.3)'
                    }
                },
                hub: {
                    color: {
                        background: '#ff6b6b',
                        border: '#ffffff'
                    },
                    shape: 'star',
                    size: 25
                },
                cluster: {
                    color: {
                        background: '#4caf50',
                        border: '#ffffff'
                    }
                }
            },
            physics: {
                enabled: true,
                barnesHut: {
                    gravitationalConstant: -2000,
                    centralGravity: 0.3,
                    springLength: 95,
                    springConstant: 0.04,
                    damping: 0.09,
                    avoidOverlap: 0.1
                },
                stabilization: {
                    enabled: true,
                    iterations: 1000,
                    updateInterval: 100,
                    onlyDynamicEdges: false,
                    fit: true
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                hideEdgesOnDrag: false,
                hideEdgesOnZoom: false,
                navigationButtons: true,
                keyboard: {
                    enabled: true,
                    speed: {x: 10, y: 10, zoom: 0.02}
                }
            }
        };
        
        this.network = new vis.Network(container, graphData, options);
        this.setupNetworkEvents();
    }
    
    /**
     * Określenie grupy węzła na podstawie liczby połączeń
     */
    getNodeGroup(connections) {
        if (connections > 5) return 'hub';
        if (connections > 3) return 'cluster';
        return 'normal';
    }
    
    /* ==========================================================================
       OBSŁUGA ZDARZEŃ SIECI
       ========================================================================== */
    /**
     * Konfiguracja zdarzeń interakcji z grafem
     */
    setupNetworkEvents() {
        // Podwójne kliknięcie - przejście do protokołu
        this.network.on('doubleClick', (params) => {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                window.location.href = `../wlasciciele/protokol.html?ownerId=${nodeId}`;
            }
        });
        
        // Pojedyncze kliknięcie - wyróżnienie węzła
        this.network.on('click', (params) => {
            if (params.nodes.length > 0) {
                this.selectNode(params.nodes[0]);
            } else {
                this.deselectAll();
            }
        });
        
        // Hover - podświetlenie połączeń
        this.network.on('hoverNode', (params) => {
            this.highlightConnections(params.node);
        });
        
        this.network.on('blurNode', () => {
            this.clearHighlight();
        });
        
        // Monitorowanie stabilizacji
        this.network.on('stabilizationProgress', (params) => {
            const progress = params.iterations / params.total * 100;
            console.log(`Stabilizacja: ${Math.round(progress)}%`);
        });
        
        this.network.once('stabilizationIterationsDone', () => {
            console.log('Graf ustabilizowany');
        });
    }
    
    /* ==========================================================================
       METODY MANIPULACJI WĘZŁAMI
       ========================================================================== */
    /**
     * Zaznaczenie węzła z animacją fokusa
     */
    selectNode(nodeId) {
        this.selectedNode = nodeId;
        const node = this.allNodes.get(nodeId);
        document.getElementById('selected-node').textContent = 
            node.label.replace(/\n/g, ' ');
        
        // Animowane przybliżenie
        this.network.focus(nodeId, {
            scale: 1.5,
            animation: {
                duration: 1000,
                easingFunction: 'easeInOutCubic'
            }
        });
        
        this.highlightConnections(nodeId);
    }
    
    /**
     * Podświetlenie połączonych węzłów i krawędzi
     */
    highlightConnections(nodeId) {
        const connectedNodes = this.network.getConnectedNodes(nodeId);
        const connectedEdges = this.network.getConnectedEdges(nodeId);
        
        // Modyfikacja węzłów - przyciemnienie niepołączonych
        const updateNodes = this.allNodes.get().map(node => ({
            id: node.id,
            color: {
                background: connectedNodes.includes(node.id) || node.id === nodeId 
                    ? null 
                    : 'rgba(100,100,100,0.3)',
                border: connectedNodes.includes(node.id) || node.id === nodeId 
                    ? null 
                    : 'rgba(100,100,100,0.3)'
            }
        }));
        
        this.allNodes.update(updateNodes);
        
        // Modyfikacja krawędzi - podświetlenie aktywnych
        const updateEdges = this.allEdges.get().map(edge => ({
            id: edge.id,
            color: connectedEdges.includes(edge.id) 
                ? { color: '#ffd700' } 
                : { color: 'rgba(100,100,100,0.1)' },
            width: connectedEdges.includes(edge.id) ? 2 : 0.5
        }));
        
        this.allEdges.update(updateEdges);
    }
    
    /**
     * Czyszczenie podświetleń
     */
    clearHighlight() {
        const updateNodes = this.allNodes.get().map(node => ({
            id: node.id,
            color: null
        }));
        this.allNodes.update(updateNodes);
        
        const updateEdges = this.allEdges.get().map(edge => ({
            id: edge.id,
            color: null,
            width: null
        }));
        this.allEdges.update(updateEdges);
    }
    
    /**
     * Odznaczenie wszystkich węzłów
     */
    deselectAll() {
        this.selectedNode = null;
        document.getElementById('selected-node').textContent = '-';
        this.clearHighlight();
    }
    
    /* ==========================================================================
       OBSŁUGA INTERFEJSU UŻYTKOWNIKA
       ========================================================================== */
    /**
     * Inicjalizacja wszystkich kontrolek i interakcji UI
     */
    setupEventListeners() {
        // === PANEL KONTROLNY ===
        const panel = document.querySelector('.control-panel');
        const toggleBtn = document.querySelector('.panel-toggle');
        const expandHandle = document.querySelector('.panel-expand-handle');

        const collapsePanel = () => {
            panel.classList.add('collapsed');
            toggleBtn.querySelector('i').className = 'fas fa-chevron-right';
            expandHandle.style.display = 'block';
        };

        const expandPanel = () => {
            panel.classList.remove('collapsed');
            toggleBtn.querySelector('i').className = 'fas fa-chevron-left';
            expandHandle.style.display = 'none';
        };

        toggleBtn.addEventListener('click', collapsePanel);
        expandHandle.addEventListener('click', expandPanel);

        // Mobile panel toggle
        const mobilePanelToggle = document.getElementById('mobile-panel-toggle');
        if (mobilePanelToggle) {
            mobilePanelToggle.addEventListener('click', (e) => {
                e.preventDefault();
                if (panel.classList.contains('mobile-open')) {
                    collapsePanel();
                    panel.classList.remove('mobile-open');
                } else {
                    expandPanel();
                    panel.classList.add('mobile-open');
                }
            });
        }

        // Collapse panel by default on mobile
        if (window.innerWidth <= 768) {
            collapsePanel();
        }
        
        // === WYSZUKIWARKA ===
        const searchInput = document.getElementById('search-input');
        const clearBtn = document.getElementById('clear-search');
        const searchResults = document.getElementById('search-results');
        
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            clearBtn.style.display = term ? 'block' : 'none';
            
            searchResults.innerHTML = '';
            if (term.length < 2) return;
            
            const matches = this.allNodes.get({
                filter: node => node.label.toLowerCase().includes(term)
            }).slice(0, 10);
            
            matches.forEach(node => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <i class="fas fa-file-alt"></i>
                    <span>${node.label.replace(/\n/g, ' ')}</span>
                    <span class="connections">${node.value} połączeń</span>
                `;
                li.addEventListener('click', () => {
                    this.selectNode(node.id);
                    searchInput.value = '';
                    searchResults.innerHTML = '';
                    clearBtn.style.display = 'none';
                });
                searchResults.appendChild(li);
            });
        });
        
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchResults.innerHTML = '';
            clearBtn.style.display = 'none';
        });
        
        // === PRZYCISKI KONTROLNE ===
        document.getElementById('reset-view-btn').addEventListener('click', () => {
            this.network.fit({
                animation: {
                    duration: 1000,
                    easingFunction: 'easeInOutCubic'
                }
            });
            this.deselectAll();
        });
        
        document.getElementById('toggle-physics-btn').addEventListener('click', () => {
            this.physicsEnabled = !this.physicsEnabled;
            this.network.setOptions({ physics: { enabled: this.physicsEnabled } });
            document.getElementById('physics-status').textContent = 
                this.physicsEnabled ? 'ON' : 'OFF';
        });
        
        document.getElementById('layout-btn').addEventListener('click', () => {
            this.changeLayout();
        });
        
        document.getElementById('fullscreen-btn').addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        
        // === FILTRY ===
        document.getElementById('filter-isolated').addEventListener('change', (e) => {
            this.filterIsolatedNodes(e.target.checked);
        });
        
        document.getElementById('highlight-clusters').addEventListener('change', (e) => {
            this.highlightClusters(e.target.checked);
        });
        
        const minConnections = document.getElementById('min-connections');
        const connectionsValue = document.getElementById('connections-value');
        
        minConnections.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            connectionsValue.textContent = value;
            this.filterByConnections(value);
        });
    }
    
    /* ==========================================================================
       METODY UKŁADU I FILTROWANIA
       ========================================================================== */
    /**
     * Przełączanie między układami grafu
     */
    changeLayout() {
        const layouts = ['physics', 'hierarchical', 'circular'];
        const currentIndex = layouts.indexOf(this.currentLayout);
        this.currentLayout = layouts[(currentIndex + 1) % layouts.length];
        
        let options = {};
        
        switch(this.currentLayout) {
            case 'hierarchical':
                options = {
                    layout: {
                        hierarchical: {
                            direction: 'UD',
                            sortMethod: 'hubsize',
                            nodeSpacing: 150,
                            levelSeparation: 150
                        }
                    },
                    physics: false
                };
                break;
            case 'circular':
                // Ręczne układanie w okręgu
                const nodes = this.allNodes.get();
                const positions = {};
                const radius = 500;
                nodes.forEach((node, index) => {
                    const angle = (2 * Math.PI * index) / nodes.length;
                    positions[node.id] = {
                        x: radius * Math.cos(angle),
                        y: radius * Math.sin(angle)
                    };
                });
                this.network.once('beforeDrawing', () => {
                    nodes.forEach(node => {
                        this.network.moveNode(node.id, positions[node.id].x, positions[node.id].y);
                    });
                });
                options = { physics: false };
                break;
            default:
                options = {
                    layout: { hierarchical: false },
                    physics: { enabled: true }
                };
        }
        
        this.network.setOptions(options);
        this.network.redraw();
    }
    
    /**
     * Filtrowanie węzłów bez połączeń
     */
    filterIsolatedNodes(hide) {
        const nodes = this.allNodes.get();
        const updates = [];
        
        nodes.forEach(node => {
            if (node.value === 0) {
                updates.push({
                    id: node.id,
                    hidden: hide
                });
            }
        });
        
        this.allNodes.update(updates);
    }
    
    /**
     * Podświetlenie klastrów w grafie
     */
    highlightClusters(highlight) {
        if (highlight) {
            // Wykrywanie społeczności
            const clusters = this.detectCommunities();
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
            
            clusters.forEach((cluster, index) => {
                const color = colors[index % colors.length];
                const updates = cluster.map(nodeId => ({
                    id: nodeId,
                    color: { background: color }
                }));
                this.allNodes.update(updates);
            });
        } else {
            // Przywrócenie oryginalnych kolorów
            const updates = this.allNodes.get().map(node => ({
                id: node.id,
                color: null
            }));
            this.allNodes.update(updates);
        }
    }
    
    /**
     * Algorytm wykrywania społeczności
     */
    detectCommunities() {
        const visited = new Set();
        const communities = [];
        
        this.allNodes.forEach(node => {
            if (!visited.has(node.id)) {
                const community = [];
                const queue = [node.id];
                
                while (queue.length > 0) {
                    const current = queue.shift();
                    if (!visited.has(current)) {
                        visited.add(current);
                        community.push(current);
                        
                        const neighbors = this.network.getConnectedNodes(current);
                        neighbors.forEach(neighbor => {
                            if (!visited.has(neighbor)) {
                                queue.push(neighbor);
                            }
                        });
                    }
                }
                
                if (community.length > 1) {
                    communities.push(community);
                }
            }
        });
        
        return communities;
    }
    
    /**
     * Filtrowanie według minimalnej liczby połączeń
     */
    filterByConnections(minConnections) {
        const nodes = this.allNodes.get();
        const updates = [];
        
        nodes.forEach(node => {
            updates.push({
                id: node.id,
                hidden: node.value < minConnections
            });
        });
        
        this.allNodes.update(updates);
    }
    
    /* ==========================================================================
       METODY POMOCNICZE
       ========================================================================== */
    /**
     * Inicjalizacja tooltipów
     */
    initializeTooltips() {
        const tooltip = document.getElementById('node-tooltip');
        
        this.network.on('hoverNode', (params) => {
            const node = this.allNodes.get(params.node);
            const position = this.network.canvasToDOM(
                this.network.getPosition(params.node)
            );
            
            tooltip.innerHTML = `
                <strong>${node.label.replace(/\n/g, ' ')}</strong><br>
                Połączeń: ${node.value}<br>
                ID: ${node.id}
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = position.x + 10 + 'px';
            tooltip.style.top = position.y - 30 + 'px';
        });
        
        this.network.on('blurNode', () => {
            tooltip.style.display = 'none';
        });
    }
    
    /**
     * Aktualizacja statystyk w panelu
     */
    updateStats() {
        document.getElementById('total-nodes').textContent = this.allNodes.length;
        document.getElementById('total-edges').textContent = this.allEdges.length;
    }
    
    /**
     * Ukrycie ekranu ładowania
     */
    hideLoading() {
        setTimeout(() => {
            document.getElementById('loading-overlay').style.display = 'none';
        }, 500);
    }
    
    /**
     * Wyświetlenie komunikatu błędu
     */
    showError() {
        const overlay = document.getElementById('loading-overlay');
        overlay.querySelector('.loading-content').innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Nie udało się załadować grafu</p>
                <button onclick="location.reload()">Spróbuj ponownie</button>
            </div>
        `;
    }
}

/* ==========================================================================
   INICJALIZACJA APLIKACJI
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    new GraphManager();
});