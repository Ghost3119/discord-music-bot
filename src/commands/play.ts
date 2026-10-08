import { ButtonInteraction, ChatInputCommandInteraction, GuildTextBasedChannel, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { DisTubeError, isURL, PlayOptions, Song } from 'distube';
import { Command } from './command.types';
import { resolveAppleMusic } from '../utils/appleMusic';
import { PlaybackMetadata, SearchSource, YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';
import { describeMusicError } from '../music/errors';
import { ensureControlChannel, ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { fetchSearchSuggestions } from '../utils/suggestions';
import { getPlaybackState } from '../music/playbackState';

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
    await playRequest(interaction, interaction.options.getString('query', true), parseSearchSource(interaction.options.getString('fuente')));
  },
};

export async function playRequest(interaction: ChatInputCommandInteraction | ButtonInteraction, rawQuery: string, searchSource: SearchSource, privateReply = false): Promise<void> {
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
    const missingPermissions = [
      { flag: 'ViewChannel', label: 'Ver canal' },
      { flag: 'Connect', label: 'Conectar' },
      { flag: 'Speak', label: 'Hablar' },
    ] as const;
    const missing = missingPermissions.filter(({ flag }) => !permissions?.has(flag));
    if (missing.length > 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Error)
            .setDescription(`❌ **Faltan permisos en el canal de voz:** ${missing.map(({ label }) => label).join(', ')}.\n💡 Revisa el rol del bot y las excepciones de ese canal.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const distube = interaction.client.distube;
    const initialQueue = distube.getQueue(guild.id);
    if (initialQueue && !await ensureControlChannel(interaction, initialQueue)) return;
    const revision = initialQueue ? getPlaybackState(initialQueue)?.revision : undefined;
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply(privateReply ? { flags: MessageFlags.Ephemeral } : {});

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

      const playOptions: PlayOptions<PlaybackMetadata> = {
        member: member!,
        metadata: { searchSource },
      };
      const textChannel = isGuildTextChannel(interaction.channel) ? interaction.channel : undefined;

      if (textChannel) {
        playOptions.textChannel = textChannel;
      }

      // DisTube replaces search errors with NO_RESULT, discarding the actual cause.
      // Resolve text here so network and platform errors reach the user intact.
      let input: string | Song<PlaybackMetadata> = resolved.query;
      if (!isURL(input)) {
        const plugin = distube.plugins.find((item): item is YtDlpSearchPlugin => item instanceof YtDlpSearchPlugin);
        if (!plugin) throw new DisTubeError('NO_EXTRACTOR_PLUGIN');
        const song = await plugin.searchSong(input, playOptions);
        if (!song) throw new DisTubeError('CANNOT_RESOLVE_SONG', input);
        input = song;
      }

      if (distube.getQueue(guild.id) !== initialQueue || initialQueue?.stopped || (initialQueue && getPlaybackState(initialQueue)?.closing) ||
        (initialQueue && getPlaybackState(initialQueue)?.revision !== revision) || member?.voice.channel?.id !== voiceChannel.id) {
        await interaction.editReply({ content: 'La sesión, la cola o tu canal de voz cambió mientras buscaba. Vuelve a intentarlo.', embeds: [], components: [] });
        return;
      }
      await distube.play<PlaybackMetadata>(voiceChannel, input, playOptions);
    } catch (error: unknown) {
      console.error('Error en /play:', error);

      const description = describeMusicError(error, { source: searchSource });

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
}
