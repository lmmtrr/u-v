const droppedPaths = new WeakMap<File, string>();

export const filePath = (file: File): string =>
  droppedPaths.get(file) || file.webkitRelativePath || file.name;

const readEntryFiles = async (entry: FileSystemEntry, out: File[]): Promise<void> => {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    droppedPaths.set(file, entry.fullPath.replace(/^\//, ""));
    out.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await readEntryFiles(child, out);
    }
  }
};

export const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
  const entries = Array.from(dataTransfer.items || [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0 || entries.every((e) => e.isFile)) {
    return Array.from(dataTransfer.files);
  }
  const files: File[] = [];
  for (const entry of entries) await readEntryFiles(entry, files);
  return files;
};
