import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { HistoryStore } from './history';

const PAGE_SIZE = 5;
export function historyView(history: HistoryStore, guildId: string, requested = 0) {
  const entries = history.list(guildId), pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requested) ? Math.floor(requested) : 0));
  const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const icons = { completed: '✅', skipped: '⏭️', failed: '❌' };
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const retry = visible.flatMap((entry, index) => entry.url ? [new ButtonBuilder()
    .setCustomId(`hist_retry:${guildId}:${entry.id}`).setLabel(`Volver a intentar ${page * PAGE_SIZE + index + 1}`).setStyle(ButtonStyle.Secondary)] : []);
  if (retry.length) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(retry));
  if (pages > 1) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hist_page:${guildId}:${Math.max(0, page - 1)}`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`hist_indicator:${guildId}:${page}`).setLabel(`${page + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`hist_page:${guildId}:${Math.min(pages - 1, page + 1)}`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)));
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🕘 Historial de música')
    .setDescription(visible.map((entry, index) => `${page * PAGE_SIZE + index + 1}. ${icons[entry.result]} **${escapeMarkdown(entry.title.slice(0, 130))}**\n` +
      `${entry.source} · <t:${Math.floor(entry.time / 1000)}:R>${entry.code ? ` · ${entry.code}` : ''}${entry.reference ? ` · Ref. ${entry.reference}` : ''}` +
      (entry.alternative ? `\nAudio: ${escapeMarkdown(entry.alternative.slice(0, 130))}` : '')).join('\n\n') || 'Todavía no hay canciones en el historial.')
    .setFooter({ text: `${entries.length} entradas · Últimos 7 días · Página ${page + 1}/${pages}` })], components: rows, allowedMentions: { parse: [] as const } };
}
