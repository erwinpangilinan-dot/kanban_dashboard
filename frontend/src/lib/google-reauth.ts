import { api } from '../api/client';

/**
 * Starting the Google flow requires a session, so it cannot be a plain link —
 * a browser navigation carries no auth header. Ask the API for the consent URL
 * first, then send the browser there.
 */
export async function beginGoogleReauth() {
  try {
    const { url } = await api.startGoogleOAuth();
    window.location.href = url;
  } catch (err) {
    window.alert(
      err instanceof Error ? err.message : 'Could not start Google re-authentication.'
    );
  }
}
