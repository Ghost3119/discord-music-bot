import './types';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config';
import { handleInteraction } from './events/interactionCreate';
import { handleButton } from './events/buttonHandler';
import { createDisTube } from './music/distube';
import { registerDisTubeEvents } from './music/events';
import { download } from '@distube/yt-dlp';

async function updateYtDlp(): Promise<void> {
  try {
    const version = await download();
    console.log(`✅ yt-dlp actualizado a ${version}`);
  } catch {
    console.warn('⚠️ No se pudo actualizar yt-dlp, usando versión existente');
  }
}

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

// Logs de diagnóstico para eventos de voz de Discord Gateway
client.on(Events.Raw, (packet: { t?: string }) => {
  if (packet.t === 'VOICE_STATE_UPDATE' || packet.t === 'VOICE_SERVER_UPDATE') {
    console.log(`[Gateway Voice Packet] ${packet.t}`);
  }
});

client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
  if (newState.member?.id === client.user?.id) {
    console.log(`[Bot Voice State] Canal: ${newState.channel?.name ?? 'desconectado'} (${newState.channelId ?? 'ninguno'})`);
  }
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) await handleButton(interaction);
});

process.on('SIGINT', () => {
  console.log('🔌 Apagando bot...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔌 Apagando bot...');
  client.destroy();
  process.exit(0);
});

void updateYtDlp().then(() => client.login(config.token));

export { client };