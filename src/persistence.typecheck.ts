import type { Track as DomainTrack } from './domain/persistence';
import type { Track as WebTrack } from './web/contracts';
type Assert<T extends true> = T;
export type TrackCompatibility = Assert<[DomainTrack] extends [WebTrack] ? [WebTrack] extends [DomainTrack] ? true : false : false>;
