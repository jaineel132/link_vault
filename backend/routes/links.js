import express from 'express';
import pool from '../data/db.js';
import {
  ValidationError,
  parseId,
  requireNonEmptyString,
  optionalString,
  requireValidUrl,
  optionalId,
  optionalStringArray,
} from '../utils/validate.js';

const router = express.Router();

// normalize: convert BigInt IDs to numbers, ensure tags is always an array
function normalize(row) {
  return {
    ...row,
    id: Number(row.id),
    collection_id: row.collection_id ? Number(row.collection_id) : null,
    collectionId: row.collection_id ? Number(row.collection_id) : null,
    tags: row.tags || [],
  };
}

// GET all links
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM links ORDER BY id DESC');
    res.json(result.rows.map(normalize));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read links" });
  }
});

// GET unassigned — MUST be before /:id
router.get('/unassigned', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM links WHERE collection_id IS NULL ORDER BY id DESC');
    res.json(result.rows.map(normalize));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch unassigned links" });
  }
});

// GET links by collection — MUST be before /:id
router.get('/collection/:id', async (req, res) => {
  try {
    const collectionId = parseId(req.params.id, 'collection id');
    const result = await pool.query(
      'SELECT * FROM links WHERE collection_id = $1 ORDER BY id DESC',
      [collectionId]
    );
    res.json(result.rows.map(normalize));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to fetch links by collection" });
  }
});

// GET link by ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await pool.query('SELECT * FROM links WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Link not found' });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to read link" });
  }
});

// POST add new link
router.post('/', async (req, res) => {
  try {
    const name = requireNonEmptyString(req.body.name, 'name');
    const url = requireValidUrl(req.body.url, 'url');
    const notes = optionalString(req.body.notes, 'notes');
    const collectionId = optionalId(req.body.collectionId, 'collectionId');
    const tags = optionalStringArray(req.body.tags, 'tags');

    // check for duplicate URL
    const existing = await pool.query('SELECT * FROM links WHERE url = $1', [url]);
    if (existing.rows.length > 0) {
      return res.status(200).json({ ...normalize(existing.rows[0]), duplicate: true });
    }

    const id = Date.now();

    // auto-tag by domain
    let domain = '';
    try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = ''; }

    // merge domain tag with custom tags, remove duplicates
    const allTags = [...new Set([domain, ...tags].filter(Boolean))];

    const result = await pool.query(
      'INSERT INTO links (id, name, url, notes, collection_id, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *',
      [id, name, url, notes, collectionId, allTags]
    );
    res.status(201).json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to add link" });
  }
});

// PUT update link
router.put('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);

    // Every field here is optional on update — but if present, it must be
    // valid. COALESCE in the query keeps whatever wasn't sent unchanged.
    const name = req.body.name ?? null;
    const url = req.body.url ?? null;
    const notes = req.body.notes ?? null;
    const collectionId = req.body.collectionId ?? null;
    const tags = req.body.tags ?? null;

    // if url is being updated alongside tags, recalculate domain tag
    let updatedTags = tags;
    if (url && tags) {
      let domain = '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = ''; }
      updatedTags = [...new Set([domain, ...tags].filter(Boolean))];
    }

    const result = await pool.query(
      `UPDATE links SET
        name = COALESCE($1, name),
        url = COALESCE($2, url),
        notes = COALESCE($3, notes),
        collection_id = COALESCE($4, collection_id),
        tags = COALESCE($5, tags)
       WHERE id = $6 RETURNING *`,
      [name, url, notes, collectionId, updatedTags, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Link not found" });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to update link" });
  }
});

// DELETE link
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await pool.query('DELETE FROM links WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Link not found" });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to delete link" });
  }
});

export default router;
