import './types';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config';
import { handleInteraction } from './events/interactionCreate';
import { handleButton } from './events/buttonHandler';
import { createDisTube } from './music/distube';
import { registerDisTubeEvents } from './music/events';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.distube = createDisTube(client);
registerDisTubeEvents(client.distube);

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot conectado como ${c.user?.tag}`);
});
client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) await handleButton(interaction);
});

client.login(config.token);

export { client };