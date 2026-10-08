"use client";

import { useCallback, useRef, useState } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getCroppedImageBlob } from "@/lib/image-crop";

/** 裁剪对话框：图片固定显示，用户拖动裁剪框（可拉八向手柄）选择要保留的矩形区域 */
export default function ImageCropDialog({
  imageSrc,
  fileName,
  onConfirm,
  onCancel,
}: {
  imageSrc: string; // object URL
  fileName: string;
  onConfirm: (blob: Blob, fileName: string) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);

  /** 图片加载后，默认裁剪框尽量贴合整张图片（四周留 5% 边距，方便微调） */
  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
      // 默认框 = 居中、占图片 90% 宽高
      const c = centerCrop(makeAspectCrop({ unit: "%", width: 90 }, w / h, w, h), w, h);
      setCrop(c);
    },
    []
  );

  async function handleConfirm() {
    // 用户没拖动时 completedCrop 可能为空，此时用默认整图（即不裁剪）
    const area = completedCrop;
    if (!area || area.width < 2 || area.height < 2) {
      // 直接传原图：按整图尺寸裁一份
      const img = imgRef.current;
      if (!img) return;
      setBusy(true);
      try {
        const blob = await getCroppedImageBlob(
          imageSrc,
          { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight },
          "image/jpeg"
        );
        onConfirm(blob, fileName.replace(/\.\w+$/, "") + ".jpg");
      } catch {
        alert("处理失败，请重试");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      // completedCrop 单位是"显示像素"，需换算回原图像素
      const img = imgRef.current;
      if (!img) return;
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;
      const blob = await getCroppedImageBlob(
        imageSrc,
        {
          x: area.x * scaleX,
          y: area.y * scaleY,
          width: area.width * scaleX,
          height: area.height * scaleY,
        },
        "image/jpeg"
      );
      onConfirm(blob, fileName.replace(/\.\w+$/, "") + ".jpg");
    } catch {
      alert("裁剪失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题 */}
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">裁剪图片</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            拖动紫色框的边角，框住要保留的内容
          </p>
        </div>

        {/* 裁剪区域：图片完整显示，裁剪框可拖动、可拉伸八向手柄 */}
        <div className="flex max-h-[55vh] items-center justify-center overflow-auto bg-slate-900">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            className="max-h-[55vh]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt="待裁剪图片"
              onLoad={onImageLoad}
              className="max-h-[55vh] w-auto"
            />
          </ReactCrop>
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-600 disabled:opacity-60"
          >
            {busy ? "裁剪中…" : "确认裁剪"}
          </button>
        </div>
      </div>
    </div>
  );
}
