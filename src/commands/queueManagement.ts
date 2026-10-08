import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from './command.types';
import { ensureControlChannel, ensureGuild } from '../utils/guard';
import { editQueue, QueueAction } from '../music/queueActions';

function management(name: string, description: string, options: (builder: SlashCommandBuilder) => SlashCommandBuilder,
  action: (interaction: Parameters<Command['execute']>[0]) => QueueAction): Command {
  return { data: options(new SlashCommandBuilder().setName(name).setDescription(description)), async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;
    const distube = interaction.client.distube, queue = distube.getQueue(guild.id);
    if (!queue) { await interaction.reply({ content: '❌ No hay cola de reproducción.', flags: MessageFlags.Ephemeral }); return; }
    if (!await ensureControlChannel(interaction, queue)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await editQueue(distube, queue, action(interaction), () =>
      guild.members.cache.get(interaction.user.id)?.voice.channel?.id === queue.voiceChannel?.id);
    await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
  } };
}
export const shuffle = management('shuffle', 'Mezcla las canciones pendientes', builder => builder, () => ({ type: 'shuffle' }));
export const remove = management('remove', 'Retira una canción pendiente', builder => builder.addIntegerOption(option =>
  option.setName('posicion').setDescription('Primera pendiente: 1').setMinValue(1).setRequired(true)) as SlashCommandBuilder,
  interaction => ({ type: 'remove', position: interaction.options.getInteger('posicion', true) }));
export const clear = management('clear', 'Retira las pendientes y conserva la canción actual', builder => builder, () => ({ type: 'clear' }));
export const move = management('move', 'Cambia la posición de una canción pendiente', builder => builder
  .addIntegerOption(option => option.setName('origen').setDescription('Posición actual; primera pendiente: 1').setMinValue(1).setRequired(true))
  .addIntegerOption(option => option.setName('destino').setDescription('Posición final; primera pendiente: 1').setMinValue(1).setRequired(true)) as SlashCommandBuilder,
  interaction => ({ type: 'move', from: interaction.options.getInteger('origen', true), to: interaction.options.getInteger('destino', true) }));
