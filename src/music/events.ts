import { DisTube, Events } from 'distube';
import { EmbedBuilder } from 'discord.js';
import { createNowPlayingEmbed, createAddQueueEmbed, createPlayerButtons } from '../utils/embed';

export function registerDisTubeEvents(distube: DisTube) {
  distube.on(Events.PLAY_SONG, (queue, song) => {
    const embed = createNowPlayingEmbed(song);
    const row = createPlayerButtons(false);
    queue.textChannel?.send({ embeds: [embed], components: [row] });
  });

  distube.on(Events.ADD_SONG, (queue, song) => {
    queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
  });

  distube.on(Events.DISCONNECT, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('🔌 Desconectado del canal de voz.')],
    });
  });

  distube.on(Events.ERROR, (error, queue) => {
    console.error('DisTube Error:', error);
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error: ${error.message ?? 'Error desconocido'}`)],
    });
  });

  distube.on(Events.NO_RELATED, (queue) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('🔇 No se encontraron canciones relacionadas.')],
    });
  });
}