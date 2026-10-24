# http-100-continue-handshake-state-utils

Tracks the state machine for when a client should send a request body pending a 100 Continue interim response.

```js
import { HandshakeStateMachine } from 'http-100-continue-handshake-state-utils';

const sm = new HandshakeStateMachine();
// headers including "Expect: 100-continue" are now on the wire
sm.beginAwaiting();

// later, an interim 100 Continue arrives
sm.onContinue();
if (sm.shouldSendBody()) {
  // transmit the request body
}

// or instead, a final response arrives first
// sm.onFinalResponse(417);
// sm.isTerminal() === true, do not send the body
```

## Why this exists

HTTP clients that use `Expect: 100-continue` must decide whether to send the request body based on what the server says next: a `100 Continue` interim response means "go ahead", while any final response (such as `417 Expectation Failed`, or even a surprising `200 OK`) means "stop — do not send the body". Getting this wrong wastes bandwidth or deadlocks the connection. This library encapsulates that decision as a small, explicit state machine so the caller's transport code does not have to re-derive it.

The trade-off: the machine owns the handshake transitions but **not** time. There is no built-in timeout. If the server never responds, the client must decide when to give up and call `abort()`. Folding a timer in here would mean importing a clock dependency or relying on `setTimeout`, both of which make the machine harder to test deterministically. The caller owns the clock; the machine owns the states.

## The awkward edge

A `100 Continue` can arrive **before** the caller calls `beginAwaiting()`. This happens when the interim response comes back faster than the event loop gets to register the awaiting state. The machine accepts `onContinue()` directly from the initial `EXPECT_SENT` state for exactly this reason. Do not treat `beginAwaiting()` as a prerequisite for `onContinue()` — it is only a prerequisite for entering the `AWAITING_CONTINUE` state.

Once `onFinalResponse()` is called, the machine is terminal and `abort()` will throw. If you need to record a transport error after a final response, do it in your own layer; the handshake is already settled.
