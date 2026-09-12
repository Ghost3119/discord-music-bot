import { GuildTextBasedChannel, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { PlayOptions } from 'distube';
import { Command } from './command.types';
import { resolveAppleMusic } from '../utils/appleMusic';
import { PlaybackMetadata, SearchSource } from '../music/ytDlpSearchPlugin';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { fetchSearchSuggestions } from '../utils/suggestions';

function isGuildTextChannel(channel: unknown): channel is GuildTextBasedChannel {
  if (typeof channel !== 'object' || channel === null) return false;
  const candidate = channel as { guild?: unknown; send?: unknown };
  return candidate.guild !== undefined && typeof candidate.send === 'function';
}

function parseSearchSource(value: string | null): SearchSource {
  return value === 'soundcloud' ? 'soundcloud' : 'youtube';
}

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce YouTube, SoundCloud, Spotify, Apple Music y URLs compatibles')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('URL o nombre de la canción')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('fuente')
        .setDescription('Fuente para búsquedas por nombre o enlaces de metadata')
        .addChoices(
          { name: 'YouTube', value: 'youtube' },
          { name: 'SoundCloud', value: 'soundcloud' },
        ),
    ) as SlashCommandBuilder,

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    if (!focusedValue || focusedValue.trim().length < 2) {
      await interaction.respond([]);
      return;
    }

    const suggestions = await fetchSearchSuggestions(focusedValue);
    await interaction.respond(
      suggestions.map((s) => ({
        name: s.slice(0, 100),
        value: s.slice(0, 100),
      })),
    );
  },

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const member = guild.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user!.id);
    if (!permissions?.has(['ViewChannel', 'Connect', 'Speak'])) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Error)
            .setDescription('❌ No tengo permisos para unirme o hablar en ese canal.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const rawQuery = interaction.options.getString('query', true);
    const searchSource = parseSearchSource(interaction.options.getString('fuente'));

    try {
      const resolved = await resolveAppleMusic(rawQuery);

      const displayQuery = resolved.isAppleMusic && resolved.artist && resolved.title
        ? `${resolved.artist} - ${resolved.title}`
        : rawQuery;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Gold).setDescription(`🔍 Buscando: **${displayQuery}**...`),
        ],
      });

      const distube = interaction.client.distube;
      const playOptions: PlayOptions<PlaybackMetadata> = {
        member: member!,
        metadata: { searchSource },
      };
      const textChannel = isGuildTextChannel(interaction.channel) ? interaction.channel : undefined;

      if (textChannel) {
        playOptions.textChannel = textChannel;
      }

      await distube.play<PlaybackMetadata>(voiceChannel, resolved.query, playOptions);
    } catch (error: unknown) {
      console.error('Error en /play:', error);

      const isVoiceTimeout =
        typeof error === 'object' &&
        error !== null &&
        'errorCode' in error &&
        (error as { errorCode?: string }).errorCode === 'VOICE_CONNECT_FAILED';

      const description = isVoiceTimeout
        ? '❌ **No se pudo conectar al canal de voz (tiempo de espera agotado).**\n\n💡 **Solución rápida en Discord:**\n1. Clic derecho en el canal de voz ➔ **Editar canal** ➔ **Resumen**.\n2. Busca **Anulación de región (Region Override)** y cámbiala de *Automático* a otra región (ej. *US Central* o *US East*).\n3. Verifica que el bot tenga permisos de **Conectar** y **Hablar** en ese canal.'
        : '❌ No se pudo reproducir la canción. Verifica el enlace o el nombre.';

      const content = {
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Error)
            .setDescription(description),
        ],
      };
      if (interaction.deferred) {
        await interaction.editReply(content);
      } else {
        await interaction.reply({ ...content, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
