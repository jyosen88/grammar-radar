/** 图片裁剪工具：把原图按裁剪区域绘制到 canvas，导出 Blob（JPEG） */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getCroppedImageBlob(
  imageSrc: string,
  cropArea: CropArea,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg"
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropArea.width));
  canvas.height = Math.max(1, Math.round(cropArea.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("裁剪失败"))),
      mimeType,
      mimeType === "image/jpeg" ? 0.92 : undefined
    );
  });
}
