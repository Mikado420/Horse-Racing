// セーブファイルの書き出し・読み込み（ブラウザ操作）
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error("ファイルが大きすぎます"));
  return file.text();
}

export function saveFileName(owner: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `owners-save-${owner}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
