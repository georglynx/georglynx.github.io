// ============================================
// GLOBAL STATE
// ============================================

let allGames = [];
let allPlayers = new Set();
const COLOR_POOL = [
    '#008080', '#cf002dff', '#e98935ff', '#AE93E5', '#8b9ad9',
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B195', '#C06C84'
];
let playerColors = {};
let gameColors = {};

// ============================================
// DATA LOADING
// ============================================

async function loadGames() {
    try {
        // Try aggregated file first
        const response = await fetch('mahbles-all.json');
        if (response.ok) {
            allGames = await response.json();
        } else {
            await loadIndividualGames();
        }
        
        await loadPlayerColors();
        await loadGameColors();
        normalizeData();
        validateData();
        discoverPlayers();
        renderAllCharts();
        renderGameHistory();
    } catch (error) {
        console.error('Error loading games:', error);
        useDefaultData();
    }
}

async function loadIndividualGames() {
    const response = await fetch('https://api.github.com/repos/georglynx/georglynx.github.io/contents/mahbles-data');
    const files = await response.json();
    
    const gamePromises = files
        .filter(file => file.name.endsWith('.json'))
        .map(file => fetch(file.download_url).then(r => r.json()));
    
    allGames = await Promise.all(gamePromises);
}

async function loadPlayerColors() {
    try {
        const response = await fetch('player-colors.json');
        if (response.ok) {
            playerColors = await response.json();
        }
    } catch (error) {
        console.log('No player-colors.json found, will use defaults');
    }
}

async function loadGameColors() {
    try {
        const response = await fetch('game-colors.json');
        if (response.ok) {
            gameColors = await response.json();
        }
    } catch (error) {
        console.log('No game-colors.json found, will use defaults');
    }
}

// ============================================
// DATA PROCESSING
// ============================================

function normalizeData() {
    allGames = allGames.map(game => ({
        ...game,
        game: normalizeGameName(game.game),
        changes: game.changes.map(change => ({
            ...change,
            player: normalizePlayerName(change.player)
        }))
    }));
    
    // Sort by date
    allGames.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function normalizePlayerName(name) {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function normalizeGameName(name) {
    return name.toLowerCase().trim();
}

function validateData() {
    const dates = allGames.map(g => g.date);
    const duplicates = dates.filter((date, index) => dates.indexOf(date) !== index);
    if (duplicates.length > 0) {
        console.warn('⚠️ Duplicate game dates found:', duplicates);
    }
}

function discoverPlayers() {
    allGames.forEach(game => {
        game.changes.forEach(change => {
            allPlayers.add(change.player);
        });
    });
}

function getPlayerColor(player) {
    if (playerColors[player]) {
        return playerColors[player];
    }

    const usedColors = Object.values(playerColors);
    const availableColors = COLOR_POOL.filter(c => !usedColors.includes(c));

    if (availableColors.length > 0) {
        playerColors[player] = availableColors[0];
    } else {
        playerColors[player] = '#' + Math.floor(Math.random()*16777215).toString(16);
    }

    return playerColors[player];
}

function getGameColor(game) {
    const normalizedGame = game.toLowerCase();

    if (gameColors[normalizedGame]) {
        return gameColors[normalizedGame];
    }

    // Fallback to HSL color generation if no color is defined
    const uniqueGames = [...new Set(allGames.map(g => g.game))];
    const index = uniqueGames.indexOf(game);
    const hue = (index * 360 / uniqueGames.length);
    return `hsl(${hue}, 70%, 60%)`;
}

// ============================================
// CALCULATE RUNNING TOTALS FROM DELTAS
// ============================================

function calculateRunningTotals() {
    const playerTotals = {};
    const history = [];
    
    // Initialize all players at 0
    allPlayers.forEach(player => {
        playerTotals[player] = 0;
    });
    
    // Process each game chronologically
    allGames.forEach(game => {
        // Apply changes for this game
        game.changes.forEach(change => {
            if (!playerTotals[change.player]) {
                playerTotals[change.player] = 0;
            }
            playerTotals[change.player] += change.change;
        });
        
        // Record snapshot after this game
        history.push({
            date: game.date,
            game: game.game,
            totals: { ...playerTotals }
        });
    });
    
    return history;
}

// ============================================
// CHART 1: CURRENT STANDINGS (BAR)
// ============================================

function renderCurrentStandings() {
    const ctx = document.getElementById('marbleBarChart');
    if (!ctx) return;
    
    const history = calculateRunningTotals();
    if (history.length === 0) return;
    
    const latestTotals = history[history.length - 1].totals;
    
    const standings = Array.from(allPlayers).map(player => ({
        player,
        score: latestTotals[player] || 0,
        color: getPlayerColor(player)
    })).sort((a, b) => b.score - a.score);
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: standings.map(s => s.player),
            datasets: [{
                label: 'Current Mahble Count',
                data: standings.map(s => s.score),
                backgroundColor: standings.map(s => s.color)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: {
                        color: '#e0e0e0',
                        precision: 0,
                        font: { size: 16 }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#e0e0e0',
                        font: { size: 16 }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Current Standings',
                    color: '#e0e0e0',
                    font: { size: 18, weight: 'bold' }
                }
            }
        }
    });
}

// ============================================
// CHART 2: LINE CHART OVER TIME
// ============================================

function renderLineChart() {
    const ctx = document.getElementById('marbleChart');
    if (!ctx) return;
    
    const history = calculateRunningTotals();
    if (history.length === 0) return;
    
    const datasets = Array.from(allPlayers).map(player => {
        const data = history.map(snapshot => snapshot.totals[player] || 0);
        
        return {
            label: player,
            data: data,
            borderColor: getPlayerColor(player),
            tension: 0.1,
            spanGaps: false
        };
    });
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map(h => h.date),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: '#e0e0e0',
                        precision: 0,
                        font: { size: 16 }
                    }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: '#e0e0e0',
                        font: { size: 14 },
                        callback: function(value, index) {
                            const snapshot = history[index];
                            return [snapshot.date, snapshot.game];
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#e0e0e0', font: { size: 14 } }
                },
                title: {
                    display: true,
                    text: 'Mahbles Over Time',
                    color: '#e0e0e0',
                    font: { size: 18, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const snapshot = history[context[0].dataIndex];
                            return `${snapshot.date} - ${snapshot.game}`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// CHART 3: STACKED BAR BY GAME SOURCE
// ============================================

function renderStackedBarChart() {
    const ctx = document.getElementById('marbleStackedChart');
    if (!ctx) return;

    const uniqueGames = [...new Set(allGames.map(g => g.game))];
    const playerGameData = {};
    
    allPlayers.forEach(player => {
        playerGameData[player] = {};
        uniqueGames.forEach(game => {
            playerGameData[player][game] = 0;
        });
    });
    
    allGames.forEach(game => {
        game.changes.forEach(change => {
            playerGameData[change.player][game.game] += change.change;
        });
    });

    const datasets = uniqueGames.map(game => ({
        label: game.charAt(0).toUpperCase() + game.slice(1),
        data: Array.from(allPlayers).map(player => playerGameData[player][game]),
        backgroundColor: getGameColor(game),
        hidden: game === 'reset' // Automatically hide Reset by default
    }));
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from(allPlayers),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: '#e0e0e0',
                        font: { size: 14 }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: '#e0e0e0',
                        precision: 0,
                        font: { size: 14 }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#e0e0e0', font: { size: 12 } }
                },
                title: {
                    display: true,
                    text: 'Mahbles by Game Source',
                    color: '#e0e0e0',
                    font: { size: 18, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            const sign = value >= 0 ? '+' : '';
                            return `${context.dataset.label}: ${sign}${value}`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// GAME HISTORY TIMELINE
// ============================================

function renderGameHistory() {
    const container = document.getElementById('game-history');
    if (!container) return;
    
    const recentGames = allGames.slice(-5).reverse();
    
    let html = '<div class="game-history-list">';
    
    recentGames.forEach(game => {
        html += `
            <div class="game-history-item card">
                <div class="game-history-header">
                    <span class="game-date">📅 ${game.date}</span>
                    <span class="game-name">${game.game}</span>
                </div>
                <div class="game-history-results">
                    ${generateGameResults(game)}
                </div>
                ${game.notes ? `<div class="game-notes">📝 ${game.notes}</div>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    
    if (allGames.length > 5) {
        html += `
            <button id="show-all-games" class="btn-secondary" onclick="toggleAllGames()">
                Show All ${allGames.length} Games
            </button>
            <div id="all-games-container" style="display: none;"></div>
        `;
    }
    
    container.innerHTML = html;
}

function generateGameResults(game) {
    let html = '';
    
    game.changes.forEach(change => {
        const changeValue = change.change;
        let changeIcon = '➡️';
        let changeClass = 'no-change';
        
        if (changeValue > 0) {
            changeIcon = '⬆️';
            changeClass = 'positive-change';
        } else if (changeValue < 0) {
            changeIcon = '⬇️';
            changeClass = 'negative-change';
        }
        
        const sign = changeValue > 0 ? '+' : '';
        html += `<span class="game-result ${changeClass}">${change.player} ${sign}${changeValue} ${changeIcon}</span>`;
    });
    
    return html;
}

function toggleAllGames() {
    const button = document.getElementById('show-all-games');
    const container = document.getElementById('all-games-container');
    
    if (container.style.display === 'none') {
        const olderGames = allGames.slice(0, -5).reverse();
        let html = '<div class="game-history-list">';
        
        olderGames.forEach(game => {
            html += `
                <div class="game-history-item card">
                    <div class="game-history-header">
                        <span class="game-date">📅 ${game.date}</span>
                        <span class="game-name">${game.game}</span>
                    </div>
                    <div class="game-history-results">
                        ${generateGameResults(game)}
                    </div>
                    ${game.notes ? `<div class="game-notes">📝 ${game.notes}</div>` : ''}
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
        container.style.display = 'block';
        button.textContent = 'Show Less';
    } else {
        container.style.display = 'none';
        button.textContent = `Show All ${allGames.length} Games`;
    }
}

// ============================================
// RENDER ALL CHARTS
// ============================================

function renderAllCharts() {
    renderCurrentStandings();
    renderLineChart();
    renderStackedBarChart();
}

// ============================================
// FALLBACK DATA
// ============================================

function useDefaultData() {
    console.error('Failed to load game data. Please check that mahbles-data files exist.');
    allGames = [];
    allPlayers = new Set();
    
    const container = document.getElementById('game-history');
    if (container) {
        container.innerHTML = `
            <div class="card" style="text-align: center; color: #ff6b6b;">
                <h3>⚠️ Unable to Load Game Data</h3>
                <p>Could not find any game files. Please make sure mahbles-data folder exists.</p>
            </div>
        `;
    }
}

// ============================================
// INITIALIZE
// ============================================

document.addEventListener('DOMContentLoaded', loadGames);
