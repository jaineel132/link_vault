import { Client, GatewayIntentBits, Events } from 'discord.js';
import pool from '../data/db.js';
import { scheduleWeeklyDigest, scheduleMonthlyDigest, generateDigest } from './digest.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ── Batching ──────────────────────────────────────────────────────────────────
const batchMap = new Map();

function scheduleFlush(channelId, channel) {
  const entry = batchMap.get(channelId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushBatch(channelId, channel), 2000);
}

async function flushBatch(channelId, channel) {
  const entry = batchMap.get(channelId);
  if (!entry || entry.urls.length === 0) return;
  const urls = [...entry.urls];
  batchMap.delete(channelId);

  channel.send(`⏳ Got **${urls.length}** link${urls.length > 1 ? 's' : ''}. Classifying...`);
  const results = await Promise.allSettled(urls.map(url => classifyAndSave(url, null, [])));
  const saved  = results.filter(r => r.status === 'fulfilled' && r.value && !r.value.duplicate).map(r => r.value);
  const dupes  = results.filter(r => r.status === 'fulfilled' && r.value?.duplicate).length;
  const failed = results.filter(r => r.status === 'rejected').length;

  if (saved.length)  channel.send(`✅ Saved **${saved.length}** link${saved.length > 1 ? 's' : ''} to **Unsorted**:\n${saved.map(l => `• **${l.name}** — \`${l.url}\``).join('\n')}`);
  if (dupes)         channel.send(`⚠️ ${dupes} link${dupes > 1 ? 's were' : ' was'} already in your vault.`);
  if (failed)        channel.send(`❌ ${failed} link${failed > 1 ? 's' : ''} failed to save.`);
}

// ── URL helpers ───────────────────────────────────────────────────────────────
function extractUrls(text) {
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$2');
  if (!text.match(/https?:\/\//i) && text.includes('.')) text = 'https://' + text.trim();
  return [...new Set((text.match(/https?:\/\/[^\s<>"]+/gi) || []).map(u => u.replace(/[.,)]+$/, '')))];
}

// ── Groq classify ─────────────────────────────────────────────────────────────
async function classifyUrl(url) {
  // Try fetching real page title first
  let pageTitle = '';
  let pageDesc  = '';
  try {
    // oEmbed for TikTok
    if (url.includes('tiktok.com')) {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      const d = await r.json();
      pageTitle = d.title || '';
    } else {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      const html = await r.text();
      pageTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
      pageDesc  = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || '').trim();
    }
  } catch { /* fallback to URL only */ }

  const context = [pageTitle, pageDesc].filter(Boolean).join(' — ');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: 'You are a link classifier. Return ONLY a JSON object with: "name" (short title max 6 words), "category" (Video/Article/Tool/Repo/Podcast/Other), "tags" (array of 2-3 lowercase strings), "summary" (1-2 sentence description of what this link is about, written for the person who saved it). No markdown, no explanation.',
        },
        { role: 'user', content: `URL: ${url}\nPage info: ${context || 'none'}` },
      ],
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content?.trim() || '{}');
}

// ── Save to DB ────────────────────────────────────────────────────────────────
async function classifyAndSave(url, collectionId, extraTags = []) {
  const existing = await pool.query('SELECT * FROM links WHERE url = $1', [url]);
  if (existing.rows.length > 0) return { ...existing.rows[0], duplicate: true };

  let name = url, tags = [], notes = '';
  try {
    const c = await classifyUrl(url);
    name  = c.name    || url;
    tags  = c.tags    || [];
    notes = c.summary || '';
    if (c.category) tags.unshift(c.category.toLowerCase());
  } catch {
    try { name = new URL(url).hostname.replace('www.', ''); } catch {}
  }

  try {
    const domain = new URL(url).hostname.replace('www.', '');
    tags = [...new Set([domain, ...tags, ...extraTags].filter(Boolean))];
  } catch {
    tags = [...new Set([...tags, ...extraTags].filter(Boolean))];
  }

  const id = Date.now() + Math.floor(Math.random() * 1000);
  const result = await pool.query(
    'INSERT INTO links (id, name, url, notes, collection_id, tags, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',
    [id, name, url, notes, collectionId, tags]
  );
  return result.rows[0];
}

// ── Auto-paste listener ───────────────────────────────────────────────────────
const WATCHED_CHANNEL = 'linvault';

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== WATCHED_CHANNEL) return;
  if (message.content.startsWith('/')) return;
  const urls = extractUrls(message.content);
  if (!urls.length) return;
  if (!batchMap.has(message.channelId)) batchMap.set(message.channelId, { urls: [], timer: null });
  batchMap.get(message.channelId).urls.push(...urls);
  scheduleFlush(message.channelId, message.channel);
});

// ── Slash commands ────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {

  // ── Autocomplete ──────────────────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    const search  = focused.value.toLowerCase();

    if (focused.name === 'collection' || focused.name === 'name') {
      const rows = (await pool.query('SELECT id, name FROM collections ORDER BY name')).rows;
      await interaction.respond(
        rows.filter(c => c.name.toLowerCase().includes(search)).slice(0, 25)
          .map(c => ({ name: c.name, value: String(c.id) }))
      );
    }

    if (focused.name === 'tags') {
      const rows = (await pool.query(`SELECT DISTINCT unnest(tags) AS tag FROM links ORDER BY tag`)).rows;
      await interaction.respond(
        rows.map(r => r.tag).filter(t => t && !t.includes('.') && t.includes(search)).slice(0, 25)
          .map(t => ({ name: t, value: t }))
      );
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const cmd = interaction.commandName;

  // ── /save ─────────────────────────────────────────────────────────────────
  if (cmd === 'save') {
    const rawUrl      = interaction.options.getString('url');
    const collectionId = interaction.options.getString('collection') || null;
    const tagInput    = interaction.options.getString('tags') || '';
    const urls = extractUrls(rawUrl);
    if (!urls.length) return interaction.editReply('❌ No valid URL found. Paste the full https:// link.');

    const extraTags = tagInput.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const link = await classifyAndSave(urls[0], collectionId, extraTags);
    if (link.duplicate) return interaction.editReply(`⚠️ Already saved: **${link.name || link.url}**`);

    let colName = 'Unsorted';
    if (collectionId) {
      const col = await pool.query('SELECT name FROM collections WHERE id = $1', [collectionId]);
      if (col.rows.length) colName = col.rows[0].name;
    }
    const tagDisplay = (link.tags || []).filter(t => !t.includes('.')).join(', ') || 'none';
    return interaction.editReply(`✅ Saved **${link.name}** to **${colName}**\n🏷️ ${tagDisplay}${link.notes ? `\n📝 ${link.notes}` : ''}`);
  }

  // ── /find ─────────────────────────────────────────────────────────────────
  if (cmd === 'find') {
    const q = interaction.options.getString('query').toLowerCase();
    const result = await pool.query(
      `SELECT * FROM links WHERE LOWER(name) LIKE $1 OR LOWER(url) LIKE $1 OR LOWER(notes) LIKE $1 OR EXISTS (
        SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE $1
      ) ORDER BY created_at DESC LIMIT 10`,
      [`%${q}%`]
    );
    if (!result.rows.length) return interaction.editReply(`🔍 No links found for **"${q}"**`);
    const lines = result.rows.map(l => `• [${l.name}](${l.url})`).join('\n');
    return interaction.editReply(`🔍 **Results for "${q}"** (${result.rows.length}):\n${lines}`);
  }

  // ── /recent ───────────────────────────────────────────────────────────────
  if (cmd === 'recent') {
    const result = await pool.query('SELECT * FROM links ORDER BY created_at DESC LIMIT 10');
    if (!result.rows.length) return interaction.editReply('📭 No links saved yet.');
    const lines = result.rows.map((l, i) => `${i + 1}. [${l.name}](${l.url})`).join('\n');
    return interaction.editReply(`🕐 **Last 10 saved links:**\n${lines}`);
  }

  // ── /random ───────────────────────────────────────────────────────────────
  if (cmd === 'random') {
    const colId = interaction.options.getString('collection');
    const result = colId
      ? await pool.query('SELECT * FROM links WHERE collection_id = $1 ORDER BY RANDOM() LIMIT 1', [colId])
      : await pool.query('SELECT * FROM links ORDER BY RANDOM() LIMIT 1');
    if (!result.rows.length) return interaction.editReply('📭 No links to pick from.');
    const l = result.rows[0];
    const tags = (l.tags || []).filter(t => !t.includes('.')).join(', ');
    return interaction.editReply(`🎲 **Random pick:**\n**${l.name}**\n${l.url}${tags ? `\n🏷️ ${tags}` : ''}${l.notes ? `\n📝 ${l.notes}` : ''}`);
  }

  // ── /move ─────────────────────────────────────────────────────────────────
  if (cmd === 'move') {
    const url   = interaction.options.getString('url');
    const colId = interaction.options.getString('collection');
    const result = await pool.query(
      'UPDATE links SET collection_id = $1 WHERE url = $2 RETURNING *',
      [colId, url]
    );
    if (!result.rows.length) return interaction.editReply(`❌ Link not found: \`${url}\``);
    const col = await pool.query('SELECT name FROM collections WHERE id = $1', [colId]);
    const colName = col.rows[0]?.name || 'Unknown';
    return interaction.editReply(`✅ Moved **${result.rows[0].name}** to **${colName}**`);
  }

  // ── /tag ──────────────────────────────────────────────────────────────────
  if (cmd === 'tag') {
    const url      = interaction.options.getString('url');
    const newTags  = interaction.options.getString('tags').split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const existing = await pool.query('SELECT * FROM links WHERE url = $1', [url]);
    if (!existing.rows.length) return interaction.editReply(`❌ Link not found: \`${url}\``);
    const merged = [...new Set([...(existing.rows[0].tags || []), ...newTags])];
    await pool.query('UPDATE links SET tags = $1 WHERE url = $2', [merged, url]);
    return interaction.editReply(`🏷️ Tags updated on **${existing.rows[0].name}**: ${merged.filter(t => !t.includes('.')).join(', ')}`);
  }

  // ── /unsave ───────────────────────────────────────────────────────────────
  if (cmd === 'unsave') {
    const url    = interaction.options.getString('url');
    const result = await pool.query('DELETE FROM links WHERE url = $1 RETURNING *', [url]);
    if (!result.rows.length) return interaction.editReply(`❌ Link not found: \`${url}\``);
    return interaction.editReply(`🗑️ Deleted **${result.rows[0].name}**`);
  }

  // ── /collection ───────────────────────────────────────────────────────────
  if (cmd === 'collection') {
    const colId = interaction.options.getString('name');
    const col   = await pool.query('SELECT * FROM collections WHERE id = $1', [colId]);
    if (!col.rows.length) return interaction.editReply('❌ Collection not found.');
    const links = await pool.query('SELECT * FROM links WHERE collection_id = $1 ORDER BY created_at DESC LIMIT 15', [colId]);
    if (!links.rows.length) return interaction.editReply(`📂 **${col.rows[0].name}** is empty.`);
    const lines = links.rows.map(l => `• [${l.name}](${l.url})`).join('\n');
    return interaction.editReply(`📂 **${col.rows[0].name}** (${links.rows.length} links):\n${lines}`);
  }

  // ── /stats ────────────────────────────────────────────────────────────────
  if (cmd === 'stats') {
    const [totalLinks, totalCols, weekLinks, topTags] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM links'),
      pool.query('SELECT COUNT(*) FROM collections'),
      pool.query(`SELECT COUNT(*) FROM links WHERE created_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT unnest(tags) AS tag, COUNT(*) AS c FROM links GROUP BY tag ORDER BY c DESC LIMIT 5`),
    ]);
    const tagLines = topTags.rows.filter(r => !r.tag.includes('.')).slice(0, 5).map(r => `  • ${r.tag} (${r.c})`).join('\n');
    return interaction.editReply(
      `📊 **LinVault Stats**\n` +
      `🔗 Total links: **${totalLinks.rows[0].count}**\n` +
      `📂 Collections: **${totalCols.rows[0].count}**\n` +
      `📅 Saved this week: **${weekLinks.rows[0].count}**\n` +
      `🏷️ Top tags:\n${tagLines || '  none yet'}`
    );
  }

  // ── /duplicate ────────────────────────────────────────────────────────────
  if (cmd === 'duplicate') {
    const dupes = await pool.query(`
      SELECT url, COUNT(*) AS c, array_agg(id ORDER BY created_at DESC) AS ids
      FROM links GROUP BY url HAVING COUNT(*) > 1
    `);
    if (!dupes.rows.length) return interaction.editReply('✅ No duplicates found — your vault is clean!');

    let deleted = 0;
    for (const row of dupes.rows) {
      const [_keep, ...toDelete] = row.ids;
      if (toDelete.length) {
        await pool.query('DELETE FROM links WHERE id = ANY($1)', [toDelete]);
        deleted += toDelete.length;
      }
    }
    return interaction.editReply(`🧹 Found **${dupes.rows.length}** duplicate URL${dupes.rows.length > 1 ? 's' : ''}. Deleted **${deleted}** extra cop${deleted === 1 ? 'y' : 'ies'}, kept the most recent of each.`);
  }

  // ── /digest ───────────────────────────────────────────────────────────────
  if (cmd === 'digest') {
    const period = interaction.options.getString('period');
    const monthNum = interaction.options.getInteger('month');
    const yearNum  = interaction.options.getInteger('year') || new Date().getFullYear();

    let from, to, label;
    const now = new Date();

    if (period === 'week') {
      to   = new Date(now);
      from = new Date(now); from.setDate(from.getDate() - 7);
      label = 'This Week';
    } else if (period === 'month') {
      from  = new Date(now.getFullYear(), now.getMonth(), 1);
      to    = new Date(now);
      label = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    } else if (period === 'alltime') {
      from  = new Date('2000-01-01');
      to    = new Date(now);
      label = 'All Time';
    } else if (period === 'pick') {
      if (!monthNum) return interaction.editReply('❌ Please also set the **month** option when using "Pick a month".');
      from  = new Date(yearNum, monthNum - 1, 1);
      to    = new Date(yearNum, monthNum, 1);
      label = from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }

    const result = await pool.query(
      `SELECT l.*, c.name AS collection_name FROM links l
       LEFT JOIN collections c ON l.collection_id = c.id
       WHERE l.created_at >= $1 AND l.created_at < $2 ORDER BY l.created_at DESC`,
      [from, to]
    );

    if (!result.rows.length) return interaction.editReply(`📭 No links saved for **${label}**.`);

    await interaction.editReply(`⏳ Generating digest for **${label}** (${result.rows.length} links)...`);

    const digest = await generateDigest(result.rows, label);
    const header = `📊 **LinVault Digest — ${label}**\n${result.rows.length} links saved\n\n`;
    return interaction.followUp(header + (digest || 'Could not generate summary.'));
  }

});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ LinVault bot ready as ${c.user.tag}`);
  scheduleWeeklyDigest(c);
  scheduleMonthlyDigest(c);
});

client.login(process.env.DISCORD_TOKEN);
export default client;
