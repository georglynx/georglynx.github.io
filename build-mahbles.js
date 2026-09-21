// Bundles every mahbles-data/*.json file into a single mahbles-all.json.
//
// Netlify runs this at deploy time (see netlify.toml), so the Mahbles page
// makes one request for its data instead of ~60 to the GitHub API.
// For a local preview run:  node build-mahbles.js

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'mahbles-data');
const outFile = path.join(__dirname, 'mahbles-all.json');

const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();

const games = files.map(file => {
    try {
        return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    } catch (err) {
        throw new Error(`mahbles-data/${file} is not valid JSON: ${err.message}`);
    }
});

fs.writeFileSync(outFile, JSON.stringify(games));
console.log(`Wrote mahbles-all.json (${games.length} games from ${files.length} files)`);
