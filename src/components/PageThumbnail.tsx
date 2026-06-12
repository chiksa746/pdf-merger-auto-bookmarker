import { useEffect, useRef, useState } from "react";
import { renderPdfPageToCanvas } from "../utils/pdfText";
import { Loader2 } from "lucide-react";

interface Props {
  arrayBuffer: ArrayBuffer;
  pageNumber: number;
}

export default function PageThumbnail({ arrayBuffer, pageNumber }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(false);

    renderPdfPageToCanvas(arrayBuffer, pageNumber, canvas)
      .then(() => {
        if (active) setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to render page thumbnail:", err);
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [arrayBuffer, pageNumber]);

  return (
    <div id={`thumbnail-container-${pageNumber}`} className="relative flex items-center justify-center bg-neutral-50 rounded border border-neutral-200 p-1 w-[130px] h-[170px] shadow-sm select-none mx-auto overflow-hidden">
      {loading && (
        <div id={`loader-${pageNumber}`} className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <Loader2 id={`loader-icon-${pageNumber}`} className="w-5 h-5 text-indigo-600 animate-spin" />
        </div>
      )}

      {error ? (
        <div id={`error-placeholder-${pageNumber}`} className="text-[10px] text-neutral-400 text-center p-2">
          Thumbnail unavailable
        </div>
      ) : (
        <canvas
          id={`canvas-${pageNumber}`}
          ref={canvasRef}
          className="max-w-full max-h-full object-contain h-auto rounded"
        />
      )}
    </div>
  );
}
