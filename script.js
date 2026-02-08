// ============================================
// MAHBLES COUNTER - DYNAMIC SYSTEM
// ============================================

// Color pool for new players
const COLOR_POOL = [
    '#008080', '#cf002dff', '#e98935ff', '#AE93E5', '#8b9ad9',
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'
];

let playerColors = {};
let allGames = [];
let allPlayers = new Set();

// ============================================
// DATA LOADING
// ============================================

async function loadMahblesData() {
    try {
        // Load player colors
        await loadPlayerColors();
        
        // Load all game data
        await loadAllGames();
        
        // Render all visualizations
        renderAllCharts();
        renderGameHistory();
        
    } catch (error) {
        console.error('Error loading Mahbles data:', error);
        // Fallback to default data
        useDefaultData();
    }
}

async function loadPlayerColors() {
    try {
        const response = await fetch('player-colors.json');
        playerColors = await response.json();
    } catch (error) {
        console.warn('Could not load player colors, using defaults');
        playerColors = {};
    }
}

async function loadAllGames() {
    try {
        // Try to load aggregated file first (faster)
        const response = await fetch('mahbles-all.json');
        if (response.ok) {
            allGames = await response.json();
        } else {
            // Fallback: load individual files from GitHub API
            await loadIndividualGames();
        }
        
        // Sort by date
        allGames.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Validate for duplicate dates
        validateDuplicateDates();
        
        // Discover all players
        discoverPlayers();
        
    } catch (error) {
        console.error('Error loading games:', error);
        throw error;
    }
}

async function loadIndividualGames() {
    // Fetch list of files from GitHub API
    const response = await fetch('https://api.github.com/repos/georglynx/georglynx.github.io/contents/mahbles-data');
    const files = await response.json();
    
    // Fetch each game file
    const gamePromises = files
        .filter(file => file.name.endsWith('.json'))
        .map(file => fetch(file.download_url).then(r => r.json()));
    
    allGames = await Promise.all(gamePromises);
}

function discoverPlayers() {
    allPlayers.clear();
    allGames.forEach(game => {
        game.results.forEach(result => {
            const normalizedName = normalizePlayerName(result.player);
            allPlayers.add(normalizedName);
            result.player = normalizedName; // Update in place
        });
    });
}

function validateDuplicateDates() {
    const dates = allGames.map(g => g.date);
    const duplicates = dates.filter((date, index) => dates.indexOf(date) !== index);
    
    if (duplicates.length > 0) {
        console.warn('⚠️ Duplicate game dates found:', duplicates);
    }
}

// ============================================
// NORMALIZATION & UTILITIES
// ============================================

function normalizePlayerName(name) {
    // Capitalize first letter of each word, trim whitespace
    return name.trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function normalizeGameName(name) {
    // Lowercase and trim
    return name.toLowerCase().trim();
}

function getPlayerColor(playerName) {
    const normalized = normalizePlayerName(playerName);
    
    if (playerColors[normalized]) {
        return playerColors[normalized];
    }
    
    // Assign new color from pool
    const usedColors = Object.values(playerColors);
    const availableColors = COLOR_POOL.filter(c => !usedColors.includes(c));
    
    if (availableColors.length > 0) {
        playerColors[normalized] = availableColors[0];
    } else {
        // Fallback: generate random color
        playerColors[normalized] = '#' + Math.floor(Math.random()*16777215).toString(16);
    }
    
    return playerColors[normalized];
}

function getPlayerFirstGameIndex(playerName) {
    return allGames.findIndex(game => 
        game.results.some(r => r.player === playerName)
    );
}

function getPlayerScoreAtGame(playerName, gameIndex) {
    const game = allGames[gameIndex];
    const result = game.results.find(r => r.player === playerName);
    return result ? result.score : null;
}

// Build complete score history for a player
function buildPlayerHistory(playerName) {
    const history = [];
    const firstGameIndex = getPlayerFirstGameIndex(playerName);
    
    allGames.forEach((game, index) => {
        if (index < firstGameIndex) {
            // Player hasn't joined yet - don't show on chart
            history.push(null);
        } else {
            const score = getPlayerScoreAtGame(playerName, index);
            if (score !== null) {
                history.push(score);
            } else {
                // Player didn't play this game - carry forward last score
                history.push(history[history.length - 1] || 0);
            }
        }
    });
    
    return history;
}

// ============================================
// CHART 1: CURRENT STANDINGS (BAR CHART)
// ============================================

function renderCurrentStandings(chartData) {
    const barCtx = document.getElementById('marbleBarChart');
    if (!barCtx) return;
    
    // Get current scores (last game)
    const lastGame = allGames[allGames.length - 1];
    let standings = lastGame.results.map(result => ({
        player: result.player,
        score: result.score,
        color: getPlayerColor(result.player)
    }));
    
    // Sort by score descending
    standings.sort((a, b) => b.score - a.score);
    
    new Chart(barCtx, {
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
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
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
// CHART 2: LINE CHART (OVER TIME)
// ============================================

function renderLineChart() {
    const ctx = document.getElementById('marbleChart');
    if (!ctx) return;
    
    const dates = allGames.map(g => g.date);
    const games = allGames.map(g => normalizeGameName(g.game));
    
    const datasets = Array.from(allPlayers).map(playerName => ({
        label: playerName,
        data: buildPlayerHistory(playerName),
        borderColor: getPlayerColor(playerName),
        backgroundColor: getPlayerColor(playerName) + '20',
        tension: 0.1,
        spanGaps: false // Don't connect across null values
    }));
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
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
                        font: { size: 12 },
                        callback: function(value, index) {
                            // Show date and game name
                            return [dates[index], games[index]];
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
                            const index = context[0].dataIndex;
                            return `${dates[index]} - ${allGames[index].game}`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// CHART 3: STACKED BAR (BY GAME SOURCE)
// ============================================

function renderStackedBarChart() {
    const stackedCtx = document.getElementById('marbleStackedChart');
    if (!stackedCtx) return;
    
    // Get unique games
    const uniqueGames = [...new Set(allGames.map(g => normalizeGameName(g.game)))];
    
    // Calculate Mahbles earned from each game type per player
    const playerGameData = {};
    
    Array.from(allPlayers).forEach(player => {
        playerGameData[player] = {};
        uniqueGames.forEach(game => {
            playerGameData[player][game] = 0;
        });
    });
    
    // Calculate earned Mahbles per game
    allGames.forEach((game, index) => {
        const prevGame = index > 0 ? allGames[index - 1] : null;
        const normalizedGame = normalizeGameName(game.game);
        
        game.results.forEach(result => {
            const player = result.player;
            const currentScore = result.score;
            
            if (prevGame) {
                const prevResult = prevGame.results.find(r => r.player === player);
                const prevScore = prevResult ? prevResult.score : 0;
                const change = currentScore - prevScore;
                
                playerGameData[player][normalizedGame] += change;
            } else {
                // First game - all Mahbles are from this game
                playerGameData[player][normalizedGame] = currentScore;
            }
        });
    });
    
    // Generate random colors for each game
    const gameColors = {};
    uniqueGames.forEach((game, index) => {
        gameColors[game] = COLOR_POOL[index % COLOR_POOL.length];
    });
    
    // Build datasets (one per game type)
    const datasets = uniqueGames.map(game => ({
        label: game.charAt(0).toUpperCase() + game.slice(1),
        data: Array.from(allPlayers).map(player => playerGameData[player][game]),
        backgroundColor: gameColors[game]
    }));
    
    new Chart(stackedCtx, {
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
                            return `${context.dataset.label}: ${value > 0 ? '+' : ''}${value}`;
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
    
    // Show last 5 games by default
    const recentGames = allGames.slice(-5).reverse();
    
    let html = '<div class="game-history-list">';
    
    recentGames.forEach((game, index) => {
        const prevGame = allGames[allGames.length - 5 + (4 - index) - 1];
        
        html += `
            <div class="game-history-item card">
                <div class="game-history-header">
                    <span class="game-date">📅 ${game.date}</span>
                    <span class="game-name">${game.game}</span>
                </div>
                <div class="game-history-results">
                    ${generateGameResults(game, prevGame)}
                </div>
                ${game.notes ? `<div class="game-notes">📝 ${game.notes}</div>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    
    // Add "Show All Games" button if there are more than 5
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

function generateGameResults(game, prevGame) {
    let html = '';
    
    // Calculate changes
    game.results.forEach(result => {
        const player = result.player;
        const currentScore = result.score;
        
        let change = 0;
        let prevScore = 0;
        
        if (prevGame) {
            const prevResult = prevGame.results.find(r => r.player === player);
            prevScore = prevResult ? prevResult.score : 0;
            change = currentScore - prevScore;
        } else {
            // First game
            change = currentScore;
        }
        
        let changeIcon = '➡️';
        let changeClass = 'no-change';
        
        if (change > 0) {
            changeIcon = '⬆️';
            changeClass = 'positive-change';
        } else if (change < 0) {
            changeIcon = '⬇️';
            changeClass = 'negative-change';
        }
        
        html += `
            <div class="game-result ${changeClass}">
                <span class="player-name">${player}</span>
                <span class="player-change">${change > 0 ? '+' : ''}${change} ${changeIcon}</span>
            </div>
        `;
    });
    
    return html;
}

function toggleAllGames() {
    const button = document.getElementById('show-all-games');
    const container = document.getElementById('all-games-container');
    
    if (container.style.display === 'none') {
        // Show ONLY the older games (exclude the recent 5 already shown)
        const olderGames = allGames.slice(0, -5).reverse();
        let html = '<div class="game-history-list">';
        
        olderGames.forEach((game, index) => {
            const actualIndex = allGames.length - 6 - index; // Start from 6th last game
            const prevGame = actualIndex > 0 ? allGames[actualIndex - 1] : null;
            
            html += `
                <div class="game-history-item card">
                    <div class="game-history-header">
                        <span class="game-date">📅 ${game.date}</span>
                        <span class="game-name">${game.game}</span>
                    </div>
                    <div class="game-history-results">
                        ${generateGameResults(game, prevGame)}
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
        // Hide older games
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
    
    // Show error message to user
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
// INITIALIZE ON PAGE LOAD
// ============================================

document.addEventListener('DOMContentLoaded', loadMahblesData);
