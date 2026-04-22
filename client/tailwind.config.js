/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#080c10",
        panel: "#0e1419",
        edge: "#1e2d3d",
        gold: "#f0b429",
        teal: "#00d4b8",
        danger: "#ff4d4d",
        safe: "#22c55e",
        amber: "#f59e0b"
      },
      fontFamily: {
        body: ["DM Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(240,180,41,0.12), 0 18px 50px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
};
