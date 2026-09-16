export type FileEntry = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: FileEntry[];
};
