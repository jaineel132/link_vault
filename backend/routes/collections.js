import express from 'express';
import pool from '../data/db.js';
import { ValidationError, parseId, requireNonEmptyString } from '../utils/validate.js';

const router = express.Router();

// Helper: normalize id to JS number
function normalize(row) {
  return { ...row, id: Number(row.id) };
}

// GET all collections
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM collections ORDER BY name ASC, id DESC');
    res.json(result.rows.map(normalize));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load collections, please try again" });
  }
});

// GET collection by ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await pool.query('SELECT * FROM collections WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Collection not found' });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to read collection" });
  }
});

// POST add new collection
router.post('/', async (req, res) => {
  try {
    const name = requireNonEmptyString(req.body.name, 'name');
    const id = Date.now();
    const result = await pool.query(
      'INSERT INTO collections (id, name) VALUES ($1, $2) RETURNING *',
      [id, name]
    );
    res.status(201).json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to create collection" });
  }
});

// PUT update collection
router.put('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const name = requireNonEmptyString(req.body.name, 'name');
    const result = await pool.query(
      'UPDATE collections SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Collection not found" });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to update collection" });
  }
});

// DELETE collection
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await pool.query(
      'DELETE FROM collections WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Collection not found" });
    res.json(normalize(result.rows[0]));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: "Failed to delete collection" });
  }
});

export default router;
