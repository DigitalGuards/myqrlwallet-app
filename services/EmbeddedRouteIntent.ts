/**
 * Holds one pending in-document route for the embedded wallet.
 *
 * A qrlwallet.com universal link cannot be loaded as a document any more, so
 * the tap is recorded here as a hash route and applied inside the running
 * wallet once the app is unlocked and the document is up. One slot only: a
 * second tap replaces the first, the same way a second navigation would.
 *
 * This carries no secret. Pairing URIs keep going through NativeBridge, which
 * has its own authorization, document-binding and lifetime rules.
 */
import Logger from './Logger';

const ROUTE_INTENT_TTL_MS = 60_000;

type RouteListener = (route: string) => void;

class EmbeddedRouteIntentStore {
  private route: string | null = null;
  private expiresAt = 0;
  private listeners = new Set<RouteListener>();

  /** Record a route. Returns false when it is not a usable hash route. */
  queue(route: string): boolean {
    if (typeof route !== 'string' || !route.startsWith('#/') || route.length > 256) {
      return false;
    }
    this.route = route;
    this.expiresAt = Date.now() + ROUTE_INTENT_TTL_MS;
    Logger.debug('EmbeddedRouteIntent', 'Queued wallet route from a system link', route);
    for (const listener of this.listeners) listener(route);
    return true;
  }

  /** Take the pending route, if it has not expired. */
  consume(): string | null {
    const route = this.route;
    const expiresAt = this.expiresAt;
    this.clear();
    if (route === null || Date.now() >= expiresAt) return null;
    return route;
  }

  clear(): void {
    this.route = null;
    this.expiresAt = 0;
  }

  subscribe(listener: RouteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const EmbeddedRouteIntent = new EmbeddedRouteIntentStore();
export default EmbeddedRouteIntent;
