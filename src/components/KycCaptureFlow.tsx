import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Camera, Check, IdCard, BookUser, RefreshCw, Sun, ScanLine } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { submitKycAuto } from "@/lib/trustlaunch.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DocType = "national_id" | "passport";
type Shot = "front" | "back" | "selfie";

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Basic automated pre-check: brightness + edge/sharpness score on the captured frame. */
function analyzeFrame(canvas: HTMLCanvasElement): { brightness: number; sharpness: number } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { brightness: 128, sharpness: 100 };
  const w = Math.min(canvas.width, 320);
  const h = Math.round((canvas.height / canvas.width) * w);
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
  const img = tmp.getContext("2d")?.getImageData(0, 0, w, h);
  if (!img) return { brightness: 128, sharpness: 100 };
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  const brightness = sum / (w * h);
  let varSum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      varSum += lap * lap;
      n++;
    }
  }
  return { brightness, sharpness: n ? varSum / n : 0 };
}

export function KycCaptureFlow({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const submitFn = useServerFn(submitKycAuto);

  const [docType, setDocType] = useState<DocType | null>(null);
  const [step, setStep] = useState<"type" | "guide" | "capture" | "review">("type");
  const [shot, setShot] = useState<Shot>("front");
  const [shots, setShots] = useState<Partial<Record<Shot, string>>>({});
  const [busy, setBusy] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const needsBack = docType === "national_id";
  const order: Shot[] = needsBack ? ["front", "back", "selfie"] : ["front", "selfie"];

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const startCam = useCallback(
    async (which: Shot) => {
      setCamError(null);
      stopCam();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: which === "selfie" ? "user" : { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        setCamError(t("capture.cameraError"));
      }
    },
    [stopCam, t],
  );

  useEffect(() => {
    if (open && step === "capture") void startCam(shot);
    if (!open || step !== "capture") stopCam();
    return () => stopCam();
  }, [open, step, shot, startCam, stopCam]);

  function reset() {
    setDocType(null);
    setStep("type");
    setShot("front");
    setShots({});
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const { brightness, sharpness } = analyzeFrame(canvas);
    if (brightness < 45 || brightness > 225) {
      toast.error(t("capture.checkLight"));
      return;
    }
    if (sharpness < 12) {
      toast.error(t("capture.checkSharp"));
      return;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const next = { ...shots, [shot]: dataUrl };
    setShots(next);
    const idx = order.indexOf(shot);
    if (idx < order.length - 1) {
      setShot(order[idx + 1]);
    } else {
      stopCam();
      setStep("review");
    }
  }

  async function submit() {
    if (!docType) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      const base = `${uid}/${Date.now()}`;
      const paths: Partial<Record<Shot, string>> = {};
      for (const s of order) {
        const dataUrl = shots[s];
        if (!dataUrl) throw new Error(t("capture.missingShot"));
        const path = `${base}/${s}.jpg`;
        const { error } = await supabase.storage
          .from("kyc-documents")
          .upload(path, dataUrlToBlob(dataUrl), { upsert: true, contentType: "image/jpeg" });
        if (error) throw error;
        paths[s] = path;
      }
      await submitFn({
        data: {
          documentType: docType,
          frontPath: paths.front!,
          backPath: paths.back ?? null,
          selfiePath: paths.selfie!,
          meta: { capturedWith: "in-app-camera", locale: document.documentElement.lang || "en" },
        },
      });
      toast.success(t("capture.approved"));
      reset();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const shotLabel =
    shot === "selfie"
      ? t("capture.shotSelfie")
      : shot === "front"
        ? docType === "passport"
          ? t("capture.shotPassport")
          : t("capture.shotFront")
        : t("capture.shotBack");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (!v) {
          stopCam();
          reset();
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("capture.title")}</DialogTitle>
        </DialogHeader>

        {step === "type" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("capture.chooseDoc")}</p>
            <button
              type="button"
              onClick={() => setDocType("national_id")}
              className={`flex w-full items-start gap-3 rounded-md border p-3 text-start ${docType === "national_id" ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
            >
              <IdCard className="mt-0.5 h-5 w-5" />
              <div>
                <div className="text-sm font-medium">{t("capture.nationalId")}</div>
                <div className="text-xs text-muted-foreground">{t("capture.nationalIdDesc")}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setDocType("passport")}
              className={`flex w-full items-start gap-3 rounded-md border p-3 text-start ${docType === "passport" ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
            >
              <BookUser className="mt-0.5 h-5 w-5" />
              <div>
                <div className="text-sm font-medium">{t("capture.passport")}</div>
                <div className="text-xs text-muted-foreground">{t("capture.passportDesc")}</div>
              </div>
            </button>
          </div>
        )}

        {step === "guide" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("capture.guideTitle")}</p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-start gap-2"><Sun className="mt-0.5 h-4 w-4 shrink-0" />{t("capture.guideLight")}</li>
              <li className="flex items-start gap-2"><ScanLine className="mt-0.5 h-4 w-4 shrink-0" />{t("capture.guideClarity")}</li>
              <li className="flex items-start gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0" />{t("capture.guideFrame")}</li>
              <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" />{t("capture.guideSteps")}</li>
            </ul>
          </div>
        )}

        {step === "capture" && (
          <div className="space-y-3">
            <div className="text-sm font-medium">{shotLabel}</div>
            <div className="relative overflow-hidden rounded-md bg-black">
              <video ref={videoRef} playsInline muted className="h-[240px] w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`rounded-xl border-2 border-primary/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] ${
                    shot === "selfie" ? "h-[190px] w-[150px] rounded-full" : "h-[150px] w-[85%]"
                  }`}
                />
              </div>
            </div>
            {camError && <p className="text-xs text-destructive">{camError}</p>}
            <p className="text-[11px] text-muted-foreground">{t("capture.guideLight")} · {t("capture.guideClarity")}</p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("capture.reviewHint")}</p>
            <div className="grid grid-cols-3 gap-2">
              {order.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setShot(s); setStep("capture"); }}
                  className="group relative overflow-hidden rounded-md border"
                >
                  {shots[s] && <img src={shots[s]} alt={s} className="h-20 w-full object-cover" />}
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/80 py-0.5 text-[10px]">
                    <RefreshCw className="h-3 w-3" />{t("capture.retake")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between gap-2">
          <Button
            variant="outline"
            disabled={busy || step === "type"}
            onClick={() => {
              if (step === "guide") setStep("type");
              else if (step === "capture") {
                const idx = order.indexOf(shot);
                if (idx > 0) setShot(order[idx - 1]);
                else setStep("guide");
              } else setStep("capture");
            }}
          >
            {t("onboarding.back")}
          </Button>
          {step === "type" && (
            <Button disabled={!docType} onClick={() => setStep("guide")}>{t("onboarding.next")}</Button>
          )}
          {step === "guide" && (
            <Button onClick={() => { setShot("front"); setStep("capture"); }}>
              <Camera className="me-1 h-4 w-4" />{t("capture.openCamera")}
            </Button>
          )}
          {step === "capture" && (
            <Button onClick={capture} disabled={!!camError}>{t("capture.shoot")}</Button>
          )}
          {step === "review" && (
            <Button onClick={submit} disabled={busy}>{busy ? t("kyc.uploading") : t("capture.submit")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
