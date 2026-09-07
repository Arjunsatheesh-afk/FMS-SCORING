import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type VideoSource = string | { uri: string; headers?: Record<string, string> } | null;

interface AuthedVideoSource {
  source: VideoSource;
  loading: boolean;
  error: string | null;
}

/**
 * A playable source for an endpoint that requires a bearer token.
 *
 * Native players send custom headers, so there the source is just the URL plus
 * an Authorization header. The web is different: VideoView renders a plain
 * HTML <video>, and a browser's media loader cannot attach custom headers to
 * its own request - it fires an unauthenticated GET and the server (correctly)
 * answers 401, which surfaces as MEDIA_ELEMENT_ERROR: Format error.
 *
 * So on web the video is fetched with fetch(), which *can* carry the header,
 * and handed to the player as an object URL instead. The route's auth gate is
 * untouched; only the way the bytes are retrieved differs.
 *
 * The trade-off is that web buffers the whole file before playing. These
 * overlays are 1-5 MB, so that is a short wait rather than a problem.
 *
 * Object URLs are kept alive for as long as the screen is mounted, one per
 * screening, and only revoked on unmount.
 *
 * Revoking on every source swap was the obvious thing to do and it was wrong.
 * expo-video's web player builds a fresh <video> element for each replace and
 * abandons the previous one with its src still set, so revoking immediately
 * left every previously-viewed screening pointing at a URL that no longer
 * resolved. Anything that made those elements reload - and the browser does it
 * on its own under memory pressure - fired one ERR_FILE_NOT_FOUND per screening
 * ever opened, all at once. Measured directly: five screenings opened in
 * sequence left four abandoned elements holding revoked URLs, and forcing them
 * to reload produced exactly four simultaneous errors.
 *
 * Holding the URLs means the abandoned elements keep resolving, so nothing
 * errors. It does not stop them accumulating: each still pins a decoded copy of
 * its overlay, so a long session keeps growing. That is the known remaining
 * half of the problem, recorded in PROJECT_STATUS.md item 7 - fixing it means
 * getting rid of blob URLs for the overlay entirely, which is a larger change
 * than this one.
 */
export function useAuthedVideoSource(url: string | null, token: string | null): AuthedVideoSource {
  const [source, setSource] = useState<VideoSource>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Screening video URL -> object URL. Job ids are immutable, so a screening
  // fetched once never needs fetching again while the screen is open.
  const objectUrls = useRef(new Map<string, string>());

  useEffect(() => {
    if (!url || !token) {
      setSource(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (Platform.OS !== 'web') {
      setSource({ uri: url, headers: { Authorization: `Bearer ${token}` } });
      setError(null);
      setLoading(false);
      return;
    }

    const cached = objectUrls.current.get(url);
    if (cached) {
      // Reopening a screening is instant, with no second copy of the bytes.
      setSource(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          throw new Error(`Could not load video (${response.status})`);
        }
        const blob = await response.blob();
        // Cached even when the row has already been closed: the bytes are paid
        // for, and the unmount cleanup below is what releases them.
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.current.set(url, objectUrl);
        if (cancelled) {
          return;
        }
        setSource(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setSource(null);
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      // Deliberately does not revoke - see the note above the hook.
      cancelled = true;
    };
  }, [url, token]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      urls.clear();
    };
  }, []);

  return { source, loading, error };
}
