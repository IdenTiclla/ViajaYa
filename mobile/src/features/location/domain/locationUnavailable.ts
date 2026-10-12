import { routingUnavailableMessage, type RoutingUnavailableReason } from './gateCopy';

/**
 * A fresh position is not available. The reason is typed so callers react (re-read the
 * gate, keep the last estimate) instead of echoing a generic failure message.
 */
export class LocationUnavailableError extends Error {
  readonly reason: RoutingUnavailableReason;

  constructor(reason: RoutingUnavailableReason) {
    super(routingUnavailableMessage(reason));
    this.name = 'LocationUnavailableError';
    this.reason = reason;
  }
}
