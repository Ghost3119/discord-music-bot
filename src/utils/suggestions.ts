/**
 * Fetches search suggestions for YouTube queries using the lightweight suggest API.
 * Uses a 2-second timeout to respect Discord's 3-second autocomplete response deadline.
 */
export async function fetchSearchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2 || /^https?:\/\//i.test(trimmed)) {
    return [];
  }

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!response.ok) return [];

    const data: unknown = await response.json();
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return (data[1] as unknown[])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 25);
    }

    return [];
  } catch {
    return [];
  }
}
