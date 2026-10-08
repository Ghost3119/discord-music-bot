import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  GuildTextBasedChannel,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { PlayOptions } from 'distube';
import { Command } from './command.types';
import { PlaybackMetadata, SearchSource } from '../music/ytDlpSearchPlugin';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { formatDuration } from '../utils/embed';
import { searchSongs } from '../utils/searchHelper';
import { fetchSearchSuggestions } from '../utils/suggestions';
import { describeMusicError } from '../music/errors';

function isGuildTextChannel(channel: unknown): channel is GuildTextBasedChannel {
  if (typeof channel !== 'object' || channel === null) return false;
  const candidate = channel as { guild?: unknown; send?: unknown };
  return candidate.guild !== undefined && typeof candidate.send === 'function';
}

function parseSearchSource(value: string | null): SearchSource {
  return value === 'soundcloud' ? 'soundcloud' : 'youtube';
}

export const search: Command = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Busca y selecciona entre los mejores resultados de YouTube o SoundCloud')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Nombre de la canción o término de búsqueda')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('fuente')
        .setDescription('Plataforma donde realizar la búsqueda')
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

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const source = parseSearchSource(interaction.options.getString('fuente'));

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(BotColors.Gold)
          .setDescription(`🔍 Buscando opciones para: **${query}** en **${source === 'soundcloud' ? 'SoundCloud' : 'YouTube'}**...`),
      ],
    });

    let results: Awaited<ReturnType<typeof searchSongs>>;
    try {
      results = await searchSongs(query, 5, source);
    } catch (error) {
      console.error('Error buscando canciones en /search:', error);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error, { source }))],
      });
      return;
    }

    if (results.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Error)
            .setDescription(describeMusicError({ errorCode: 'CANNOT_RESOLVE_SONG' }, { source })),
        ],
      });
      return;
    }

    const resultsDescription = results
      .map((item, index) => {
        const duration = item.duration ? formatDuration(item.duration * 1000) : 'Desconocida';
        const uploader = item.uploader ? ` • *${item.uploader}*` : '';
        return `**${index + 1}.** [${item.title}](${item.url})\n⏱️ \`${duration}\`${uploader}`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(BotColors.Info)
      .setTitle(`🎵 Resultados de búsqueda: "${query}"`)
      .setDescription(resultsDescription)
      .setFooter({ text: 'Selecciona una canción del menú desplegable abajo en menos de 60 segundos.' })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`search_select_${interaction.id}`)
      .setPlaceholder('Elige una canción para reproducir...')
      .addOptions(
        results.map((item, index) => {
          const duration = item.duration ? ` [${formatDuration(item.duration * 1000)}]` : '';
          const desc = `${item.uploader ?? 'Canción'}${duration}`.slice(0, 100);

          return new StringSelectMenuOptionBuilder()
            .setLabel(`${index + 1}. ${item.title}`.slice(0, 100))
            .setDescription(desc)
            .setValue(String(index));
        }),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    try {
      const selectInteraction = await response.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        componentType: ComponentType.StringSelect,
        time: 60_000,
      });

      const selectedIndex = parseInt(selectInteraction.values[0] ?? '0', 10);
      const selectedItem = results[selectedIndex] ?? results[0];

      if (!selectedItem) return;

      await selectInteraction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Success)
            .setDescription(`🎵 Seleccionaste: [**${selectedItem.title}**](${selectedItem.url})`),
        ],
        components: [],
      });

      const distube = interaction.client.distube;
      const playOptions: PlayOptions<PlaybackMetadata> = {
        member: member!,
        metadata: { searchSource: source },
      };
      const textChannel = isGuildTextChannel(interaction.channel) ? interaction.channel : undefined;
      if (textChannel) {
        playOptions.textChannel = textChannel;
      }

      try {
        await distube.play<PlaybackMetadata>(voiceChannel, selectedItem.url, playOptions);
      } catch (playError: unknown) {
        console.error('Error reproduciendo selección en /search:', playError);
        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(BotColors.Error)
              .setDescription(describeMusicError(playError, { source, songName: selectedItem.title })),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    } catch {
      // Si pasan los 60s sin interacción, quitamos el menú de selección
      await interaction
        .editReply({
          components: [],
        })
        .catch(() => {});
    }
  },
};
