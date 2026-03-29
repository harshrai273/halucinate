// ─── HalluciNet Server ───────────────────────────────────────────────────────
// Branch: feature/us2-source-attribution
// User Story 2: Source Attribution (#SourceRetrieval #ReferenceMatching #SourceDisplay)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const escapeHtml = require('escape-html');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new Database('hallucinet.db');

// Original scans table — unchanged
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input TEXT,
    score INTEGER,
    verdict TEXT,
    summary TEXT,
    full_report TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// User Story 2 — Task: #SourceRetrieval
// New table to persist each statement + matched sources
db.exec(`
  CREATE TABLE IF NOT EXISTS source_attributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER,
    statement TEXT,
    sources TEXT,
    confidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scan_id) REFERENCES scans(id)
  );
`);

// ─── Original 7-Step Audit Prompt — unchanged ────────────────────────────────
const SYSTEM_PROMPT = `
# ════════════════════════════════════════════════════════════════════
# HALLUCINET — AI HALLUCINATION DETECTION SYSTEM
# Master Structured Prompt (Base Model)
# ════════════════════════════════════════════════════════════════════

SYSTEM ROLE
You are HalluciNet, an expert AI output auditing system. Your sole purpose is to receive a user-provided input prompt and the corresponding outputs from four LLMs — GPT-4o (OpenAI), Gemini (Google), Claude (Anthropic), and Llama (Meta) — and perform a deep, structured hallucination detection and factual consistency analysis across all four outputs.

INPUT CONTRACT
[USER PROMPT], [GPT-4o OUTPUT], [GEMINI OUTPUT], [CLAUDE OUTPUT], [LLAMA OUTPUT].

TASK INSTRUCTIONS
Perform the following analysis pipeline in strict sequence:
STEP 1 — INPUT UNDERSTANDING
STEP 2 — PER-MODEL HALLUCINATION AUDIT
STEP 3 — CROSS-MODEL CONSISTENCY MATRIX
STEP 4 — HALLUCINATION PATTERN CLASSIFICATION
STEP 5 — AGGREGATE SCORING DASHBOARD
STEP 6 — RISK ADVISORY
STEP 7 — CORRECTED SYNTHESIS
`;

// ─── User Story 2: Source Attribution Prompt ─────────────────────────────────
// Tasks: #SourceRetrieval #ReferenceMatching
// Instructs Gemini to extract key statements and match each to credible sources.
const SOURCE_ATTRIBUTION_PROMPT = `
# ════════════════════════════════════════════════════════════════════
# HALLUCINET — SOURCE ATTRIBUTION MODULE
# User Story 2: Source Attribution for AI Researchers
# Tasks: #SourceRetrieval #ReferenceMatching #SourceDisplay
# ════════════════════════════════════════════════════════════════════

SYSTEM ROLE
You are HalluciNet's Source Attribution Engine. Given an AI-generated response,
your job is to:
1. Extract the key factual statements made in the response.
2. For each statement, identify 1-3 credible reference sources (Wikipedia, academic
   papers, official documentation, reputable news outlets, etc.) that could verify it.
3. Assign a confidence level (HIGH / MEDIUM / LOW) based on how well-supported
   the statement is by known sources.
4. If no reliable sources can be found, explicitly flag it as LOW CONFIDENCE.

OUTPUT FORMAT — respond ONLY with valid JSON, no markdown fences, no extra text:
{
  "statements": [
    {
      "statement": "<exact or paraphrased key claim from the response>",
      "confidence": "HIGH",
      "sources": [
        {
          "title": "<source title>",
          "url": "<plausible URL or DOI>",
          "type": "Wikipedia"
        }
      ],
      "note": "<optional note if confidence is LOW or sources are limited>"
    }
  ],
  "overall_confidence": "HIGH",
  "summary": "<1-2 sentence summary of source coverage>"
}

RULES
- Extract between 3 and 8 key factual statements.
- Prefer well-known, verifiable sources.
- Use plausible URL patterns: https://en.wikipedia.org/wiki/... or https://arxiv.org/abs/...
- If a statement is opinion/subjective, mark it LOW confidence with a note.
- If the response has no verifiable facts, set overall_confidence to LOW.
- Confidence values must be exactly: HIGH, MEDIUM, or LOW.
- Source type must be one of: Wikipedia, Academic, Official Docs, News, Other.

[AI RESPONSE TO ANALYZE]:
`;

// ─── Original Route: Deep 7-Step Audit — unchanged ───────────────────────────
app.post('/api/analyze-comparison', async (req, res) => {
  const { apiKey, userPrompt, gpt4o, gemini, claude, llama } = req.body;
  const effectiveKey = apiKey || process.env.GEMINI_API_KEY;

  if (!effectiveKey || effectiveKey === 'your_key_here') {
    return res.status(400).json({ error: "No Google Gemini API Key provided." });
  }

  const cleanPrompt = escapeHtml(userPrompt || '');
  const cleanGpt = escapeHtml(gpt4o || '');
  const cleanGem = escapeHtml(gemini || '');
  const cleanCla = escapeHtml(claude || '');
  const cleanLla = escapeHtml(llama || '');

  const fullInput = `
${SYSTEM_PROMPT}

[USER PROMPT]: ${cleanPrompt}
[GPT-4o OUTPUT]: ${cleanGpt || 'MISSING'}
[GEMINI OUTPUT]: ${cleanGem || 'MISSING'}
[CLAUDE OUTPUT]: ${cleanCla || 'MISSING'}
[LLAMA OUTPUT]: ${cleanLla || 'MISSING'}
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveKey}`,
      {
        contents: [{ parts: [{ text: fullInput }] }],
        generationConfig: { maxOutputTokens: 4000, temperature: 0.1 }
      }
    );

    if (!response.data.candidates || !response.data.candidates[0]) {
      throw new Error("Invalid response from Gemini API");
    }

    const report = response.data.candidates[0].content.parts[0].text;
    const scoreMatch = report.match(/(\d+)\/10/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) * 10 : 50;

    const insertScan = db.prepare(
      'INSERT INTO scans (input, score, verdict, summary, full_report) VALUES (?, ?, ?, ?, ?)'
    );
    insertScan.run(
      cleanPrompt.substring(0, 500) || 'Deep Audit',
      score,
      score > 70 ? 'CLEAN' : 'MODERATE',
      'Comparison Analysis',
      report
    );

    res.json({ report, score });
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error("Gemini Error:", errMsg);
    res.status(500).json({ error: "Gemini Engine Error: " + escapeHtml(errMsg) });
  }
});

// ─── User Story 2: POST /api/source-attribution ───────────────────────────────
// Task: #SourceRetrieval  — sends response to Gemini to find reference sources
// Task: #ReferenceMatching — Gemini matches each statement to credible sources
// Task: #SourceDisplay    — returns structured JSON for frontend to render
app.post('/api/source-attribution', async (req, res) => {
  const { apiKey, responseText } = req.body;
  const effectiveKey = apiKey || process.env.GEMINI_API_KEY;

  if (!effectiveKey || effectiveKey === 'your_key_here') {
    return res.status(400).json({ error: "No Google Gemini API Key provided." });
  }

  if (!responseText || responseText.trim().length < 20) {
    return res.status(400).json({ error: "Please provide a valid AI-generated response to analyze." });
  }

  const cleanResponse = escapeHtml(responseText.trim());
  const fullPrompt = SOURCE_ATTRIBUTION_PROMPT + cleanResponse;

  try {
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveKey}`,
      {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.1 }
      }
    );

    if (!geminiRes.data.candidates || !geminiRes.data.candidates[0]) {
      throw new Error("Invalid response from Gemini API");
    }

    // Strip markdown fences if Gemini wraps JSON in ```json ... ```
    let rawText = geminiRes.data.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let attribution;
    try {
      attribution = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr.message);
      return res.status(500).json({
        error: "Source attribution parsing failed. Gemini returned non-JSON output."
      });
    }

    // Persist scan record into existing scans table
    const insertScan = db.prepare(
      'INSERT INTO scans (input, score, verdict, summary, full_report) VALUES (?, ?, ?, ?, ?)'
    );
    const scanResult = insertScan.run(
      cleanResponse.substring(0, 500),
      attribution.overall_confidence === 'HIGH' ? 90 :
        attribution.overall_confidence === 'MEDIUM' ? 60 : 30,
      'SOURCE_ATTRIBUTION',
      attribution.summary || '',
      JSON.stringify(attribution)
    );

    // Task: #ReferenceMatching — persist each statement's matched sources
    const insertAttr = db.prepare(
      'INSERT INTO source_attributions (scan_id, statement, sources, confidence) VALUES (?, ?, ?, ?)'
    );
    (attribution.statements || []).forEach(s => {
      insertAttr.run(
        scanResult.lastInsertRowid,
        (s.statement || '').substring(0, 500),
        JSON.stringify(s.sources || []),
        s.confidence || 'LOW'
      );
    });

    res.json({ attribution });
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error("Source Attribution Error:", errMsg);
    res.status(500).json({ error: "Source Attribution Engine Error: " + escapeHtml(errMsg) });
  }
});

// ─── Original Route: Audit History — unchanged ───────────────────────────────
app.get('/api/history', (req, res) => {
  try {
    const scans = db.prepare('SELECT * FROM scans ORDER BY created_at DESC LIMIT 50').all();
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: "Database error." });
  }
});

app.listen(PORT, () => {
  console.log(`HalluciNet running on http://localhost:${PORT} [SECURE MODE ACTIVE]`);
});
