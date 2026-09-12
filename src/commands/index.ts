import { play } from './play';
import { skip } from './skip';
import { stop } from './stop';
import { queue } from './queue';
import { nowplaying } from './nowplaying';
import { pause } from './pause';
import { resume } from './resume';
import { volume } from './volume';
import { shuffle } from './shuffle';
import { loop } from './loop';
import { seek } from './seek';
import { remove } from './remove';

export const commands = [play, skip, stop, queue, nowplaying, pause, resume, volume, shuffle, loop, seek, remove];