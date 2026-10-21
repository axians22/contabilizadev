// Lint do núcleo: regras recomendadas do ESLint e do typescript-eslint (TypeScript puro, sem React/Next).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([js.configs.recommended, ...tseslint.configs.recommended]);
