import './types';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config';
import { handleInteraction } from './events/interactionCreate';
import { createDisTube } from './music/distube';
import { registerDisTubeEvents } from './music/events';
import { guardedEvent } from './runtime/safety';
import { QueueRecovery } from './music/queueRecovery';
import { registerEmptyVoice } from './music/emptyVoice';

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.distube = createDisTube(client);
registerDisTubeEvents(client.distube);
export const stopEmptyVoice = registerEmptyVoice(client, client.distube);
export const queueRecovery = new QueueRecovery(client, client.distube);

client.once(Events.ClientReady, guardedEvent('Recuperar colas al iniciar', async (readyClient) => {
  console.log(`✅ Bot conectado como ${readyClient.user.tag}`);
  await queueRecovery.restore();
}));
client.on(Events.Error, (error) => console.error('[Discord client]', error));
client.on(Events.ShardError, (error, shard) => console.error(`[Discord shard ${shard}]`, error));
client.on(Events.Warn, (message) => console.warn('[Discord]', message));
client.on(Events.InteractionCreate, guardedEvent('Interacción de Discord', handleInteraction));

client.on(Events.Raw, guardedEvent('Paquete de voz', (packet: { t?: string }) => {
  if (packet.t === 'VOICE_STATE_UPDATE' || packet.t === 'VOICE_SERVER_UPDATE') console.log(`[Gateway Voice Packet] ${packet.t}`);
}));
client.on(Events.VoiceStateUpdate, guardedEvent('Estado de voz', (_oldState, newState) => {
  if (newState.member?.id === client.user?.id) console.log(`[Bot Voice State] Canal: ${newState.channel?.name ?? 'desconectado'}`);
}));

export async function startBot(): Promise<void> {
  await client.login(config.token);
}
