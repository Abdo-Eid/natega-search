const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');

// 🔁 Reset database file
if (fs.existsSync('./students.db')) {
    fs.unlinkSync('./students.db');
}

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
    // ⚡ Speed settings
    db.run('PRAGMA synchronous = OFF');
    db.run('PRAGMA journal_mode = MEMORY');

    // 📦 Schema setup
    db.run(`CREATE TABLE students (
        seating_no TEXT PRIMARY KEY,
        arabic_name TEXT,
        total_degree REAL,
        arabic_name_normalized TEXT
    )`);

    db.run(`CREATE INDEX idx_normalized_name ON students(arabic_name_normalized)`);

    // 🚀 Start import
    console.log('Importing CSV...');
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`INSERT INTO students (seating_no, arabic_name, total_degree, arabic_name_normalized) VALUES (?, ?, ?, ?)`);

    fs.createReadStream('students.csv')
        .pipe(csv())
        .on('data', (data) => {
            try {
                const normalized = normalizeArabicName(data.arabic_name);
                stmt.run([
                    data.seating_no,
                    data.arabic_name,
                    parseFloat(data.total_degree),
                    normalized
                ]);
            } catch (e) {
                console.error('Row error:', e.message);
            }
        })
        .on('end', () => {
            stmt.finalize();
            db.run('COMMIT', () => {
                console.log('CSV import completed.');
                db.close(); // ✅ Exit cleanly
            });
        });
});
