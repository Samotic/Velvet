'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_VOICE_SECONDS } from '@/lib/messages';

/**
 * Microphone capture for voice notes.
 *
 * ── The container ──
 * Browsers disagree on what MediaRecorder produces: Chrome and Firefox give
 * webm/opus, Safari gives mp4/aac. Rather than force one and fail on the
 * others, the first supported type wins and the backend's audio pattern accepts
 * all of them.
 *
 * ── Releasing the microphone ──
 * `MediaRecorder.stop()` ends the recording but leaves the underlying tracks
 * live, which keeps the browser's "recording" indicator lit and the mic held
 * open. Every exit path here goes through `release()`, including unmount — a
 * component that stops recording by navigating away must not leave the tab
 * holding the microphone.
 *
 * ── Secure context ──
 * `getUserMedia` is unavailable on plain http outside localhost, so in
 * production this only works over https. `supported` reflects that, and the
 * composer hides the button rather than offering one that cannot work.
 */
export function useRecorder(opts: { onAutoStop?: (clip: Blob | null) => void } = {}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<((clip: Blob | null) => void) | null>(null);
  const discardRef = useRef(false);
  /** True when the ceiling stopped the recorder, not the user. */
  const autoRef = useRef(false);
  /** Held in a ref so `start` does not need the callback in its deps. */
  const onAutoStopRef = useRef(opts.onAutoStop);
  onAutoStopRef.current = opts.onAutoStop;

  // Feature detection runs in an effect: `navigator` doesn't exist while the
  // component is being rendered on the server.
  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined',
    );
  }, []);

  const release = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    // Stopping the tracks is what actually frees the microphone.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  }, []);

  // Never leave the mic open because the thread unmounted mid-recording.
  useEffect(() => () => release(), [release]);

  /** Begins capture. Resolves false if permission was refused or unavailable. */
  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no input device — all the same to the caller.
      return false;
    }

    const preferred = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported(t));

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const settle = settleRef.current;
      settleRef.current = null;
      const auto = autoRef.current;
      autoRef.current = false;
      // `recorder.mimeType` rather than the requested one: the browser is
      // allowed to pick something else, and the Blob must be labelled with
      // what is actually inside it or the server rejects the data URL.
      const clip = discardRef.current
        ? null
        : new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      release();

      if (settle) {
        settle(clip);
        return;
      }
      /**
       * The ceiling stopped it, so nobody is awaiting `stop()` and there is no
       * promise to settle. Without this the Blob was built and dropped: a clip
       * that ran the full two minutes vanished with no send and no error.
       */
      if (auto) onAutoStopRef.current?.(clip);
    };

    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.start();
    setRecording(true);
    setSeconds(0);

    /**
     * Elapsed time comes from a clock reading, not a tick count. `setInterval`
     * drifts, and a backgrounded tab throttles it to once a minute — counting
     * ticks would let a recording run well past the ceiling while the display
     * insisted it had not, and the server would then reject the clip.
     *
     * The stop also happens here rather than inside a `setSeconds` updater.
     * An updater must be pure; StrictMode double-invokes it, which called
     * `stop()` twice.
     */
    const startedAt = Date.now();
    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(Math.min(elapsed, MAX_VOICE_SECONDS));
      if (elapsed >= MAX_VOICE_SECONDS && recorderRef.current?.state === 'recording') {
        autoRef.current = true;
        recorderRef.current.stop();
      }
    }, 250);

    return true;
  }, [release]);

  /** Ends capture and hands back the clip. Null if there was nothing to give. */
  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      release();
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      settleRef.current = resolve;
      recorder.stop();
    });
  }, [release]);

  /** Ends capture and throws the clip away. */
  const cancel = useCallback(() => {
    discardRef.current = true;
    autoRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else release();
  }, [release]);

  return { recording, seconds, supported, start, stop, cancel };
}
