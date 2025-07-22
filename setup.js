const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');
const https = require('https');
const { pipeline } = require('stream');

// 🔁 Reset database file
if (fs.existsSync('./students.db')) {
    fs.unlinkSync('./students.db');
}

const remoteCSV = 'https://github.com/Abdo-Eid/natega-search/releases/download/1.0.0/students.csv';
const db = new sqlite3.Database('./students.db');

function normalizeArabicName(name) {
    return name
        .replace(/[\u064B-\u065F]/g, '')      // Remove diacritics
        .replace(/\u0640/g, '')               // Remove tatweel
        .replace(/[أإآ]/g, 'ا')                // Normalize alifs
        .replace(/[ؤئء]/g, 'ء')               // Normalize hamzat
        .replace(/[ة]/g, 'ه')                 // Ta marbuta to ha
        .replace(/[ى]/g, 'ي')                 // Alif maqsurah to ya
        .replace(/[^\u0621-\u063A\u0640-\u0652 ]/g, '') // Only Arabic letters/spaces
        .replace(/\s+/g, ' ')                 // Collapse multiple spaces
        .trim();
}

db.serialize(() => {
    db.run('PRAGMA synchronous = OFF');
    db.run('PRAGMA journal_mode = MEMORY');

    db.run(`CREATE TABLE students (
        seating_no TEXT PRIMARY KEY,
        arabic_name TEXT,
        total_degree REAL,
        arabic_name_normalized TEXT
    )`);

    db.run(`CREATE INDEX idx_normalized_name ON students(arabic_name_normalized)`);

    const stmt = db.prepare(`INSERT INTO students VALUES (?, ?, ?, ?)`);

    console.log('Downloading and importing...');

    db.run('BEGIN TRANSACTION');

    https.get(remoteCSV, (res) => {
        if (res.statusCode !== 200) {
            console.error(`Failed to download CSV: ${res.statusCode}`);
            res.resume();
            return;
        }

        res
            .pipe(csv())
            .on('data', (row) => {
                try {
                    const norm = normalizeArabicName(row.arabic_name);
                    stmt.run([
                        row.seating_no,
                        row.arabic_name,
                        parseFloat(row.total_degree),
                        norm
                    ]);
                } catch (e) {
                    console.error('Row error:', e.message);
                }
            })
            .on('end', () => {
                stmt.finalize();
                db.run('COMMIT', () => {
                    console.log('CSV import completed.');
                    db.close();
                });
            })
            .on('error', (err) => {
                console.error('Stream error:', err.message);
            });
    }).on('error', (err) => {
        console.error('Request error:', err.message);
    });
});
