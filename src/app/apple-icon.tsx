import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: "#09090b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <div style={{ width: 14, height: 56, background: "#22c55e", borderRadius: "4px 2px 2px 4px" }} />
        <div style={{ width: 80, height: 10, background: "#d4d4d8", borderRadius: 3 }} />
        <div style={{ width: 14, height: 56, background: "#22c55e", borderRadius: "2px 4px 4px 2px" }} />
      </div>
    </div>,
    { ...size }
  );
}
