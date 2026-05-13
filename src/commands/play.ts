import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { resolveAppleMusic } from '../utils/appleMusic';

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce música de YouTube, Spotify, SoundCloud o Apple Music')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('URL o nombre de la canción').setRequired(true),
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

    const rawQuery = interaction.options.getString('query', true);
    const resolved = await resolveAppleMusic(rawQuery);

    const displayQuery = resolved.isAppleMusic && resolved.artist && resolved.title
      ? `${resolved.artist} - ${resolved.title}`
      : resolved.query;

    await interaction.reply({
      embeds: [
        new EmbedBuilder().setColor('#FFD700').setDescription(`🔍 Buscando: **${displayQuery}**...`),
      ],
    });

    try {
      const distube = interaction.client.distube;
      await distube.play(voiceChannel, resolved.query, {
        textChannel: interaction.channel as any,
        member: member!,
      });
    } catch (error) {
      console.error('Error en /play:', error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#FF0000')
            .setDescription('❌ No se pudo reproducir la canción. Verifica el enlace o el nombre.'),
        ],
      });
    }
  },
};