import { ButtonInteraction, ChatInputCommandInteraction, GuildTextBasedChannel, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { SearchSource } from '../music/ytDlpSearchPlugin';
import { describeMusicError } from '../music/errors';
import { ensureControlChannel, ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { fetchSearchSuggestions } from '../utils/suggestions';
import { requestPlayback } from '../music/playbackRequest';
import { controlError } from '../music/controlAccess';

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
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply(privateReply ? { flags: MessageFlags.Ephemeral } : {});

    try {
      await requestPlayback(distube, {
        guildId: guild.id, member: member!, voiceChannel, query: rawQuery, searchSource,
        ...(isGuildTextChannel(interaction.channel) ? { textChannel: interaction.channel } : {}),
        authorize: () => {
          const current = guild.members.cache.get(interaction.user.id)?.voice.channel;
          if (current?.id !== voiceChannel.id || initialQueue && current?.id !== initialQueue.voiceChannel?.id) {
            throw controlError('CONTROL_CHANNEL_REQUIRED', 'Debes seguir en el mismo canal de voz que el bot.');
          }
          const currentPermissions = current?.permissionsFor(interaction.client.user!.id);
          if (!missingPermissions.every(({ flag }) => currentPermissions?.has(flag))) {
            throw controlError('VOICE_PERMISSIONS', 'Faltan permisos para conectar o hablar en el canal de voz.');
          }
        },
        searching: async displayQuery => {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(BotColors.Gold).setDescription(`🔍 Buscando: **${displayQuery}**...`)] });
        },
      });    } catch (error: unknown) {
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
