"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

export default function CustomAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (isDragging) return;
      const current = audio.currentTime;
      const dur = audio.duration;
      setCurrentTime(current);
      if (dur > 0 && isFinite(dur)) {
        setProgress((current / dur) * 100);
      }
    };

    const handleLoadedMetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsLoaded(true);
      }
    };

    // Some streams don't fire loadedmetadata with correct duration,
    // so also listen to durationchange and canplaythrough
    const handleDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsLoaded(true);
      }
    };

    const handleCanPlayThrough = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsLoaded(true);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    const handleError = () => {
      const err = audio.error;
      const msg = err?.message || "Unknown error";
      console.error("[AudioPlayer] Error:", msg, "src:", src);
      setError(`Cannot play recording: ${msg}`);
    };

    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("canplaythrough", handleCanPlayThrough);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", updateProgress);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("canplaythrough", handleCanPlayThrough);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [isDragging, src]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Click-to-seek on the progress bar track
  const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;

    const rect = bar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

    const dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;

    const newTime = (percentage / 100) * dur;
    audio.currentTime = newTime;
    setProgress(percentage);
    setCurrentTime(newTime);
  }, []);

  // Drag-to-seek
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleProgressBarClick(e);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const bar = progressBarRef.current;
      const audio = audioRef.current;
      if (!bar || !audio) return;

      const rect = bar.getBoundingClientRect();
      const moveX = moveEvent.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (moveX / rect.width) * 100));

      const dur = audio.duration;
      if (!isFinite(dur) || dur <= 0) return;

      const newTime = (percentage / 100) * dur;
      audio.currentTime = newTime;
      setProgress(percentage);
      setCurrentTime(newTime);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [handleProgressBarClick]);

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (time: number) => {
    if (!isFinite(time) || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (!src) {
    return (
      <div className="w-full bg-gray-50 dark:bg-[#21262d] border border-gray-200 dark:border-[#30363d] rounded-lg p-4 text-center text-sm text-gray-400 dark:text-[#8b949e]">
        No recording available for this call.
      </div>
    );
  }

  return (
    <div className="w-full bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg p-4 shadow-sm transition-colors duration-200">
      {/* Force full download so duration is known for seeking */}
      <audio ref={audioRef} src={src} preload="auto" />

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md bg-red-50 dark:bg-[#da3633]/10 border border-red-200 dark:border-[#da3633]/30 text-xs text-red-600 dark:text-[#da3633]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button 
          onClick={togglePlay}
          className="size-10 flex shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-[#2f81f7]/10 text-blue-600 dark:text-[#2f81f7] hover:bg-blue-100 dark:hover:bg-[#2f81f7]/20 transition-colors"
        >
          {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
        </button>

        <div className="flex-1 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-mono font-medium text-gray-500 dark:text-[#8b949e]">
            <span>{formatTime(currentTime)}</span>
            <span>{isLoaded ? formatTime(duration) : "Loading..."}</span>
          </div>
          {/* Custom clickable/draggable progress bar */}
          <div
            ref={progressBarRef}
            onMouseDown={handleMouseDown}
            className="relative w-full h-2 bg-gray-200 dark:bg-[#30363d] rounded-full cursor-pointer group"
          >
            {/* Filled track */}
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 dark:bg-[#2f81f7] rounded-full transition-[width] duration-75"
              style={{ width: `${progress}%` }}
            />
            {/* Seek thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-blue-600 dark:bg-[#2f81f7] rounded-full shadow-md border-2 border-white dark:border-[#161b22] opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 7px)` }}
            />
          </div>
        </div>

        <button 
          onClick={toggleMute}
          className="p-2 text-gray-400 hover:text-gray-600 dark:text-[#8b949e] dark:hover:text-[#e6edf3] transition-colors"
        >
          {isMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </div>

      {/* Duration display */}
      {isLoaded && duration > 0 && (
        <p className="text-center text-xs text-gray-400 dark:text-[#8b949e] mt-2 font-medium">
          Total Duration: {formatTime(duration)} ({Math.round(duration)}s)
        </p>
      )}
    </div>
  );
}
