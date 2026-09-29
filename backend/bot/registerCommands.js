import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const commands = [

  // /save
  new SlashCommandBuilder()
    .setName('save')
    .setDescription('Save a link to LinVault')
    .addStringOption(o => o.setName('url').setDescription('The URL to save').setRequired(true))
    .addStringOption(o => o.setName('collection').setDescription('Collection to save into').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('tags').setDescription('Tags (comma separated or pick from autocomplete)').setRequired(false).setAutocomplete(true)),

  // /find
  new SlashCommandBuilder()
    .setName('find')
    .setDescription('Search your vault')
    .addStringOption(o => o.setName('query').setDescription('Search term').setRequired(true)),

  // /recent
  new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Show your last 10 saved links'),

  // /random
  new SlashCommandBuilder()
    .setName('random')
    .setDescription('Get a random link from your vault')
    .addStringOption(o => o.setName('collection').setDescription('Filter by collection (optional)').setRequired(false).setAutocomplete(true)),

  // /move
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a link to a different collection')
    .addStringOption(o => o.setName('url').setDescription('The URL to move').setRequired(true))
    .addStringOption(o => o.setName('collection').setDescription('Target collection').setRequired(true).setAutocomplete(true)),

  // /tag
  new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Add tags to a saved link')
    .addStringOption(o => o.setName('url').setDescription('The URL to tag').setRequired(true))
    .addStringOption(o => o.setName('tags').setDescription('Tags to add (comma separated)').setRequired(true)),

  // /unsave
  new SlashCommandBuilder()
    .setName('unsave')
    .setDescription('Delete a link from your vault')
    .addStringOption(o => o.setName('url').setDescription('The URL to delete').setRequired(true)),

  // /collection
  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Show all links in a collection')
    .addStringOption(o => o.setName('name').setDescription('Collection name').setRequired(true).setAutocomplete(true)),

  // /stats
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('See your vault stats'),

  // /duplicate
  new SlashCommandBuilder()
    .setName('duplicate')
    .setDescription('Find and delete duplicate links in your vault'),

  // /digest
  new SlashCommandBuilder()
    .setName('digest')
    .setDescription('Get a digest of your saved links')
    .addStringOption(o =>
      o.setName('period')
        .setDescription('Time period')
        .setRequired(true)
        .addChoices(
          { name: 'This week',  value: 'week'  },
          { name: 'This month', value: 'month' },
          { name: 'All time',   value: 'alltime' },
          { name: 'Pick a month', value: 'pick' },
        )
    )
    .addStringOption(o =>
      o.setName('month')
        .setDescription('Which month (only used when period = Pick a month)')
        .setRequired(false)
        .addChoices(...MONTHS.map((m, i) => ({ name: m, value: String(i + 1) })))
    )
    .addIntegerOption(o =>
      o.setName('year')
        .setDescription('Year (only used with Pick a month, defaults to current year)')
        .setRequired(false)
        .setMinValue(2020)
        .setMaxValue(2100)
    ),

].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log('[registerCommands]', 'Registering slash commands...');
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands });
  console.log('[registerCommands]', '✅ All commands registered!');
} catch (err) {
  console.error('[registerCommands]', '❌ Failed to register commands:', err);
}
