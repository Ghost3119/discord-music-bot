import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { ButtonId, createQueueButtons, createQueueEmbed } from '../utils/embed';
import { BotColors } from '../utils/colors';
import { describeMusicError } from '../music/errors';
import { getPlayerPanels } from '../music/playerPanel';
import { getPlaybackHealth } from '../music/playbackHealth';
import { historyView } from '../music/historyView';
import { playRequest } from '../commands/play';
import { checkpointQueue } from '../music/queueChanges';
import { ensureControlChannel } from '../utils/guard';
import { controlError, installQueueControlGuard, withMusicAccess } from '../music/controlAccess';
import { getPlaybackState } from '../music/playbackState';

export async function handleButton(interaction: ButtonInteraction) {
  if (!interaction.guild) return;

  const distube = interaction.client.distube;
  const historyMatch = /^hist_(page|retry):(\d{15,22}):([a-f0-9]{16}|\d{1,3})$/.exec(interaction.customId);
  if (historyMatch) {
    const history = getPlaybackHealth(distube)?.history;
    if (!history || historyMatch[2] !== interaction.guild.id) {
      await interaction.reply({ content: 'Este historial no está disponible para este servidor.', flags: MessageFlags.Ephemeral }); return;
    }
    if (historyMatch[1] === 'page') {
      await interaction.deferUpdate();
      await interaction.editReply(historyView(history, interaction.guild.id, Number(historyMatch[3])));
    } else {
      const current = distube.getQueue(interaction.guild.id);
      if (current && !await ensureControlChannel(interaction, current)) return;
      if (!interaction.guild.members.cache.get(interaction.user.id)?.voice.channel) {
        await interaction.reply({ content: 'Debes estar en un canal de voz para volver a intentarlo.', flags: MessageFlags.Ephemeral }); return;
      }
      const entry = history.claim(interaction.guild.id, historyMatch[3]!);
      if (!entry?.url) { await interaction.reply({ content: 'La entrada venció o ya se intentó hace menos de 30 segundos.', flags: MessageFlags.Ephemeral }); return; }
      await playRequest(interaction, entry.url, entry.searchSource, true);
    }
    return;
  }
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

  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    const wasBlocked = Boolean(getPlaybackState(queue)?.blocked);
    installQueueControlGuard(queue);
    return withMusicAccess(distube, () => {
      if (distube.getQueue(queue.id) !== queue || queue.stopped || !panels.owns(queue, interaction.message.id)) throw controlError('SESSION_CHANGED', 'La sesión terminó mientras esperaba.');
      const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
      if (!voice || voice.id !== queue.voiceChannel?.id) throw controlError('CONTROL_CHANNEL_REQUIRED', 'Debes estar en el mismo canal de voz que el bot.');
      const permissions = interaction.client.user && voice.permissionsFor(interaction.client.user.id);
      if (interaction.client.user && (!permissions || !['ViewChannel', 'Connect', 'Speak'].every(flag => permissions.has(flag as 'ViewChannel' | 'Connect' | 'Speak')))) throw controlError('VOICE_PERMISSIONS', 'Faltan permisos para conectar o hablar.');
      if (getPlaybackState(queue)?.blocked && (interaction.customId === ButtonId.Skip || interaction.customId === ButtonId.PauseResume && !wasBlocked)) throw controlError('QUEUE_BLOCKED', 'La cola está pausada por fallos. Usa Reintentar o Detener.');
    }, operation);
  };

  switch (interaction.customId) {
    case ButtonId.History: {
      const history = getPlaybackHealth(distube)?.history;
      if (history) await interaction.editReply(historyView(history, interaction.guild.id));
      else await interaction.editReply({ content: 'El historial todavía no está disponible.' });
      break;
    }
    case ButtonId.Retry: {
      await run(async () => getPlaybackHealth(distube)?.retryBlocked(queue));
      checkpointQueue(distube, queue); await panels.refresh(queue);
      await interaction.editReply({ content: '🔄 Iniciada una prueba de recuperación de la cola.' });
      break;
    }
    case ButtonId.PauseResume: {
      if (queue.paused) {
        await run(() => queue.resume());
        await panels.refresh(queue);
        await interaction.editReply({ content: '▶️ Música reanudada.' });
      } else {
        await run(() => queue.pause());
        await panels.refresh(queue);
        await interaction.editReply({ content: '⏸️ Música pausada.' });
      }
      break;
    }

    case ButtonId.Skip: {
      try {
        const song = await run(() => queue.skip());
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
      await run(() => queue.stop());
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
