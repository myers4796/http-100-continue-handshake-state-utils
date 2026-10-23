import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandshakeStateMachine } from '../src/index.js';

test('starts in EXPECT_SENT', () => {
  const sm = new HandshakeStateMachine();
  assert.equal(sm.getState(), 'EXPECT_SENT');
  assert.equal(sm.shouldSendBody(), false);
  assert.equal(sm.isTerminal(), false);
});

test('happy path: begin, continue, send body', () => {
  const sm = new HandshakeStateMachine();
  sm.beginAwaiting();
  assert.equal(sm.getState(), 'AWAITING_CONTINUE');
  assert.equal(sm.shouldSendBody(), false);
  sm.onContinue();
  assert.equal(sm.getState(), 'CONTINUE_RECEIVED');
  assert.equal(sm.shouldSendBody(), true);
  assert.equal(sm.isTerminal(), false);
});

test('onContinue before beginAwaiting is accepted', () => {
  const sm = new HandshakeStateMachine();
  sm.onContinue();
  assert.equal(sm.getState(), 'CONTINUE_RECEIVED');
  assert.equal(sm.shouldSendBody(), true);
});

test('final response before continue stops body transmission', () => {
  const sm = new HandshakeStateMachine();
  sm.beginAwaiting();
  sm.onFinalResponse(417);
  assert.equal(sm.getState(), 'FINAL_RECEIVED');
  assert.equal(sm.shouldSendBody(), false);
  assert.equal(sm.isTerminal(), true);
});

test('final response without beginAwaiting is accepted', () => {
  const sm = new HandshakeStateMachine();
  sm.onFinalResponse(200);
  assert.equal(sm.getState(), 'FINAL_RECEIVED');
  assert.equal(sm.isTerminal(), true);
});

test('abort before any response is terminal', () => {
  const sm = new HandshakeStateMachine();
  sm.beginAwaiting();
  sm.abort();
  assert.equal(sm.getState(), 'ABORTED');
  assert.equal(sm.shouldSendBody(), false);
  assert.equal(sm.isTerminal(), true);
});

test('abort after continue is allowed', () => {
  const sm = new HandshakeStateMachine();
  sm.beginAwaiting();
  sm.onContinue();
  sm.abort();
  assert.equal(sm.getState(), 'ABORTED');
  assert.equal(sm.isTerminal(), true);
});

test('abort is idempotent', () => {
  const sm = new HandshakeStateMachine();
  sm.abort();
  sm.abort(); // must not throw
  assert.equal(sm.getState(), 'ABORTED');
});

test('beginAwaiting throws after already awaiting', () => {
  const sm = new HandshakeStateMachine();
  sm.beginAwaiting();
  assert.throws(() => sm.beginAwaiting(), /Cannot begin awaiting/);
});

test('onContinue throws after final received', () => {
  const sm = new HandshakeStateMachine();
  sm.onFinalResponse(401);
  assert.throws(() => sm.onContinue(), /Cannot receive 100 Continue/);
});

test('onFinalResponse throws after already final', () => {
  const sm = new HandshakeStateMachine();
  sm.onFinalResponse(500);
  assert.throws(() => sm.onFinalResponse(200), /Cannot receive final response/);
});

test('onFinalResponse rejects non-numeric status', () => {
  const sm = new HandshakeStateMachine();
  assert.throws(() => sm.onFinalResponse('200'), /statusCode must be a finite number/);
  assert.throws(() => sm.onFinalResponse(NaN), /statusCode must be a finite number/);
});

test('abort throws after final received', () => {
  const sm = new HandshakeStateMachine();
  sm.onFinalResponse(403);
  assert.throws(() => sm.abort(), /Cannot abort/);
});
