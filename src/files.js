const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function isImageFile(file) {
  if (!file) {
    return false;
  }

  if (file.type && file.type.startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name || "");
}

export function releaseFrames(frames) {
  for (const frame of frames) {
    try {
      frame.release && frame.release();
    } catch (error) {
      console.warn("release frame failed", error);
    }
  }
}

export async function loadImageAsset(file) {
  if (typeof createImageBitmap === "function") {
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { /* Fall back for formats such as SVG. */ }
    if (bitmap) {
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => {
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
      },
    };
  }

  }
  const url = URL.createObjectURL(file);
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败：" + file.name));
    };
    image.src = url;
  });
}

export function toFileEntries(files) {
  return files.map((file) => ({
    file,
    relativePath: (file.webkitRelativePath || file.name || "").replaceAll("\\", "/"),
  }));
}

export function deriveFolderLabel(entries) {
  if (!entries.length) {
    return "未选择文件夹";
  }

  const firstPath = entries[0].relativePath || entries[0].file.name || "";
  if (firstPath.includes("/")) {
    return firstPath.split("/")[0] || "序列帧文件夹";
  }

  return entries.length === 1 ? firstPath : "已选择图片序列";
}

export function sortEntries(entries) {
  return entries
    .slice()
    .sort((left, right) => collator.compare(left.relativePath, right.relativePath));
}

export async function readDirectoryEntries(reader) {
  const collected = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) {
      break;
    }
    collected.push(...batch);
  }
  return collected;
}

export async function collectDroppedFiles(entry, parentPath = "") {
  if (!entry) {
    return [];
  }

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [
      {
        file,
        relativePath: (parentPath + entry.name).replaceAll("\\", "/"),
      },
    ];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = entry.createReader();
  const children = await readDirectoryEntries(reader);
  const nested = [];

  // Drag folder support needs recursive traversal because Chromium only returns one batch at a time.
  for (const child of children) {
    nested.push(...(await collectDroppedFiles(child, parentPath + entry.name + "/")));
  }

  return nested;
}
