import { Routes, Route, Navigate } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Repos } from "./pages/Repos";
import { Repo } from "./pages/Repo";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/repos" element={<Repos />} />
      <Route path="/repos/:owner/:name" element={<Repo />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
