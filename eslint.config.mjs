import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "node_modules/**", "old/**"] },
  {
    files: [
      "app/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
    ],
    ignores: ["app/api/simulated/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/fixtures/**", "fixtures/**", "@/fixtures/**"],
              message:
                "App/lib must not import fixtures. Load §15 data only via /api/simulated/* handlers.",
            },
            {
              group: ["**/tests/**", "tests/**", "@/tests/**"],
              message:
                "Evaluator reference answers live only under tests/ and must be unreadable by the running app.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
