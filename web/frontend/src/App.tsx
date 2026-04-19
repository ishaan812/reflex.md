import { Routes, Route, Navigate } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Download } from "./pages/Download";
import { Playground } from "./pages/Playground";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/download" element={<Download />} />
      <Route path="/playground" element={<Playground />} />
      {/* Legacy routes — redirect old dashboard links to the download page. */}
      <Route path="/repos" element={<Navigate to="/download" replace />} />
      <Route
        path="/repos/:owner/:name"
        element={<Navigate to="/download" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
