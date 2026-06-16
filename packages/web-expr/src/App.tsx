export function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section style={{ maxWidth: "640px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#4b5563" }}>Web experiment workspace</p>
        <h1 style={{ margin: "8px 0 12px", fontSize: "32px", lineHeight: 1.1 }}>Thoth Web Experiments</h1>
        <p style={{ margin: 0, color: "#374151", lineHeight: 1.6 }}>A separate Vite entrypoint for trying UI flows before they are moved into the main web app.</p>
      </section>
    </main>
  );
}
