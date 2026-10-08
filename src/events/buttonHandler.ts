import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { ButtonId, createQueueButtons, createQueueEmbed } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { describeMusicError } from '../music/errors';
import { getPlayerPanels } from '../music/playerPanel';

export async function handleButton(interaction: ButtonInteraction) {
  if (!interaction.guild) return;

  const distube = interaction.client.distube;
  const queue = distube.getQueue(interaction.guild.id);
  const panels = getPlayerPanels(distube);
  const pageMatch = /^queue_page:([a-f0-9]{16}):(\d{1,6})$/.exec(interaction.customId);
  if (!pageMatch && !Object.values(ButtonId).includes(interaction.customId as ButtonId)) return;

  const current = queue && (pageMatch ? panels?.session(queue) === pageMatch[1] : panels?.owns(queue, interaction.message.id));
  if (!queue || !panels || !current) {
    await interaction.reply({ content: '⌛ Este panel pertenece a una sesión anterior. Usa `/nowplaying` para ver el reproductor actual.', flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ components: [] }).catch((error: unknown) => console.error('[Retirar controles antiguos]', error));
    return;
  }

  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member?.voice.channel) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (member.voice.channel.id !== queue.voiceChannel?.id) {
    await interaction.reply({ content: '❌ Debes estar en el mismo canal de voz que el bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (pageMatch) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // A session can end while Discord acknowledges the interaction. Never call
  // stop/pause/skip on an old Queue after a replacement has taken its guild ID.
  const stillCurrent = distube.getQueue(interaction.guild.id) === queue && (pageMatch
    ? panels.session(queue) === pageMatch[1] : panels.owns(queue, interaction.message.id));
  if (!stillCurrent) {
    await interaction.editReply({ content: '⌛ La sesión terminó. Usa `/nowplaying` para ver el reproductor actual.', embeds: [], components: [] });
    return;
  }

  if (pageMatch) {
    const page = Number(pageMatch[2]);
    const session = panels.session(queue);
    await interaction.editReply({ embeds: [createQueueEmbed(queue, page)], components: session ? createQueueButtons(queue, session, page) : [], allowedMentions: { parse: [] } });
    return;
  }

  switch (interaction.customId) {
    case ButtonId.PauseResume: {
      if (queue.paused) {
        await queue.resume();
        await panels.refresh(queue);
        await interaction.editReply({ content: '▶️ Música reanudada.' });
      } else {
        await queue.pause();
        await panels.refresh(queue);
        await interaction.editReply({ content: '⏸️ Música pausada.' });
      }
      break;
    }

    case ButtonId.Skip: {
      try {
        const song = await queue.skip();
        await panels.refresh(queue);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription(`⏭️ Saltando a: **${song.name}**`)],
        });
      } catch (error) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error))],
        });
      }
      break;
    }

    case ButtonId.Stop: {
      await queue.stop();
      await panels.close(queue, '⏹ Música detenida');
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('⏹️ Música detenida.')],
      });
      break;
    }

    case ButtonId.Queue: {
      const embed = createQueueEmbed(queue);
      const session = panels.session(queue);
      await interaction.editReply({ embeds: [embed], components: session ? createQueueButtons(queue, session) : [], allowedMentions: { parse: [] } });
      break;
    }
  }
}
