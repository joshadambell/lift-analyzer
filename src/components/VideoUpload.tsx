"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  onVideoSelected: (file: File) => void;
  disabled?: boolean;
}

export function VideoUpload({ onVideoSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.match(/^video\/(mp4|quicktime|webm)/)) {
        alert("Please upload an MP4, MOV, or WebM video file.");
        return;
      }
      onVideoSelected(file);
    },
    [onVideoSelected]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      className={[
        "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
        dragging ? "border-green-400 bg-green-950/30" : "border-zinc-600 hover:border-zinc-400",
        disabled ? "opacity-50 pointer-events-none" : "",
      ].join(" ")}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <div className="text-5xl mb-4">🎬</div>
      <p className="text-lg font-medium text-zinc-200">Drop a squat video here</p>
      <p className="text-sm text-zinc-500 mt-2">
        Side-view · MP4 / MOV · One or multiple reps
      </p>
    </div>
  );
}
