import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, "..", "..", ".env") });
import { optimizeInstructionFile } from "../src/llm.js";

async function main() {
  const result = await optimizeInstructionFile({
    targetFile: "AGENTS.md",
    currentText:
      "# AGENTS.md\n\n- use named exports\n- write tests under __tests__/\n",
    clusters: [
      {
        key: "barrel exports imports",
        count: 3,
        totalIntensity: 3,
        samples: [
          "no — don't use barrel exports, import directly from the module",
          "stop, that is wrong. Don't re-export from index.ts",
          "no, again — don't use barrel exports. Import directly.",
        ],
      },
    ],
    evidenceSessions: [
      {
        checkpointId: "0ff8ca6db1c9",
        strategy: "claude-code",
        samplePrompts: [
          "Add a login route",
          "no — don't use barrel exports, import directly from the module",
        ],
      },
      {
        checkpointId: "1aaa11bb22cc",
        strategy: "claude-code",
        samplePrompts: [
          "Add a signup endpoint",
          "no, again — don't use barrel exports. Import directly.",
        ],
      },
    ],
  });

  console.log("---afterText---");
  console.log(result.afterText);
  console.log("---reasoning---");
  console.log(JSON.stringify(result.reasoning, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
