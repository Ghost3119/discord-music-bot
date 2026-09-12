import { ChatInputCommandInteraction, Guild, MessageFlags } from 'discord.js';

/**
 * Ensures the interaction was invoked from within a guild.
 * Replies with an ephemeral error and returns `null` when the guild is missing.
 */
export async function ensureGuild(interaction: ChatInputCommandInteraction): Promise<Guild | null> {
  if (interaction.guild) return interaction.guild;

  await interaction.reply({
    content: '❌ Este comando solo funciona dentro de un servidor.',
    flags: MessageFlags.Ephemeral,
  });
  return null;
}
