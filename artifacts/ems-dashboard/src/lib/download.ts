function safeDownloadFilename(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f"/\\]/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 128);
  return sanitized || fallback;
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  const plain = disposition.match(/filename=([^;]+)/i)?.[1]?.trim();
  let candidate = encoded ?? quoted ?? plain ?? fallback;
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      candidate = fallback;
    }
  }
  return safeDownloadFilename(candidate, fallback);
}

export async function downloadPdfResponse(response: Response, fallbackFilename: string): Promise<void> {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/pdf")) {
    throw new Error("Sunucu geçerli bir PDF döndürmedi.");
  }
  const blob = await response.blob();
  if (blob.size < 1_024) throw new Error("PDF içeriği boş veya geçersiz.");

  const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = responseFilename(response, fallbackFilename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function downloadBlobResponse(response: Response, fallbackFilename: string): Promise<void> {
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Dosya içeriği boş veya geçersiz.");
  const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
  const objectUrl = URL.createObjectURL(new Blob([blob], { type: contentType }));
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = responseFilename(response, fallbackFilename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
