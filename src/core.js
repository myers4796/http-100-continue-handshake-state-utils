/**
 * HTTP 100-Continue handshake state machine.
 *
 * When a client sends a request with "Expect: 100-continue" and a request body,
 * it typically waits for a 100 Continue interim response before sending the
 * body. The server may instead send a final response (e.g. 417 Expectation
 * Failed, or even 200 OK), which means the client should NOT send the body.
 *
 * Decision: this machine is a strict guard around three terminal transitions:
 * receiving 100 Continue, receiving a final status, or aborting. It does NOT
 * enforce timeouts — callers own the clock and pass a decision in. This keeps
 * the machine pure and deterministic, which is the trade-off: more caller
 * responsibility, but no hidden timers or hidden time-based edge cases.
 */

/** @typedef {'EXPECT_SENT' | 'AWAITING_CONTINUE' | 'CONTINUE_RECEIVED' | 'FINAL_RECEIVED' | 'ABORTED'} State */

export class HandshakeStateMachine {
  /**
   * Creates the machine in the EXPECT_SENT state. The caller has just sent the
   * request headers including "Expect: 100-continue".
   *
   * We do not start in AWAITING_CONTINUE because some HTTP implementations
   * flush headers and begin reading immediately, while others defer. EXPECT_SENT
   * is the honest starting point; the caller calls beginAwaiting() once the
   * headers are actually on the wire and the client has committed to waiting.
   */
  constructor() {
    /** @type {State} */
    this.state = 'EXPECT_SENT';
  }

  /**
   * Returns the current state.
   * @returns {State}
   */
  getState() {
    return this.state;
  }

  /**
   * Returns true when it is legal for the client to begin transmitting the
   * request body. This is true only after a 100 Continue has been received.
   *
   * @returns {boolean}
   */
  shouldSendBody() {
    return this.state === 'CONTINUE_RECEIVED';
  }

  /**
   * Returns true once the handshake is in a terminal state where the client
   * must not send any body and should stop waiting.
   *
   * @returns {boolean}
   */
  isTerminal() {
    return this.state === 'FINAL_RECEIVED' || this.state === 'ABORTED';
  }

  /**
   * Call once the request headers are on the wire and the client is waiting for
   * either a 100 Continue or a final response.
   *
   * Throws if the machine is not in EXPECT_SENT or CONTINUE_RECEIVED — the
   * former being the normal path, the latter being a no-op re-entry we tolerate
   * because some HTTP stacks call this defensively after a redirect.
   */
  beginAwaiting() {
    if (this.state !== 'EXPECT_SENT') {
      throw new Error(
        `Cannot begin awaiting: state is ${this.state}, expected EXPECT_SENT`
      );
    }
    this.state = 'AWAITING_CONTINUE';
  }

  /**
   * Record that a 100 Continue interim response was received. The client may
   * now send the body.
   *
   * It is legal to receive 100 Continue before beginAwaiting() is called, so we
   * accept it from EXPECT_SENT directly. This handles stacks where the interim
   * response arrives before the caller has flipped into AWAITING_CONTINUE.
   */
  onContinue() {
    if (this.state !== 'AWAITING_CONTINUE' && this.state !== 'EXPECT_SENT') {
      throw new Error(
        `Cannot receive 100 Continue: state is ${this.state}`
      );
    }
    this.state = 'CONTINUE_RECEIVED';
  }

  /**
   * Record that a final response was received without a preceding 100 Continue.
   *
   * Accepts a status code purely so the caller can pass it through; the machine
   * itself does not branch on the code because RFC 7231 §6.2.1 is clear that
   * any non-1xx response terminates the wait. Branching here would duplicate
   * the server's decision logic inside the client, which is a common bug source.
   *
   * @param {number} statusCode
   */
  onFinalResponse(statusCode) {
    if (typeof statusCode !== 'number' || !Number.isFinite(statusCode)) {
      throw new TypeError('statusCode must be a finite number');
    }
    if (this.state === 'FINAL_RECEIVED' || this.state === 'ABORTED') {
      throw new Error(
        `Cannot receive final response: state is ${this.state}`
      );
    }
    this.state = 'FINAL_RECEIVED';
  }

  /**
   * Abort the handshake, for example because the connection was closed or the
   * caller gave up. After this, the machine is terminal.
   *
   * Aborting from CONTINUE_RECEIVED is allowed: the client may have started
   * sending the body and then hit a transport error. We record the abort
   * regardless, because the machine's job is to reflect the handshake, not the
   * body transmission.
   */
  abort() {
    if (this.state === 'ABORTED') {
      return; // idempotent — aborting an aborted handshake is a no-op
    }
    if (this.state === 'FINAL_RECEIVED') {
      throw new Error('Cannot abort: handshake already finalized');
    }
    this.state = 'ABORTED';
  }
}
