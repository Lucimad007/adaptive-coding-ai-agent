import type { Monaco } from "@monaco-editor/react";
import { monacoLanguage } from "@/lib/files";

/** Same URI shape as @monaco-editor/react `path` prop (`Uri.parse(rel)`). */
export function modelUri(monaco: Monaco, rel: string) {
  return monaco.Uri.parse(rel.replace(/\\/g, "/"));
}

export function configureMonacoTs(monaco: Monaco) {
  const ts = monaco.languages.typescript;
  const shared = {
    ...ts.typescriptDefaults.getCompilerOptions(),
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
    baseUrl: ".",
    paths: {
      "@/*": ["apps/web/src/*"],
    },
  };
  ts.typescriptDefaults.setCompilerOptions(shared);
  ts.javascriptDefaults.setCompilerOptions(shared);
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setEagerModelSync(true);
}

export function ensureModel(monaco: Monaco, rel: string, content: string) {
  const uri = modelUri(monaco, rel);
  const lang = monacoLanguage(rel);
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getValue() !== content) existing.setValue(content);
    return existing;
  }
  return monaco.editor.createModel(content, lang, uri);
}

function resolveImport(fromDir: string, spec: string) {
  const stack = fromDir.replace(/\\/g, "/").split("/").filter(Boolean);
  for (const part of spec.replace(/\\/g, "/").split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export async function warmMonacoImports(
  monaco: Monaco,
  rel: string,
  source: string,
  read: (path: string) => Promise<string>,
) {
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
  const targets = new Set<string>();

  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) targets.add(resolveImport(dir, spec));
    else if (spec.startsWith("@/")) targets.add(`apps/web/src/${spec.slice(2)}`);
  }

  for (const base of targets) {
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
    for (const candidate of candidates) {
      try {
        const text = await read(candidate);
        ensureModel(monaco, candidate, text);
        break;
      } catch {
        /* try next extension */
      }
    }
  }
}
