import type { ReflexApi } from "./index";

declare global {
  interface Window {
    reflex: ReflexApi;
  }
}
