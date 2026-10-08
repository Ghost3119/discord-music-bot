import { ButtonInteraction, ChatInputCommandInteraction, Guild, MessageFlags } from 'discord.js';
import { Queue } from 'distube';

/**
 * Ensures the interaction was invoked from within a guild.
 * Replies with an ephemeral error and returns `null` when the guild is missing.
 */
export async function ensureGuild(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<Guild | null> {
  if (interaction.guild) return interaction.guild;

  await interaction.reply({
    content: '❌ Este comando solo funciona dentro de un servidor.',
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

export async function ensureControlChannel(interaction: ChatInputCommandInteraction | ButtonInteraction, queue: Queue): Promise<boolean> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (member?.voice.channel?.id && member.voice.channel.id === queue.voiceChannel?.id) return true;
  const content = '❌ Debes estar en el mismo canal de voz que el bot.';
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  return false;
}
