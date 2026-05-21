import { GuildTextBasedChannel, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { PlayOptions } from 'distube';
import { Command } from './command.types';
import { resolveAppleMusic } from '../utils/appleMusic';
import { PlaybackMetadata, SearchSource } from '../music/ytDlpSearchPlugin';

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
      opt.setName('query').setDescription('URL o nombre de la canción').setRequired(true),
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

  async execute(interaction) {
    const member = interaction.guild!.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#FF0000').setDescription('❌ Debes estar en un canal de voz.'),
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
            .setColor('#FF0000')
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
          new EmbedBuilder().setColor('#FFD700').setDescription(`🔍 Buscando: **${displayQuery}**...`),
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
    } catch (error) {
      console.error('Error en /play:', error);
      const content = {
        embeds: [
          new EmbedBuilder()
            .setColor('#FF0000')
            .setDescription('❌ No se pudo reproducir la canción. Verifica el enlace o el nombre.'),
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
