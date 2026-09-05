import { useEffect, useState } from 'react';
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
 */
export function useAuthedVideoSource(url: string | null, token: string | null): AuthedVideoSource {
  const [source, setSource] = useState<VideoSource>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          throw new Error(`Could not load video (${response.status})`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
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
      cancelled = true;
      // Release the blob when the row closes or the screening changes,
      // otherwise every expand leaks another copy of the video.
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, token]);

  return { source, loading, error };
}
