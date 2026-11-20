import {
  initialTranscript,
  reduceTranscript,
  type HarnessEvent,
  type TranscriptState,
} from '@harnesskit/core';
import { useCallback, useReducer } from 'react';

type Action = HarnessEvent | { type: '@@reset'; state: TranscriptState };

function reducer(state: TranscriptState, action: Action): TranscriptState {
  return action.type === '@@reset' ? action.state : reduceTranscript(state, action);
}

/** Transcript state plus stable dispatchers. */
export function useTranscript(initial: TranscriptState = initialTranscript) {
  const [state, dispatchAction] = useReducer(reducer, initial);
  const dispatch = useCallback((events: HarnessEvent | readonly HarnessEvent[]) => {
    for (const event of Array.isArray(events) ? events : [events]) dispatchAction(event as HarnessEvent);
  }, []);
  const reset = useCallback((to: TranscriptState = initialTranscript) => {
    dispatchAction({ type: '@@reset', state: to });
  }, []);
  return { state, dispatch, reset };
}
