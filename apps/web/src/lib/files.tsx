import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Scale,
  Settings,
  Terminal,
} from "lucide-react";
import type { IconType } from "react-icons";
import { VscJson, VscTerminalPowershell } from "react-icons/vsc";
import {
  SiCss,
  SiDocker,
  SiGit,
  SiGo,
  SiHtml5,
  SiJavascript,
  SiMarkdown,
  SiNextdotjs,
  SiNpm,
  SiPnpm,
  SiPytest,
  SiPython,
  SiReact,
  SiRust,
  SiSqlite,
  SiSvg,
  SiTailwindcss,
  SiToml,
  SiTypescript,
  SiVite,
  SiYaml,
} from "react-icons/si";

export function monacoLanguage(path: string): string {
  const name = path.split(/[/\\]/).pop() || "";
  if (name.startsWith(".env") || name === ".gitignore") return "ini";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
    ps1: "powershell",
    rs: "rust",
    go: "go",
    sql: "sql",
    xml: "xml",
    svg: "xml",
    ini: "ini",
    env: "ini",
  };
  return map[ext] || "plaintext";
}

const SIZE = 14;

type Brand = { kind: "brand"; Icon: IconType; color: string };
type Glyph = { kind: "glyph"; Icon: LucideIcon; color: string };
type Pick = Brand | Glyph;

export function FileTypeIcon({ name }: { name: string }) {
  const p = pickIcon(name.toLowerCase());
  if (p.kind === "brand") {
    return <p.Icon size={SIZE} color={p.color} className="shrink-0" />;
  }
  return <p.Icon size={SIZE} color={p.color} strokeWidth={1.75} className="shrink-0" />;
}

function brand(Icon: IconType, color: string): Brand {
  return { kind: "brand", Icon, color };
}

function glyph(Icon: LucideIcon, color: string): Glyph {
  return { kind: "glyph", Icon, color };
}

function pickIcon(lower: string): Pick {
  if (lower === "dockerfile" || lower.startsWith("docker-compose")) return brand(SiDocker, "#2496ED");
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") return brand(SiGit, "#F05032");
  if (lower === "license" || lower.startsWith("license.")) return glyph(Scale, "#c8c8c8");
  if (lower === "readme.md" || lower === "readme") return glyph(BookOpen, "#f0c14b");
  if (lower === "package.json" || lower === "package-lock.json") return brand(SiNpm, "#CB3837");
  if (lower === "pnpm-lock.yaml" || lower === "pnpm-workspace.yaml") return brand(SiPnpm, "#F69220");
  if (lower.startsWith("tsconfig")) return brand(SiTypescript, "#3178C6");
  if (lower.startsWith("vite.config")) return brand(SiVite, "#646CFF");
  if (lower.startsWith("next.config")) return brand(SiNextdotjs, "#fff");
  if (lower.includes("tailwind")) return brand(SiTailwindcss, "#06B6D4");
  if (lower === "pytest.ini" || lower.startsWith("test_") || lower.startsWith("conftest")) {
    return brand(SiPytest, "#0A9EDC");
  }
  if (lower === "requirements.txt" || lower === "pyproject.toml") return brand(SiPython, "#3776AB");
  if (lower.startsWith(".env") || lower.endsWith(".env") || lower.includes(".env.")) {
    return glyph(Settings, "#f0c14b");
  }
  if (lower.includes("secret") || lower.includes("credential") || lower.endsWith(".pem") || lower.endsWith(".key")) {
    return glyph(KeyRound, "#f0c14b");
  }
  if (lower.endsWith(".lock") || lower.includes("-lock.") || lower.includes("lock.json") || lower.includes("lock.yaml")) {
    return glyph(Lock, "#a3a3a3");
  }
  if (
    lower.includes("eslint") ||
    lower.includes("prettier") ||
    lower.includes("editorconfig") ||
    /\.(ini|conf|cfg)$/.test(lower) ||
    /\.config\.(js|cjs|mjs|ts)$/.test(lower) ||
    /(^|\.)[\w-]*rc$/.test(lower.replace(/\.(json|ya?ml|js|cjs|mjs)$/, ""))
  ) {
    return glyph(Settings, "#c8c8c8");
  }

  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const byExt: Record<string, Pick> = {
    ts: brand(SiTypescript, "#3178C6"),
    mts: brand(SiTypescript, "#3178C6"),
    cts: brand(SiTypescript, "#3178C6"),
    tsx: brand(SiReact, "#61DAFB"),
    jsx: brand(SiReact, "#61DAFB"),
    js: brand(SiJavascript, "#F7DF1E"),
    mjs: brand(SiJavascript, "#F7DF1E"),
    cjs: brand(SiJavascript, "#F7DF1E"),
    py: brand(SiPython, "#3776AB"),
    json: brand(VscJson, "#cbcb41"),
    md: brand(SiMarkdown, "#519aba"),
    css: brand(SiCss, "#1572B6"),
    scss: brand(SiCss, "#C6538C"),
    html: brand(SiHtml5, "#E34F26"),
    yml: brand(SiYaml, "#CB171E"),
    yaml: brand(SiYaml, "#CB171E"),
    toml: brand(SiToml, "#9C4221"),
    rs: brand(SiRust, "#DEA584"),
    go: brand(SiGo, "#00ADD8"),
    sql: brand(SiSqlite, "#0ea5e9"),
    svg: brand(SiSvg, "#FFB13B"),
    png: glyph(ImageIcon, "#c4b5fd"),
    jpg: glyph(ImageIcon, "#c4b5fd"),
    jpeg: glyph(ImageIcon, "#c4b5fd"),
    gif: glyph(ImageIcon, "#c4b5fd"),
    webp: glyph(ImageIcon, "#c4b5fd"),
    ico: glyph(ImageIcon, "#c4b5fd"),
    ps1: brand(VscTerminalPowershell, "#5391FE"),
    sh: glyph(Terminal, "#5ee0a0"),
    bash: glyph(Terminal, "#5ee0a0"),
    zsh: glyph(Terminal, "#5ee0a0"),
    txt: glyph(FileText, "#c8c8c8"),
    log: glyph(FileText, "#a3a3a3"),
    xml: glyph(FileCode, "#e8a87c"),
  };
  return byExt[ext] || glyph(File, "#8a8a8a");
}
