const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // use node-fetch v2.x
const sqlite3 = require("sqlite3").verbose();
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.json());

const db = new sqlite3.Database("./students.db");

function normalizeArabicName(name) {
    return name
        .replace(/[\u064B-\u065F]/g, "") // diacritics
        .replace(/\u0640/g, "") // tatweel
        .replace(/[أإآ]/g, "ا")
        .replace(/[ؤئء]/g, "ء")
        .replace(/[ة]/g, "ه")
        .replace(/[ى]/g, "ي")
        .replace(/[^\u0621-\u063A\u0640-\u0652 ]/g, "") // non-Arabic
        .replace(/\s+/g, " ")
        .trim();
}

app.get("/search", (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    const normalizedQuery = normalizeArabicName(query);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return res.json([]);

    const fuzzyPattern = `%${terms.join("%")}%`;
    const startsWith = `${terms[0]}%`;

    const sql = `SELECT arabic_name, seating_no, total_degree 
               FROM students 
               WHERE arabic_name_normalized LIKE ? 
               ORDER BY 
                 CASE 
                   WHEN arabic_name_normalized LIKE ? THEN 0
                   WHEN arabic_name_normalized LIKE ? THEN 1
                   ELSE 2
                 END,
                 LENGTH(arabic_name_normalized)
               LIMIT 20`;

    db.all(sql, [fuzzyPattern, normalizedQuery, startsWith], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/student-result", async (req, res) => {
    const { seating_no, system } = req.body;

    try {
        // 1. Fetch raw HTML
        const formData = new URLSearchParams({
            seating_no,
            system: system || "2",
        });
        const response = await fetch("https://natega.youm7.com/Home/Natega", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
                Referer: "https://natega.youm7.com/",
                Origin: "https://natega.youm7.com",
            },
            body: formData.toString(),
        });
        const html = await response.text();
        // console.log('Fetched HTML:', html.slice(0, 2000)); // log part of it

        const $ = cheerio.load(html);

        // 2. Main metadata block: first .RightSide under .Sitecontainer .all, or fallback to any .RightSide
        let rightSide = $(
            ".Sitecontainer.WebSiteContent .all .RightSide"
        ).first();
        if (!rightSide.length) rightSide = $(".RightSide").first();
        const metaHTML = rightSide.html() || "";

        // 3. Grades block: look inside the nearest .result-info for the first .RightSide2
        const resultInfo = $(
            ".Sitecontainer.WebSiteContent .result-info"
        ).first();
        const gradesBlock = resultInfo
            .find("> .RightSide2, .RightSide2")
            .first();
        const gradesHTML = gradesBlock.html() || "";

        // 4. “مواد اخرى” block: find the header then its next .result-details, picking only the inner .RightSide2 list
        const extraHeader = resultInfo
            .find(".halfinput-info")
            .filter((i, el) => {
                return $(el).text().trim().includes("مواد اخرى");
            })
            .first();

        let extraHTML = "";
        if (extraHeader.length) {
            const details = extraHeader.nextAll(".result-details").first();
            // inside details, pick only the <ul class="nav-pills"> (skip ads/scripts)
            const list = details.find("ul.nav-pills").first();
            extraHTML = list.parent().html() || "";
        }

        // 5. Compose cleaned output
        const cleaned = `
      <div class="RightSide">${metaHTML}</div>
      <div class="RightSide2">${gradesHTML}</div>
      <div class="halfinput-info"><h6>مواد اخرى</h6></div>
      <div class="result-details">${extraHTML}</div>
    `;

        res.send(cleaned);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch or process result." });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});
