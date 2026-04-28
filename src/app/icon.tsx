import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 512,
        height: 512,
        background: "#09090b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 96,
      }}
    >
      {/* Barbell: shaft + two plates */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {/* Left plate */}
        <div style={{
          width: 40, height: 160, background: "#22c55e",
          borderRadius: "8px 4px 4px 8px",
        }} />
        {/* Shaft */}
        <div style={{
          width: 220, height: 28, background: "#d4d4d8",
          borderRadius: 6,
        }} />
        {/* Right plate */}
        <div style={{
          width: 40, height: 160, background: "#22c55e",
          borderRadius: "4px 8px 8px 4px",
        }} />
      </div>
    </div>,
    { ...size }
  );
}
