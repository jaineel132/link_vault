import cron from 'node-cron';
import pool from '../data/db.js';

// ── Shared digest generator (also used by /digest command) ───────────────────
export async function generateDigest(links, label) {
  if (!links.length) return null;

  const linkSummaries = links.map(l =>
    `- "${l.name}" (${l.url}) tags: ${(l.tags || []).filter(t => !t.includes('.')).join(', ') || 'none'}${l.notes ? ` | note: ${l.notes}` : ''}`
  ).join('\n');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: `You are a personal knowledge assistant. Given a list of saved links, write a concise digest for the period: ${label}.
Format as Discord markdown. Group by category (Videos, Articles, Tools, Repos, Other).
One short line per link — what it is and why it matters.
End with one sentence about what topics dominated this period.
Be direct. No intro paragraph, go straight into the groups.`,
        },
        { role: 'user', content: `Links saved during ${label}:\n${linkSummaries}` },
      ],
      temperature: 0.4,
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function fetchRange(from, to) {
  const result = await pool.query(
    `SELECT l.*, c.name AS collection_name FROM links l
     LEFT JOIN collections c ON l.collection_id = c.id
     WHERE l.created_at >= $1 AND l.created_at < $2 ORDER BY l.created_at DESC`,
    [from, to]
  );
  return result.rows;
}

function getChannel(client) {
  const ch = client.channels.cache.find(c => c.name === 'linvault');
  if (!ch) console.warn('⚠️ Digest: #linvault channel not found');
  return ch;
}

// ── Weekly — every Monday 9am Kigali (UTC+2) ─────────────────────────────────
export function scheduleWeeklyDigest(client) {
  cron.schedule('0 7 * * 1', async () => {
    console.log('[digest]', '📊 Running weekly digest...');
    try {
      const to = new Date(), from = new Date();
      from.setDate(from.getDate() - 7);
      const links = await fetchRange(from, to);
      const ch = getChannel(client);
      if (!ch) return;

      if (!links.length) { ch.send('📭 **Weekly Digest** — no links saved this week.'); return; }

      const label  = `${fmt(from)} – ${fmt(to)}`;
      const digest = await generateDigest(links, `week (${label})`);
      ch.send(`📊 **Weekly LinVault Digest** — ${label}\nYou saved **${links.length} link${links.length !== 1 ? 's' : ''}** this week.\n\n` + (digest || 'Could not generate summary.'));
    } catch (e) { console.error('[digest]', 'Weekly digest error:', e); }
  }, { timezone: 'Africa/Kigali' });

  console.log('[digest]', '✅ Weekly digest — Mondays 9am Kigali');
}

// ── Monthly — 1st of month 9am Kigali ────────────────────────────────────────
export function scheduleMonthlyDigest(client) {
  cron.schedule('0 7 1 * *', async () => {
    console.log('[digest]', '📊 Running monthly digest...');
    try {
      const now  = new Date();
      const to   = new Date(now.getFullYear(), now.getMonth(), 1);
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const links = await fetchRange(from, to);
      const ch = getChannel(client);
      if (!ch) return;

      if (!links.length) { ch.send('📭 **Monthly Digest** — nothing saved last month.'); return; }

      const monthName = from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

      // Collection breakdown
      const byColl = {};
      for (const l of links) { const n = l.collection_name || 'Unsorted'; byColl[n] = (byColl[n] || 0) + 1; }
      const collLines = Object.entries(byColl).sort((a,b) => b[1]-a[1]).map(([n,c]) => `  • ${n}: ${c}`).join('\n');

      const digest = await generateDigest(links, `month of ${monthName}`);
      ch.send(`📅 **Monthly LinVault Digest — ${monthName}**\nYou saved **${links.length} links**:\n${collLines}\n\n` + (digest || 'Could not generate summary.'));
    } catch (e) { console.error('[digest]', 'Monthly digest error:', e); }
  }, { timezone: 'Africa/Kigali' });

  console.log('[digest]', '✅ Monthly digest — 1st of month 9am Kigali');
}
