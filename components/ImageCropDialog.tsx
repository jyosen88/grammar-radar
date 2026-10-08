"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { getCroppedImageBlob, type CropArea } from "@/lib/image-crop";

/** 裁剪对话框：在选图后弹出，支持拖拽/缩放选择矩形区域 */
export default function ImageCropDialog({
  imageSrc,
  fileName,
  onConfirm,
  onCancel,
}: {
  imageSrc: string; // object URL 或 data URL
  fileName: string;
  onConfirm: (blob: Blob, fileName: string) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels);
  }, []);

  async function handleConfirm() {
    if (!croppedArea) return;
    setBusy(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedArea, "image/jpeg");
      onConfirm(blob, fileName.replace(/\.\w+$/, "") + ".jpg");
    } catch {
      alert("裁剪失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  // 打开时聚焦到图片中心区域（裁剪框默认尽量贴合内容，用户可微调）
  useEffect(() => {
    // react-easy-crop 默认裁剪框就是整个图片居中，无需额外处理
  }, []);

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
          <p className="mt-0.5 text-xs text-slate-500">拖动和缩放选择要识别的区域</p>
        </div>

        {/* 裁剪区域 */}
        <div className="relative h-[50vh] min-h-[280px] w-full bg-slate-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={undefined}
            cropShape="rect"
            showGrid={true}
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={setZoom}
            style={{
              containerStyle: { width: "100%", height: "100%" },
              cropAreaStyle: { border: "2px solid #a78bfa" },
            }}
          />
        </div>

        {/* 缩放控制 */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500">缩放</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-violet-500"
          />
          <span className="w-8 text-right text-xs text-slate-500">
            {zoom.toFixed(1)}x
          </span>
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
            disabled={busy || !croppedArea}
            className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-600 disabled:opacity-60"
          >
            {busy ? "裁剪中…" : "确认裁剪"}
          </button>
        </div>
      </div>
    </div>
  );
}
