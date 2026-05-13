import { Events, Client } from 'discord.js';

export const ready = {
  event: Events.ClientReady as const,
  once: true,
  execute: (client: Client) => {
    console.log(`✅ Bot conectado como ${client.user?.tag}`);
  },
};