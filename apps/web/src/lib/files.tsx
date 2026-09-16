import type { IconType } from "react-icons";
import {
  VscFile,
  VscFolder,
  VscFolderOpened,
  VscJson,
  VscTerminalPowershell,
} from "react-icons/vsc";
import { FaFileImage } from "react-icons/fa";
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
  };
  return map[ext] || "plaintext";
}

const SIZE = 15;

export function FolderIcon({ open }: { open: boolean }) {
  const Icon = open ? VscFolderOpened : VscFolder;
  return <Icon size={SIZE} color="#dcb67a" className="shrink-0" />;
}

export function FileTypeIcon({ name }: { name: string }) {
  const { Icon, color } = pickIcon(name.toLowerCase());
  return <Icon size={SIZE} color={color} className="shrink-0" />;
}

function pickIcon(lower: string): { Icon: IconType; color: string } {
  if (lower === "dockerfile" || lower.startsWith("docker-compose")) return { Icon: SiDocker, color: "#2496ED" };
  if (lower === ".gitignore" || lower === ".gitattributes") return { Icon: SiGit, color: "#F05032" };
  if (lower.startsWith(".env")) return { Icon: VscFile, color: "#16a34a" };
  if (lower === "license" || lower.startsWith("license.")) return { Icon: VscFile, color: "#a1a1aa" };
  if (lower === "package.json" || lower === "package-lock.json") return { Icon: SiNpm, color: "#CB3837" };
  if (lower === "pnpm-lock.yaml" || lower === "pnpm-workspace.yaml") return { Icon: SiPnpm, color: "#F69220" };
  if (lower.startsWith("tsconfig")) return { Icon: SiTypescript, color: "#3178C6" };
  if (lower.startsWith("vite.config")) return { Icon: SiVite, color: "#646CFF" };
  if (lower.startsWith("next.config")) return { Icon: SiNextdotjs, color: "#fff" };
  if (lower.includes("tailwind")) return { Icon: SiTailwindcss, color: "#06B6D4" };
  if (lower === "pytest.ini" || lower.startsWith("test_") || lower.startsWith("conftest")) {
    return { Icon: SiPytest, color: "#0A9EDC" };
  }
  if (lower === "requirements.txt" || lower === "pyproject.toml") return { Icon: SiPython, color: "#3776AB" };

  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const byExt: Record<string, { Icon: IconType; color: string }> = {
    ts: { Icon: SiTypescript, color: "#3178C6" },
    mts: { Icon: SiTypescript, color: "#3178C6" },
    cts: { Icon: SiTypescript, color: "#3178C6" },
    tsx: { Icon: SiReact, color: "#61DAFB" },
    jsx: { Icon: SiReact, color: "#61DAFB" },
    js: { Icon: SiJavascript, color: "#F7DF1E" },
    mjs: { Icon: SiJavascript, color: "#F7DF1E" },
    cjs: { Icon: SiJavascript, color: "#F7DF1E" },
    py: { Icon: SiPython, color: "#3776AB" },
    json: { Icon: VscJson, color: "#cbcb41" },
    md: { Icon: SiMarkdown, color: "#519aba" },
    css: { Icon: SiCss, color: "#1572B6" },
    html: { Icon: SiHtml5, color: "#E34F26" },
    yml: { Icon: SiYaml, color: "#CB171E" },
    yaml: { Icon: SiYaml, color: "#CB171E" },
    toml: { Icon: SiToml, color: "#9C4221" },
    rs: { Icon: SiRust, color: "#DEA584" },
    go: { Icon: SiGo, color: "#00ADD8" },
    sql: { Icon: SiSqlite, color: "#003B57" },
    svg: { Icon: SiSvg, color: "#FFB13B" },
    png: { Icon: FaFileImage, color: "#a78bfa" },
    jpg: { Icon: FaFileImage, color: "#a78bfa" },
    jpeg: { Icon: FaFileImage, color: "#a78bfa" },
    gif: { Icon: FaFileImage, color: "#a78bfa" },
    webp: { Icon: FaFileImage, color: "#a78bfa" },
    ps1: { Icon: VscTerminalPowershell, color: "#5391FE" },
    sh: { Icon: VscFile, color: "#4ade80" },
    bash: { Icon: VscFile, color: "#4ade80" },
  };
  return byExt[ext] || { Icon: VscFile, color: "#8b8b8b" };
}
