import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { ButtonId, createPlayerButtons, createQueueEmbed } from '../utils/embed';
import { BotColors } from '../utils/colors';

export async function handleButton(interaction: ButtonInteraction) {
  if (!interaction.guild) return;

  const distube = interaction.client.distube;
  const queue = distube.getQueue(interaction.guild.id);

  if (!interaction.member || !('voice' in interaction.member)) return;
  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member?.voice.channel) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (interaction.customId) {
    case ButtonId.PauseResume: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (queue.paused) {
        await queue.resume();
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription('▶️ Música reanudada.')] });
      } else {
        await queue.pause();
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('⏸️ Música pausada.')] });
      }
      const row = createPlayerButtons(queue.paused);
      await interaction.message.edit({ components: [row] }).catch(() => {});
      break;
    }

    case ButtonId.Skip: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const song = await queue.skip();
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription(`⏭️ Saltando a: **${song.name}**`)],
        });
      } catch {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay más canciones.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      break;
    }

    case ButtonId.Stop: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: MessageFlags.Ephemeral });
        return;
      }
      await queue.stop();
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('⏹️ Música detenida.')],
      });
      break;
    }

    case ButtonId.Queue: {
      if (!queue) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = createQueueEmbed(queue);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      break;
    }
  }
}
