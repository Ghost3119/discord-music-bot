import type { useLibrary } from '../src/features/library/use-library';
import type { useSonoraApp } from '../src/hooks/use-sonora-app';

// Compiled by the frontend build; neither hook nor these examples are executed.
export function verifyLibraryEditorApi(
  library: ReturnType<typeof useLibrary>,
  app: ReturnType<typeof useSonoraApp>,
) {
  for (const editor of [library, app]) {
    editor.onTrackTitleChange('Título manual');
    editor.onTrackArtistChange('Artista manual');
    editor.setTrackUrl('https://www.youtube.com/watch?v=selected');
    editor.setName('Mi playlist');
  }

  // @ts-expect-error Artist edits must preserve the editor's touched invariant.
  library.setTrackArtist('Artista');
  // @ts-expect-error Title touched state is internal to the editor.
  library.setTitleTouched(true);
  // @ts-expect-error Artist touched state is internal to the editor.
  library.setArtistTouched(true);
  // @ts-expect-error The application must not re-expose the internal artist setter.
  app.setTrackArtist('Artista');
  // @ts-expect-error The application must not re-expose title touched state.
  app.setTitleTouched(true);
  // @ts-expect-error The application must not re-expose artist touched state.
  app.setArtistTouched(true);
}
