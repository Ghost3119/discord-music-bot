import { DisTube } from 'distube';

declare module 'discord.js' {
  interface Client {
    distube: DisTube;
  }
}