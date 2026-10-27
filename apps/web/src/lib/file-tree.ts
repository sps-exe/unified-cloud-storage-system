// =============================================================================
// UCSS Web — Recursive File Tree & Folder Traversal Engine
// =============================================================================
// Safely traverses dropped files, subdirectories, and webkit directory trees.
// =============================================================================

export interface QueuedFile {
  file: File;
  relativePath: string;
}

export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<QueuedFile[]> {
  const queued: QueuedFile[] = [];
  const items = dataTransfer.items;

  // Use webkitGetAsEntry if available for recursive directory walking
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    const traverse = async (entry: any, currentPath = ''): Promise<void> => {
      if (entry.isFile) {
        return new Promise<void>((resolve) => {
          entry.file(
            (f: File) => {
              const rel = currentPath ? `${currentPath}/${f.name}` : f.name;
              queued.push({ file: f, relativePath: rel });
              resolve();
            },
            () => resolve(),
          );
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async (): Promise<void> => {
          return new Promise<void>((resolve) => {
            dirReader.readEntries(
              async (subEntries: any[]) => {
                if (subEntries.length === 0) {
                  resolve();
                } else {
                  for (const child of subEntries) {
                    await traverse(child, currentPath ? `${currentPath}/${entry.name}` : entry.name);
                  }
                  await readEntries(); // Read next batch of directory entries (batches of 100)
                  resolve();
                }
              },
              () => resolve(),
            );
          });
        };
        await readEntries();
      }
    };

    for (const entry of entries) {
      await traverse(entry);
    }
  } else if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      const rel = f.webkitRelativePath || f.name;
      queued.push({ file: f, relativePath: rel });
    }
  }

  return queued;
}
