import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import posthog from "posthog-js";
import App from "./App";
import "./index.css";

posthog.init("phc_kv2AhuSqbck6ZiMikvA8ZHogcBzaiL3TKVkcJwXBz2W4", {
  api_host: "https://us.i.posthog.com",
  person_profiles: "identified_only",
  capture_pageview: true,
  capture_pageleave: true,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
