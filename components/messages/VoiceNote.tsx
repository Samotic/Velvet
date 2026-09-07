'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { PauseFilled, PlayFilled } from '@/components/icons';

/** How many bars the waveform draws. Enough to read as audio, few enough to
 *  stay legible inside a bubble on a phone. */
const BARS = 32;

/**
 * The same Cloudinary asset in another container.
 *
 * Cloudinary transcodes on delivery, so swapping the extension is the whole
 * mechanism — `…/abc.webm` and `…/abc.mp3` are one stored file served two ways.
 * The transcode happens on first request and is then CDN-cached, which is why
 * this is offered as a *fallback* rather than used outright: a browser that can
 * decode the original never asks for the converted copy, and never spends a
 * transformation on it.
 */
const asFormat = (url: string, ext: string) => url.replace(/\.[a-z0-9]+$/i, `.${ext}`);

/** The `type` hint for the original, so the browser can skip it without a fetch. */
function mimeFor(url: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(url)?.[1]?.toLowerCase();
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'mp4' || ext === 'm4a') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'mp3' || ext === 'mpga') return 'audio/mpeg';
  return 'audio/webm';
}

/** Seconds → `m:ss`. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A deterministic bar pattern derived from the URL.
 *
 * Velvet does not decode the audio to draw a real waveform — that means
 * downloading and decoding every clip in the thread just to render it. The
 * pattern is therefore decorative, but it is *stable*: the same clip draws the
 * same shape on every render and for both people, so it reads as a property of
 * the message rather than as noise that reshuffles on each paint.
 */
function barsFor(src: string): number[] {
  let seed = 0;
  for (let i = 0; i < src.length; i += 1) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;

  const out: number[] = [];
  for (let i = 0; i < BARS; i += 1) {
    // xorshift — cheap, and good enough for something purely visual.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    out.push(0.28 + (seed % 1000) / 1000 * 0.72);
  }
  return out;
}

/**
 * Plays one voice note.
 *
 * Colour comes entirely from `currentColor`, because this renders inside both
 * bubble types — filled indigo with dark text when it is mine, dark card with
 * pale indigo text when it is theirs. Hard-coding either would make it
 * unreadable in the other.
 */
export function VoiceNote({ src, duration }: { src: string; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [probed, setProbed] = useState<number | null>(null);
  /**
   * Why playback failed, shown in place of the waveform.
   *
   * A silent `catch` here was a real bug: a browser that cannot decode the
   * container (Safari and WebM/Opus, most often) rejected `play()` and the
   * button simply did nothing, which is indistinguishable from a dead button.
   */
  const [failure, setFailure] = useState<string | null>(null);

  const bars = useMemo(() => barsFor(src), [src]);

  /**
   * The server's measurement wins.
   *
   * A MediaRecorder webm carries no duration in its header, so `audio.duration`
   * reads `Infinity` until the clip is played through or seeked to the end.
   * Cloudinary probes the file at upload, which is why `mediaDuration` is
   * stored — the element's own value is only a fallback for older messages
   * saved before that field existed.
   */
  const total = duration ?? probed;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setElapsed(el.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
      el.currentTime = 0;
    };
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setProbed(el.duration);
    };
    /**
     * The element's own failure path. `play()` rejecting is not the only way
     * this breaks — a source the browser cannot decode fails here instead,
     * often before play() is ever called.
     */
    const onError = () => {
      const code = el.error?.code;
      setPlaying(false);
      setFailure(
        code === 4 ? "This browser can't play this recording" : 'This recording could not be loaded',
      );
      // Kept for the console so the numeric code survives for diagnosis.
      console.error('voice note failed', { code, message: el.error?.message, src: el.currentSrc });
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('error', onError);
    };
  }, []);

  /**
   * Swapping `<source>` children does not restart the browser's resource
   * selection the way changing `src` would — only `load()` does. Without this
   * a recycled component would keep playing the previous clip.
   */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setFailure(null);
    setElapsed(0);
    setPlaying(false);
    el.load();
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el
        .play()
        .then(() => {
          setPlaying(true);
          setFailure(null);
        })
        .catch((err: unknown) => {
          setPlaying(false);
          const name = err instanceof Error ? err.name : '';
          setFailure(
            name === 'NotAllowedError'
              ? 'Playback was blocked — tap again'
              : "This browser can't play this recording",
          );
          console.error('voice note play() rejected', err);
        });
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  /** Seek by clicking the waveform. */
  function seek(fraction: number) {
    const el = audioRef.current;
    if (!el || !total) return;
    el.currentTime = Math.max(0, Math.min(total, fraction * total));
    setElapsed(el.currentTime);
  }

  const progress = total ? Math.min(1, elapsed / total) : 0;

  return (
    <div className="voice-note">
      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <PauseFilled size={15} /> : <PlayFilled size={15} />}
      </button>

      {failure ? (
        /* Replaces the waveform only — the bubble keeps its shape, so a failure
           does not reflow the thread around it. A scrubber for audio that will
           not play is a control with nothing behind it. */
        <span className="voice-failed">
          {failure} ·{' '}
          <a href={src} download className="voice-retry">
            Download
          </a>
        </span>
      ) : (
      <div
        className="voice-wave"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(total ?? 0)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={clock(elapsed)}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - box.left) / box.width);
        }}
        onKeyDown={(e) => {
          if (!total) return;
          if (e.key === 'ArrowRight') seek(Math.min(1, (elapsed + 5) / total));
          if (e.key === 'ArrowLeft') seek(Math.max(0, (elapsed - 5) / total));
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className={`voice-bar${i / BARS <= progress ? ' played' : ''}`}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>
      )}

      <span className="voice-time">{clock(playing || elapsed > 0 ? elapsed : (total ?? 0))}</span>

      {/*
        Two candidates, in cost order.

        The browser tries the original first; a browser that cannot decode it
        advances to the MP3, which Cloudinary produces from the same asset on
        demand. Chrome and Firefox play the Opus original and never request the
        conversion, so the fallback costs nothing until something actually needs
        it — and MP3 is the one audio format every browser can play.

        preload="metadata" so a long thread doesn't pull every clip's audio.
      */}
      <audio ref={audioRef} preload="metadata">
        <source src={src} type={mimeFor(src)} />
        <source src={asFormat(src, 'mp3')} type="audio/mpeg" />
      </audio>
    </div>
  );
}
