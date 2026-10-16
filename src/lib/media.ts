export const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
export const VIDEO = ["mp4", "webm", "mov", "mkv", "m4v"];
export const extOf = (name: string) => { const base = name.split(/[\\/]/).pop() ?? ""; const i = base.lastIndexOf("."); return i < 0 ? "" : base.slice(i + 1).toLowerCase(); };
export const isImage = (ext: string) => IMAGE.includes(ext.toLowerCase());
export const isVideo = (ext: string) => VIDEO.includes(ext.toLowerCase());
export const isMedia = (ext: string) => isImage(ext) || isVideo(ext);
export const isTextNote = (ext: string) => ["md", "txt"].includes(ext.toLowerCase());
